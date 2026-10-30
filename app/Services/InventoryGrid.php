<?php

namespace App\Services;

/** Fixed rectangles, no rotations. Placement is shared by move, unequip, split and grants. */
class InventoryGrid
{
    public const WIDTH = 10;

    public const HEIGHT = 6;

    public function fits(array $items, array $definition, int $x, int $y, array $ignore = []): bool
    {
        if ($x < 0 || $y < 0 || $x + $definition['width'] > self::WIDTH || $y + $definition['height'] > self::HEIGHT) {
            return false;
        }
        foreach ($items as $item) {
            if ($item['quantity'] < 1 || $item['equipped_slot'] || in_array($item['id'], $ignore, true)) {
                continue;
            }
            if ($x < $item['x'] + $item['definition']['width'] && $x + $definition['width'] > $item['x'] && $y < $item['y'] + $item['definition']['height'] && $y + $definition['height'] > $item['y']) {
                return false;
            }
        }

        return true;
    }

    public function free(array $items, array $definition, array $ignore = []): ?array
    {
        for ($y = 0; $y < self::HEIGHT; $y++) {
            for ($x = 0; $x < self::WIDTH; $x++) {
                if ($this->fits($items, $definition, $x, $y, $ignore)) {
                    return ['x' => $x, 'y' => $y];
                }
            }
        }

        return null;
    }
}
