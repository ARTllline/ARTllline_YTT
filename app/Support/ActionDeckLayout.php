<?php

namespace App\Support;

/** Presentation bindings only. This never executes gameplay entries. */
class ActionDeckLayout
{
    public const SIZE = 32;

    public static function normalize(array $stored, array $available): array
    {
        $raw = isset($stored['version']) ? ($stored['slots'] ?? []) : $stored;
        $seen = [];
        $slots = [];
        for ($i = 0; $i < self::SIZE; $i++) {
            $entry = $raw[$i] ?? null;
            $binding = is_string($entry) ? ['sourceType' => 'ability', 'sourceId' => $entry] : $entry;
            $id = is_array($binding) ? ($binding['sourceId'] ?? null) : null;
            if (($binding['sourceType'] ?? null) !== 'ability' || ! in_array($id, $available, true) || in_array($id, $seen, true)) {
                $slots[] = null;
            } else {
                $slots[] = ['sourceType' => 'ability', 'sourceId' => $id];
                $seen[] = $id;
            }
        }

        return ['version' => 2, 'slots' => $slots];
    }
}
