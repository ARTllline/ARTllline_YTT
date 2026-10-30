<?php

namespace App\Support;

/** Presentation bindings only. This never executes gameplay entries. */
class ActionDeckLayout
{
    public const SIZE = 32;

    public static function normalize(array $stored, array $available): array
    {
        if (array_is_list($available)) {
            $available = ['ability' => $available];
        }
        $raw = isset($stored['version']) ? ($stored['slots'] ?? []) : $stored;
        $seen = [];
        $slots = [];
        for ($i = 0; $i < self::SIZE; $i++) {
            $entry = $raw[$i] ?? null;
            $binding = is_string($entry) ? ['sourceType' => 'ability', 'sourceId' => $entry] : $entry;
            $id = is_array($binding) ? ($binding['sourceId'] ?? null) : null;
            $type = $binding['sourceType'] ?? null;
            $key = $type.':'.$id;
            if (! in_array($id, $available[$type ?? ''] ?? [], true) || in_array($key, $seen, true)) {
                $slots[] = null;
            } else {
                $slots[] = ['sourceType' => $type, 'sourceId' => $id];
                $seen[] = $key;
            }
        }

        return ['version' => 2, 'slots' => $slots];
    }
}
