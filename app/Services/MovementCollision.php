<?php

namespace App\Services;

/** Continuous sweep of a circular token against movement blockers only. */
class MovementCollision
{
    public function blocks(array $a, array $b, float $radius, array $shapes): bool
    {
        return (new ShapeIntersection)->intersects($a, $b, $radius,
            array_filter($shapes, fn ($shape) => $shape['blocksMovement']));
    }
}
