<?php

namespace App\Items;

/** Reference rarity is independent of execution and keeps variable variants explicit. */
class ItemRarity
{
    public const VALUES = ['common', 'uncommon', 'rare', 'very_rare', 'epic', 'legendary', 'artifact', 'varies', 'unknown'];

    public static function fromSource(?string $value): string
    {
        $value = strtolower(trim($value ?? ''));
        if (in_array($value, self::VALUES, true)) {
            return $value;
        }
        if (preg_match('/^(common|uncommon|rare|very rare|legendary|artifact)(?: \(\+[1-3]\))?$/D', $value, $match)) {
            return str_replace(' ', '_', $match[1]);
        }
        if ($value === 'rarity varies' || preg_match('/^(?:uncommon|rare).+\bor\b.+(?:very rare|legendary)/', $value)) {
            return 'varies';
        }

        return 'unknown';
    }
}
