<?php

namespace App\Actions;

use App\Combat\CombatExecution;
use App\Combat\TurnBudget;
use App\Compendium\BasicExecutionProfiles;
use App\Compendium\Unified\UnifiedReview;
use App\Items\ItemActions;
use App\Models\AbilityExecution;
use App\Models\Character;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Services\AbilityGeometry;
use App\Services\CharacterRules;
use App\Services\DamageRoller;
use App\Spells\SpellCasting;
use App\Spells\SpellEffects;
use Illuminate\Support\Facades\DB;

/** Prepares rolls only; confirmation reuses the authoritative Ability/Inventory pipeline. */
class BasicContentExecution
{
    public function prepare(User $user, Scene $scene, Character $character, array $data): array
    {
        app(SpellEffects::class)->expire($scene);
        $item = ! empty($data['inventoryItemId']) ? $character->inventory()->with('definition')->where('quantity', '>', 0)->findOrFail($data['inventoryItemId']) : null;
        $source = $item?->definition ?? collect($character->abilities)->firstWhere('id', $data['abilityId']);
        abort_unless($source && BasicExecutionProfiles::allowed($source), 422, 'Точный профиль исполнения не одобрен или изменён.');
        abort_unless(app(CharacterRules::class)->state($character), 422, 'Настройте характеристики персонажа.');
        $ability = $item ? app(ItemActions::class)->resolve($character, $item) : $source;
        abort_unless($ability['enabled'], 422);
        if (! $item) {
            $ability = app(SpellCasting::class)->prepare($character, $ability, $data, $scene, false);
        }
        $actor = $scene->tokens()->where('character_id', $character->id)->where('is_hidden', false)->firstOrFail();
        $target = app(ContentUseActions::class)->target($user, $scene, $data['targetId'] ?? null);
        abort_unless($target, 422, 'Выберите цель.');
        abort_if($target->is_hidden, 422, 'Цель скрыта.');
        app(AbilityGeometry::class)->validate($scene, $ability, $actor, $target, ['kind' => 'token', 'id' => $target->id], $user);
        app(TurnBudget::class)->validate($actor, $ability['activation'], $scene->id);
        foreach ($ability['costs'] as $cost) {
            $resource = collect($character->resources)->firstWhere('key', $cost['key']);
            abort_unless($resource && $resource['current'] >= $cost['amount'], 422, 'Недостаточно ресурса.');
        }
        $combat = app(TurnBudget::class)->active($scene->id);
        $state = fn (Token $t) => [$t->getAttributes(), $t->character?->getAttributes(), $t->conditions()->orderBy('id')->get()->toArray()];
        $fingerprint = UnifiedReview::digest([$state($actor), $state($target), $ability,
            $character->inventory()->orderBy('id')->get()->toArray(), $combat?->getAttributes(), $combat?->combatants()->orderBy('id')->get()->toArray(),
            DB::table('spell_effects')->where('scene_id', $scene->id)->orderBy('id')->get()->toArray(),
            $actor->ac, $target->ac, $scene->grid_size, $scene->distance_per_cell]);

        return compact('actor', 'target', 'ability', 'fingerprint', 'item');
    }

    public function roll(User $user, Scene $scene, Character $character, array $data): array
    {
        $p = $this->prepare($user, $scene, $character, $data);
        $roll = app(CombatExecution::class)->resolve($user, $character, $p['actor'], $p['ability'], [$p['target']], $data['rollMode'] ?? 'normal', $scene, true);
        $roll['healingRoll'] = isset($p['ability']['result']['dice']) ? app(DamageRoller::class)->roll($p['ability']['result']['dice']) : null;

        $costs = [app(TurnBudget::class)->active($scene->id) ? ($p['ability']['activation'] === 'bonus_action' ? 'бонусное действие' : 'действие') : 'вне боя: без расхода действия'];
        if ($p['item'] && isset($p['item']->definition->gameplay['use'])) {
            $costs[] = 'предмет −1';
        } elseif (! $p['item']) {
            $costs[] = 'ячейка '.$p['ability']['_castLevel'].' −1';
        }
        foreach ($p['ability']['costs'] as $cost) {
            $costs[] = $cost['key'].' −'.$cost['amount'];
        }

        return ['fingerprint' => $p['fingerprint'], 'rolls' => $roll, 'costSummary' => implode(' · ', $costs), 'rollMode' => $data['rollMode'] ?? 'normal'];
    }

    public function confirm(Scene $scene, AbilityExecution $execution): array
    {
        $saved = $execution->result['gmContext']['contentUse'];
        $user = User::findOrFail($execution->user_id);
        $character = app(AbilityActions::class)->authorize($user, $scene->campaign, $execution->character_id);
        $data = ['characterId' => $character->id, 'abilityId' => $saved['abilityId'] ?? app(ItemActions::class)->key($saved['inventoryItemId']),
            'inventoryItemId' => $saved['inventoryItemId'], 'targetId' => $execution->result['target']['id'], 'castLevel' => $saved['castLevel'],
            'rollMode' => $saved['automatic']['rollMode'], 'epoch' => $execution->context['epoch'], 'target' => $execution->result['target']];
        $p = $this->prepare($user, $scene, $character, $data);
        abort_unless(hash_equals($saved['automatic']['fingerprint'], $p['fingerprint']), 409, 'Условия изменились после броска. Закройте запрос и подготовьте новый.');
        $response = app(AbilityActions::class)->execute($user, $scene, $data, (bool) $p['item'], $saved['automatic']['rolls']);
        if ($p['item']) {
            app(ItemActions::class)->consume($user, $character->fresh(), $p['item'], 'use', $scene, $data['target']);
            app(CharacterActions::class)->publish($user, $character->fresh(), $scene->id);
        }
        $scene->refresh();
        $r = $response['execution'];

        return ['executionId' => $r['id'], 'summary' => [$r['abilityName'], $p['target']->name.': HP '.$p['target']->hp.' → '.$p['target']->fresh()->hp,
            $r['roll'] ? ($r['success'] ? 'Попадание' : 'Промах') : 'Лечение '.$r['healing'], 'Расход применён игровым движком']];
    }
}
