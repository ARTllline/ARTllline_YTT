<?php

namespace App\Compendium\Unified;

use App\Compendium\CompendiumSync;

/** Local human decisions bind the actual projection, including languages and provenance. */
class UnifiedReview
{
    /** Called only after the CLI has explicit human consent and verified the pinned projection. */
    public static function humanDecision(string $id, string $checksum, string $projection, string $reviewer, string $evidence, bool $copy, bool $execute = false, ?string $executionChecksum = null): array
    {
        if (trim($reviewer) === '' || trim($evidence) === '' || mb_strlen($reviewer) > 160 || mb_strlen($evidence) > 2000
            || ! preg_match('/^[a-f0-9]{64}$/D', $checksum) || ! preg_match('/^[a-f0-9]{64}$/D', $projection)
            || ($execute && (! $copy || ! preg_match('/^[a-f0-9]{64}$/D', $executionChecksum ?? '')))) {
            throw new \InvalidArgumentException('Bounded explicit reviewer/evidence and exact projection checksums required.');
        }
        $review = ['id' => $id, 'checksum' => $checksum, 'projection_checksum' => $projection,
            'reviewer' => trim($reviewer), 'evidence' => trim($evidence), 'languages' => ['en', 'ru'],
            'confirmed' => true, 'confirmed_at' => now()->toIso8601String(), 'browse' => true, 'copy' => $copy, 'execute' => $execute];
        if ($execute) {
            $review['execution_checksum'] = $executionChecksum;
        }

        return $review;
    }

    public static function digest(mixed $value): string
    {
        return hash('sha256', json_encode(CompendiumSync::canonical($value), JSON_THROW_ON_ERROR));
    }

    public static function projection(array $data): string
    {
        unset($data['normalized_data']['content']['review']['local'], $data['normalized_data']['content']['review']['gates'], $data['normalized_data']['content']['import_receipt']);
        // Selection availability is transport context, not a change to the target
        // relation. A confirmed single-record manifest keeps the same trust.
        $data['normalized_data']['content']['relations'] ??= [];
        foreach ($data['normalized_data']['content']['relations'] as &$relation) {
            unset($relation['available_in_selection']);
        }
        unset($relation);

        return self::digest(array_intersect_key($data, array_flip(['entity_type', 'external_key', 'name', 'checksum', 'normalization_version', 'normalized_data'])));
    }

    public static function approved(?array $review, string $checksum, string $projection): bool
    {
        return $review && ($review['confirmed'] ?? false) === true
            && ($review['checksum'] ?? null) === $checksum
            && ($review['projection_checksum'] ?? null) === $projection
            && ($review['browse'] ?? false) === true
            && is_bool($review['execute'] ?? null)
            && ! array_diff(['en', 'ru'], $review['languages'] ?? []);
    }
}
