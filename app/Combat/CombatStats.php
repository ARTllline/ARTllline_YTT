<?php

namespace App\Combat;

use App\Models\Character;
use App\Models\CompendiumCopy;
use App\Models\Token;
use App\Services\CharacterRules;
use App\Services\TokenCheckStats;

class CombatStats
{
    public function profile(Token|Character $subject): array
    {
        $owner = $subject instanceof Token && $subject->character_id ? $subject->character : $subject;
        if ($owner->combat_profile !== null) {
            return $owner->combat_profile;
        }
        if ($owner instanceof Character) {
            $copy = CompendiumCopy::where('campaign_id', $owner->campaign_id)->where('target_type', 'creature')->where('target_key', (string) $owner->id)->latest('id')->first();
            if ($copy) {
                return $this->fromMonster($copy->snapshot['normalized_data']);
            }
        }

        return [];
    }

    public function fromMonster(array $n): array
    {
        // Only simple canonical types execute. Qualified prose is retained in the receipt.
        return ['resistances' => $n['damage_resistances'] ?? [], 'vulnerabilities' => $n['damage_vulnerabilities'] ?? [],
            'immunities' => $n['damage_immunities'] ?? [], 'condition_immunities' => $n['condition_immunities'] ?? [],
            'ability_scores' => $n['ability_scores'] ?? [], 'saving_throws' => $n['saving_throws'] ?? [], 'proficiency_bonus' => $n['proficiency_bonus'] ?? 0];
    }

    public function save(Token $token, string $ability): array
    {
        if ($token->character_id && $token->character->rules) {
            return app(TokenCheckStats::class)->resolve($token, ['stat_key' => 'save_'.$ability]);
        }
        $stats = $token->check_stats ?? [];
        $existing = collect($stats)->first(fn ($s) => app(CharacterRules::class)->canonical($s['key']) === 'save_'.$ability);
        $profile = $this->profile($token);
        $value = $existing['modifier'] ?? $profile['saving_throws'][$ability] ?? null;
        if ($value === null) {
            $base = collect($stats)->first(fn ($s) => app(CharacterRules::class)->canonical($s['key']) === $ability);
            $value = $base['modifier'] ?? (isset($profile['ability_scores'][$ability]) ? app(CharacterRules::class)->abilityModifier($profile['ability_scores'][$ability]) : null);
        }
        abort_if($value === null, 422, 'У цели не настроен спасбросок '.$ability.'.');

        return ['source' => 'token_stat', 'tokenId' => (string) $token->id, 'statKey' => 'save_'.$ability, 'finalModifier' => (int) $value,
            'breakdown' => [['source' => 'base', 'label' => 'Save '.strtoupper($ability), 'value' => (int) $value]]];
    }

    public function speed(Token $token): float
    {
        return (float) ($token->speed ?? 0);
    }

    public function attack(Token $token, array $config): array
    {
        $key = $config['ability'] === 'spellcasting' ? ($this->profile($token)['spellcasting_ability'] ?? 'spell_attack') : $config['ability'];
        $score = $this->profile($token)['ability_scores'][$key] ?? null;
        $p = $score !== null ? ['source' => 'token_stat', 'tokenId' => (string) $token->id, 'statKey' => $key, 'finalModifier' => app(CharacterRules::class)->abilityModifier($score)] : app(TokenCheckStats::class)->resolve($token, ['stat_key' => $key]);
        $pb = $config['proficient'] ? ($this->profile($token)['proficiency_bonus'] ?? 0) : 0;
        $p['breakdown'] = [...($p['breakdown'] ?? [['source' => 'base', 'label' => strtoupper($key), 'value' => $p['finalModifier']]]), ['source' => 'proficiency', 'label' => 'Владение', 'value' => $pb], ['source' => 'custom', 'label' => 'Бонус атаки', 'value' => $config['bonus']]];
        $p['finalModifier'] += $pb + $config['bonus'];

        return $p;
    }

    public function spellDc(Token $token): ?array
    {
        $profile = $this->profile($token);
        $key = $profile['spellcasting_ability'] ?? null;
        if (! $key) {
            return null;
        }
        $score = $profile['ability_scores'][$key] ?? null;
        if ($score === null) {
            return null;
        }
        $parts = [['source' => 'base', 'label' => 'База Сл', 'value' => 8], ['source' => 'ability', 'label' => strtoupper($key), 'value' => app(CharacterRules::class)->abilityModifier($score)], ['source' => 'proficiency', 'label' => 'Владение', 'value' => $profile['proficiency_bonus'] ?? 0]];

        return ['modifier' => array_sum(array_column($parts, 'value')), 'breakdown' => $parts];
    }
}
