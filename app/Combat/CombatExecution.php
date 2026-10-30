<?php

namespace App\Combat;

use App\Actions\TokenCombatActions;
use App\Items\ItemActions;
use App\Models\Character;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Services\AbilityGeometry;
use App\Services\CharacterRules;
use App\Services\CheckRoller;
use App\Services\TokenCheckStats;
use App\Spells\SpellEffects;

class CombatExecution
{
    public function roll(array $provenance, int $dc, array $context, bool $attack = false, ?Token $subject = null, string $kind = 'check'): array
    {
        $bonusRolls = app(SpellEffects::class)->rollBonus($subject, $kind);
        $provenance['finalModifier'] += array_sum(array_map(fn ($b) => $b['roll']['total'], $bonusRolls));
        if ($context['automaticFailure']) {
            $r = ['rawDice' => [], 'natural' => 0, 'modifier' => $provenance['finalModifier'], 'total' => $provenance['finalModifier'], 'dc' => $dc, 'success' => false, 'rollMode' => $context['mode'], 'selectedDie' => null, 'automaticFailure' => true];
        } else {
            $r = app(CheckRoller::class)->roll($provenance['finalModifier'], $dc, $context['mode']);
        }
        if ($attack) {
            $r['success'] = $r['natural'] === 20 || ($r['natural'] !== 1 && $r['success']);
        }

        return $r + ['context' => $context, 'bonusRolls' => $bonusRolls];
    }

    public function resolve(User $author, Token|Character $subject, ?Token $actor, array $ability, array $targets, string $requested, Scene $scene): array
    {
        $roll = $provenance = null;
        $success = true;
        $critical = false;
        $first = $targets[0] ?? null;
        $distance = $actor && $first ? app(AbilityGeometry::class)->distance($scene, $actor, $first) : 0;
        $save = $ability['save'] ?? null;
        if (! $save && ($ability['check'] || ! empty($ability['attack']))) {
            $config = $ability['check'] ?? ['dc' => 0, 'dc_visible' => false, 'defense' => 'ac'];
            $attack = $ability['category'] === 'attack';
            if (! empty($ability['attack'])) {
                $a = $ability['attack'];
                $config = ['stat_key' => $a['ability'] === 'spellcasting' ? 'spell_attack' : $a['ability'], 'modifier' => 0, 'proficient' => $a['proficient'], 'bonus' => $a['bonus'], 'defense' => 'ac', 'dc' => 0];
            }
            $provenance = ! empty($ability['attack']) && $actor && ! $actor->character_id ? app(CombatStats::class)->attack($actor, $ability['attack']) : app(TokenCheckStats::class)->resolve($actor ?? $subject, $config + ['label' => $ability['name']]);
            if (isset($ability['_scrollAttack'])) {
                $provenance = $ability['_scrollAttack'];
            }
            if (isset($ability['_weapon'])) {
                $provenance = $ability['_weapon']['provenance'];
            }
            if (! empty($ability['attack']) && $ability['attack']['ability'] === 'spellcasting' && ! $ability['attack']['proficient'] && $subject instanceof Character && $subject->rules) {
                $provenance['breakdown'] = array_values(array_filter($provenance['breakdown'], fn ($p) => $p['source'] !== 'proficiency'));
                $provenance['finalModifier'] = array_sum(array_column($provenance['breakdown'], 'value'));
                $provenance['otherModifiers'] = array_map(fn ($p) => ['label' => $p['label'], 'modifier' => $p['value']], array_slice($provenance['breakdown'], 1));
            }
            $dc = $attack && ($config['defense'] ?? 'ac') === 'ac' ? $first?->ac : $config['dc'];
            abort_if($dc === null, 422, 'GM ещё не настроил защиту цели.');
            $saveAbility = str_starts_with($provenance['statKey'] ?? '', 'save_') ? substr($provenance['statKey'], 5) : null;
            $context = app(ConditionRules::class)->context($actor, $attack ? 'attack' : ($saveAbility ? 'save' : 'check'), $requested, $first, $distance, $saveAbility, $ability['requires_sight'] ?? false, $provenance['statKey'] ?? null);
            if (isset($ability['_weapon']) && $subject instanceof Character) {
                $context['disadvantage'] = [...$context['disadvantage'], ...app(ItemActions::class)->reasons($subject, $ability, $scene, $actor, $first)];
                $context['mode'] = ($context['advantage'] && $context['disadvantage']) ? 'normal' : ($context['advantage'] ? 'advantage' : ($context['disadvantage'] ? 'disadvantage' : 'normal'));
            }
            $roll = $this->roll($provenance, $dc, $context, $attack, $actor, $attack ? 'attack' : ($saveAbility ? 'save' : 'check'));
            $success = $roll['success'];
            $critical = $attack && $success && ($roll['natural'] === 20 || ($first && $distance <= 5 && app(ConditionRules::class)->has($first, ['unconscious'])));
        }
        $components = $ability['damage_components'] ?? [];
        if (! $components && ($ability['damage'] ?? null)) {
            $components = [['dice' => $ability['damage'], 'type' => null]];
        }
        $rolled = $success && $components ? app(TypedDamage::class)->roll($components, $critical) : [];
        $outcomes = $feedbacks = [];
        $combat = app(TurnBudget::class)->active($scene->id);
        if ($roll) {
            app(CombatLog::class)->write($combat, $ability['category'] === 'attack' ? 'attack.roll' : 'check.roll', ['abilityId' => $ability['id'], 'abilityName' => $ability['name'], 'actorId' => $actor?->id, 'roll' => $roll, 'provenance' => $provenance]);
        }
        foreach ($targets as $target) {
            $targetSave = null;
            $effect = 'full';
            if ($save) {
                $dc = $save['dc'];
                $dcProvenance = null;
                if ($save['dc_source'] === 'spellcasting') {
                    $caster = $subject instanceof Character ? $subject : ($actor?->character);
                    $stat = $caster ? app(CharacterRules::class)->stat($caster, 'spell_save_dc') : null;
                    if (! $stat && $actor) {
                        $stat = app(CombatStats::class)->spellDc($actor);
                    }
                    abort_unless($stat, 422, 'Настройте Сл заклинаний источника.');
                    $dc = $stat['modifier'];
                    $dcProvenance = $stat['breakdown'];
                }
                $p = app(CombatStats::class)->save($target, $save['ability']);
                $ctx = app(ConditionRules::class)->context($target, 'save', 'normal', null, 0, $save['ability']);
                $targetSave = $this->roll($p, $dc, $ctx, false, $target, 'save') + ['provenance' => $p, 'dcProvenance' => $dcProvenance];
                $effect = $targetSave['success'] ? $save['on_success'] : $save['on_failure'];
                app(CombatLog::class)->write($combat, 'save.roll', ['abilityId' => $ability['id'], 'sourceId' => $actor?->id, 'targetId' => (string) $target->id, 'save' => $targetSave]);
            }
            $hpBefore = $target->hp;
            $damage = $success ? app(TypedDamage::class)->apply($rolled, $target, $effect) : ['total' => 0, 'components' => []];
            if ($damage['total']) {
                app(TokenCombatActions::class)->adjustHp($author, $target, -$damage['total']);
            }
            $applied = [];
            foreach ($ability['condition_effects'] ?? [] as $condition) {
                $when = $condition['when'];
                $apply = $when === 'always' || ($when === 'hit' && $success && ! $save) || ($when === 'failed_save' && $targetSave && ! $targetSave['success']) || ($when === 'successful_save' && $targetSave && $targetSave['success']);
                if ($apply) {
                    $c = app(AppliedConditions::class)->apply($author, $target, $condition, $actor, $ability['id']);
                    if ($c) {
                        $applied[] = (string) $c->id;
                    }
                }
            }
            $outcomes[] = ['tokenId' => (string) $target->id, 'damage' => $damage['total'], 'damageDetail' => $damage, 'hpBefore' => $hpBefore, 'hpAfter' => $target->fresh()->hp, 'save' => $targetSave, 'conditionsApplied' => $applied];
            $feedbacks[] = ['tokenId' => (string) $target->id, 'text' => $success ? '−'.$damage['total'] : 'Промах', 'tone' => $success ? 'damage' : 'miss'];
            if ($rolled) {
                app(CombatLog::class)->write($combat, 'damage', ['abilityId' => $ability['id'], 'abilityName' => $ability['name'], 'sourceId' => $actor?->id, 'targetId' => (string) $target->id, 'rolled' => $rolled, 'damage' => $damage]);
            }
        }

        return ['roll' => $roll, 'provenance' => $provenance, 'success' => $success, 'critical' => $critical, 'damage' => $rolled[0]['roll'] ?? null, 'damageRolls' => $rolled, 'outcomes' => $outcomes, 'feedbacks' => $feedbacks];
    }
}
