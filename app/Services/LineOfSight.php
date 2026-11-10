<?php

namespace App\Services;

use App\Models\Scene;
use App\Models\Token;

/** Immutable query context. Reuse within a batch, rebuild after geometry changes. */
class LineOfSight
{
    public const POLICY = 'center-to-inset-disc-9-v1';
    public const EPSILON = 0.0000001;

    private array $blockers = [];
    private array $bounds = [];
    private array $props = [];
    private array $cells = [];
    private array $large = [];
    private const CELL = 256;
    private ShapeIntersection $intersection;
    public readonly string $geometryKey;

    public function __construct(array $compiled, string $blockerFlag = 'blocksVision')
    {
        $this->intersection = new ShapeIntersection;
        $this->blockers = array_values(array_filter($compiled['shapes'], fn ($s) => $s[$blockerFlag] ?? false));
        $this->geometryKey = hash('sha256', json_encode($this->blockers, JSON_THROW_ON_ERROR));
        foreach ($this->blockers as $id => $shape) {
            $points = match ($shape['kind']) {
                'band' => [$shape['a'], $shape['b']],
                'ellipse' => [$shape['center']],
                default => $shape['points'],
            };
            $padding = match ($shape['kind']) {
                'band' => $shape['radius'],
                'ellipse' => max($shape['radiusX'], $shape['radiusY']),
                default => 0,
            } + self::EPSILON;
            $xs = array_column($points, 'x');
            $ys = array_column($points, 'y');
            $this->bounds[$id] = $bounds = [min($xs) - $padding, min($ys) - $padding,
                max($xs) + $padding, max($ys) + $padding];
            if (($shape['source'] ?? null) === 'prop') {
                $this->props[$shape['id']] = $id;
            }
            [$minX, $minY, $maxX, $maxY] = array_map(static fn ($v) => (int) floor($v / self::CELL), $bounds);
            // Bound index memory for very large/diagonal shapes.
            if (($maxX - $minX + 1) * ($maxY - $minY + 1) > 256) {
                $this->large[$id] = true;
                continue;
            }
            for ($x = $minX; $x <= $maxX; $x++) {
                for ($y = $minY; $y <= $maxY; $y++) {
                    $this->cells["$x:$y"][$id] = true;
                }
            }
        }
    }

    public static function forScene(Scene $scene): self
    {
        return new self(StructuralGeometry::forScene($scene));
    }

    public function hitsProp(string $prop, array $observer, array $target): bool
    {
        $id = $this->props[$prop] ?? null;

        return $id !== null && $this->intersection->intersects($observer, $target, self::EPSILON, [$this->blockers[$id]]);
    }

    /** Inputs are world points; range is Euclidean world units, null = unlimited. */
    public function point(array $observer, array $target, ?float $range = null, bool $diagnostics = false): array
    {
        $distance = hypot($target['x'] - $observer['x'], $target['y'] - $observer['y']);
        $result = ['visible' => false, 'reason' => 'out_of_range', 'distance' => $distance];
        if ($range !== null && $distance > $range + self::EPSILON) {
            return $result;
        }
        $hits = [];
        foreach ($this->blockingShapes($observer, $target) as $shape) {
            if (! $diagnostics) {
                return ['visible' => false, 'reason' => 'blocked', 'distance' => $distance];
            }
            // Monotonic prefix intersection finds the first contact, including embedded origins.
            $low = 0;
            $high = 1;
            for ($i = 0; $i < 32; $i++) {
                $t = ($low + $high) / 2;
                $point = self::along($observer, $target, $t);
                if ($this->intersection->intersects($observer, $point, self::EPSILON, [$shape])) {
                    $high = $t;
                } else {
                    $low = $t;
                }
            }
            $hits[] = ['t' => $high, 'id' => $shape['id'], 'source' => $shape['source'],
                'point' => self::along($observer, $target, $high)];
        }
        if (! $hits) {
            return ['visible' => true, 'reason' => 'clear', 'distance' => $distance];
        }
        usort($hits, fn ($a, $b) => $a['t'] <=> $b['t']);
        unset($hits[0]['t']);

        return ['visible' => false, 'reason' => 'blocked', 'distance' => $distance, 'blocker' => $hits[0]];
    }

    /** Clip a ray at the exact LOS boundary without querying the index for each prefix. */
    public function clearDistance(array $origin, float $dx, float $dy, float $distance): float
    {
        $target = ['x' => $origin['x'] + $dx * $distance, 'y' => $origin['y'] + $dy * $distance];
        $blockers = iterator_to_array($this->blockingShapes($origin, $target), false);
        if (! $blockers) {
            return $distance;
        }
        $low = 0;
        $high = $distance;
        for ($i = 0; $i < 32; $i++) {
            $mid = ($low + $high) / 2;
            $point = ['x' => $origin['x'] + $dx * $mid, 'y' => $origin['y'] + $dy * $mid];
            if ($this->intersection->intersects($origin, $point, self::EPSILON, $blockers)) {
                $high = $mid;
            } else {
                $low = $mid;
            }
        }

        return $low;
    }

    private function blockingShapes(array $observer, array $target): iterable
    {
        $minX = min($observer['x'], $target['x']);
        $minY = min($observer['y'], $target['y']);
        $maxX = max($observer['x'], $target['x']);
        $maxY = max($observer['y'], $target['y']);
        $candidates = $this->candidates($minX, $minY, $maxX, $maxY);
        foreach ($candidates as $id => $_) {
            [$left, $top, $right, $bottom] = $this->bounds[$id];
            if ($maxX < $left || $maxY < $top || $minX > $right || $minY > $bottom) {
                continue;
            }
            $shape = $this->blockers[$id];
            if ($this->intersection->intersects($observer, $target, self::EPSILON, [$shape])) {
                yield $shape;
            }
        }
    }

    /** Center observer; target center + 8 samples at 80% of the circular footprint radius. */
    public function token(Token $observer, Token $target, ?float $range = null, bool $diagnostics = false): array
    {
        $origin = ['x' => (float) $observer->x, 'y' => (float) $observer->y];
        $center = ['x' => (float) $target->x, 'y' => (float) $target->y];
        $samples = [$center];
        $radius = $target->size * $target->scale * 0.4;
        for ($i = 0; $i < 8; $i++) {
            $angle = $i * M_PI / 4;
            $samples[] = ['x' => $center['x'] + cos($angle) * $radius, 'y' => $center['y'] + sin($angle) * $radius];
        }
        $rays = array_map(fn ($p) => ['target' => $p] + $this->point($origin, $p, $range, $diagnostics), $samples);
        $count = count(array_filter($rays, fn ($ray) => $ray['visible']));
        $result = ['visible' => $count > 0, 'visibility' => $count === 0 ? 'none' : ($count === 9 ? 'full' : 'partial'),
            'visibleSamples' => $count, 'sampleCount' => 9, 'policy' => self::POLICY];

        return $diagnostics ? $result + ['rays' => $rays] : $result;
    }

    private static function along(array $a, array $b, float $t): array
    {
        return ['x' => $a['x'] + ($b['x'] - $a['x']) * $t, 'y' => $a['y'] + ($b['y'] - $a['y']) * $t];
    }

    private function candidates(float $minX, float $minY, float $maxX, float $maxY): array
    {
        $left = (int) floor($minX / self::CELL);
        $top = (int) floor($minY / self::CELL);
        $right = (int) floor($maxX / self::CELL);
        $bottom = (int) floor($maxY / self::CELL);
        // Long diagonal rays should never walk a huge empty rectangle.
        if (($right - $left + 1) * ($bottom - $top + 1) > 4096) {
            return array_fill_keys(array_keys($this->blockers), true);
        }
        $ids = $this->large;
        for ($x = $left; $x <= $right; $x++) {
            for ($y = $top; $y <= $bottom; $y++) {
                $ids += $this->cells["$x:$y"] ?? [];
            }
        }

        return $ids;
    }
}
