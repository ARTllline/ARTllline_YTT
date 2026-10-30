<?php

namespace App\Compendium;

class SrdReferenceMapper
{
    public function map(string $endpoint, array $r): array
    {
        return ['key' => SrdKeys::key($r['index']), 'reference_type' => SrdKeys::key($endpoint),
            'description' => SrdKeys::description($r),
            'ability' => $endpoint === 'skills' ? SrdKeys::ability($r['ability_score']['index'] ?? null) : ($endpoint === 'ability-scores' ? SrdKeys::ability($r['index']) : null)];
    }
}
