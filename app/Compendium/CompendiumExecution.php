<?php

namespace App\Compendium;

use App\Compendium\Unified\UnifiedReview;
use App\Items\ItemRules;
use App\Spells\SpellProjection;

/** Fingerprints existing bounded YTT profiles; never interprets source prose. */
class CompendiumExecution
{
    public static function profile(array $data): array
    {
        $n = $data['normalized_data'];
        $basicId = $data['external_key'] === 'potion-of-healing' ? 'potion_of_healing' : $data['external_key'];
        if ($data['entity_type'] === 'spells') {
            $recipe = app(SpellProjection::class)->recipe($data['external_key']);
            $coverage = app(SpellProjection::class)->coverage($data['external_key']);
            $profile = ['recipe' => $recipe, 'coverage' => $coverage];
            $supported = $recipe !== null && ($coverage['status'] ?? 'MANUAL') !== 'MANUAL';
        } else {
            $profile = ItemRules::fromCompendium($n);
            unset($profile['gameplay']['use']['ability']['id']);
            $supported = (bool) array_intersect(array_keys($profile['gameplay']), ['weapon', 'armor', 'ammunition', 'use']);
        }

        return ['supported' => $supported, 'checksum' => UnifiedReview::digest([
            'contract' => 1, 'ruleset' => 'dnd-2024', 'rules_revision' => '5.2.1',
            ...(in_array($basicId, BasicExecutionProfiles::IDS, true) ? ['confirmation_profile' => BasicExecutionProfiles::reference($basicId)] : []),
            'type' => $data['entity_type'], 'key' => $data['external_key'], 'profile' => $profile,
        ])];
    }
}
