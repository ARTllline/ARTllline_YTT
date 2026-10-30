<?php

namespace App\Compendium;

/** Normalized identifiers are part of the compendium contract, not translated UI labels. */
class SrdKeys
{
    public static function key(string $value): string
    {
        return str_replace('-', '_', strtolower($value));
    }

    public static function ability(?string $key): ?string
    {
        return match (strtolower($key ?? '')) {
            'strength', 'str' => 'str', 'dexterity', 'dex' => 'dex', 'constitution', 'con' => 'con',
            'intelligence', 'int' => 'int', 'wisdom', 'wis' => 'wis', 'charisma', 'cha' => 'cha', default => null,
        };
    }

    public static function description(array $raw): string
    {
        $d = $raw['description'] ?? $raw['desc'] ?? '';

        return is_array($d) ? implode("\n\n", $d) : (string) $d;
    }

    public static function refs(array $refs): array
    {
        return array_map(fn ($r) => is_array($r) ? self::key($r['index']) : $r, $refs);
    }

    public static function feet(?string $value): ?float
    {
        return preg_match('/^(\d+(?:\.\d+)?) (?:feet|ft\.?)$/i', $value ?? '', $m) ? (float) $m[1] : null;
    }
}
