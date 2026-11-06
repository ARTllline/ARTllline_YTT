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
            $bounds = [];
            foreach (['x', 'y'] as $axis) {
                $bounds[$axis] = [(int) floor((min(array_column($points, $axis)) - $padding) / self::CELL),
                    (int) floor((max(array_column($points, $axis)) + $padding) / self::CELL)];
            }
            // Bound index memory for very large/diagonal shapes.
            if (($bounds['x'][1] - $bounds['x'][0] + 1) * ($bounds['y'][1] - $bounds['y'][0] + 1) > 256) {
                $this->large[$id] = true;
                continue;
            }
            for ($x = $bounds['x'][0]; $x <= $bounds['x'][1]; $x++) {
                for ($y = $bounds['y'][0]; $y <= $bounds['y'][1]; $y++) {
                    $this->cells["$x:$y"][$id] = true;
                }
            }
        }
    }

    public static function forScene(Scene $scene): self
    {
        return new self(StructuralGeometry::forScene($scene));
    }

    /** Inputs are world points; range is Euclidean world units, null = unlimited. */
    public function point(array $observer, array $target, ?float $range = null, bool $diagnostics = false): array
    {
        $distance = hypot($target['x'] - $observer['x'], $target['y'] - $observer['y']);
        $result = ['visible' => false, 'reason' => 'out_of_range', 'distance' => $distance];
        if ($range !== null && $distance > $range + self::EPSILON) {
            return $result;
        }
        $candidates = $this->candidates($observer, $target);
        $hits = [];
        foreach ($candidates as $id => $_) {
            $shape = $this->blockers[$id];
            if (! $this->intersection->intersects($observer, $target, self::EPSILON, [$shape])) {
                continue;
            }
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

    private function candidates(array $a, array $b): array
    {
        $bounds = [];
        foreach (['x', 'y'] as $axis) {
            $bounds[$axis] = [(int) floor(min($a[$axis], $b[$axis]) / self::CELL),
                (int) floor(max($a[$axis], $b[$axis]) / self::CELL)];
        }
        // Long diagonal rays should never walk a huge empty rectangle.
        if (($bounds['x'][1] - $bounds['x'][0] + 1) * ($bounds['y'][1] - $bounds['y'][0] + 1) > 4096) {
            return array_fill_keys(array_keys($this->blockers), true);
        }
        $ids = $this->large;
        for ($x = $bounds['x'][0]; $x <= $bounds['x'][1]; $x++) {
            for ($y = $bounds['y'][0]; $y <= $bounds['y'][1]; $y++) {
                $ids += $this->cells["$x:$y"] ?? [];
            }
        }

        return $ids;
    }
}
