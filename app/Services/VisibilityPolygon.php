<?php

namespace App\Services;

/** Angular event ray casting. Exact line/ellipse contacts; curved silhouette error <= .2 world units. */
class VisibilityPolygon
{
    private array $segments = [];

    private array $ellipses = [];

    private LineOfSight $los;

    public function __construct(array $compiled, string $blockerFlag = 'blocksVision')
    {
        $this->los = new LineOfSight($compiled, $blockerFlag);
        foreach ($compiled['shapes'] as $shape) {
            if (! ($shape[$blockerFlag] ?? false)) {
                continue;
            }
            if ($shape['kind'] === 'ellipse') {
                $this->ellipse($shape);
            } elseif ($shape['kind'] === 'band') {
                $a = $shape['a'];
                $b = $shape['b'];
                $angle = atan2($b['y'] - $a['y'], $b['x'] - $a['x']) + M_PI_2;
                $x = cos($angle) * $shape['radius'];
                $y = sin($angle) * $shape['radius'];
                $this->polygon([['x' => $a['x'] + $x, 'y' => $a['y'] + $y], ['x' => $b['x'] + $x, 'y' => $b['y'] + $y],
                    ['x' => $b['x'] - $x, 'y' => $b['y'] - $y], ['x' => $a['x'] - $x, 'y' => $a['y'] - $y]]);
                foreach ([['a', 'roundA'], ['b', 'roundB']] as [$point, $round]) {
                    if ($shape[$round]) {
                        $this->ellipse(['center' => $shape[$point], 'radiusX' => $shape['radius'], 'radiusY' => $shape['radius'], 'rotation' => 0]);
                    }
                }
            } else {
                $this->polygon($shape['points']);
            }
        }
    }

    private function polygon(array $points): void
    {
        $previous = $points[count($points) - 1];
        foreach ($points as $p) {
            $this->segments[] = [$previous, $p];
            $previous = $p;
        }
    }

    private function ellipse(array $shape): void
    {
        $angle = deg2rad($shape['rotation']);
        $shape['cos'] = cos($angle);
        $shape['sin'] = sin($angle);
        $this->ellipses[] = $shape;
    }

    public function build(array $origin, float $range, float $width, float $height): array
    {
        if ($range <= 0 || ! $this->los->point($origin, $origin)['visible']) {
            return [];
        }
        $near = static fn ($points, $padding = 0) => hypot(max(0, min(array_column($points, 'x')) - $origin['x'], $origin['x'] - max(array_column($points, 'x'))),
            max(0, min(array_column($points, 'y')) - $origin['y'], $origin['y'] - max(array_column($points, 'y')))) <= $range + $padding;
        $segments = array_values(array_filter($this->segments, fn ($s) => $near($s)));
        $ellipses = array_values(array_filter($this->ellipses, fn ($e) => $near([$e['center']], max($e['radiusX'], $e['radiusY']))));
        // Angular broad phase: only intersect silhouettes in the ray's sector.
        $buckets = array_fill(0, 512, ['segments' => [], 'ellipses' => []]);
        $index = static function ($kind, $id, $start, $span) use (&$buckets) {
            $first = (int) floor($start * 512 / (2 * M_PI));
            $last = (int) floor(($start + $span) * 512 / (2 * M_PI));
            for ($i = $first; $i <= $last; $i++) {
                $buckets[($i % 512 + 512) % 512][$kind][$id] = $id;
            }
        };
        foreach ($segments as $id => [$a, $b]) {
            $start = atan2($a['y'] - $origin['y'], $a['x'] - $origin['x']);
            $end = atan2($b['y'] - $origin['y'], $b['x'] - $origin['x']);
            $span = fmod($end - $start + 2 * M_PI, 2 * M_PI);
            if ($span > M_PI) {
                $start = $end;
                $span = 2 * M_PI - $span;
            }
            $index('segments', $id, $start - 1e-9, $span + 2e-9);
        }
        foreach ($ellipses as $id => $e) {
            $distance = hypot($e['center']['x'] - $origin['x'], $e['center']['y'] - $origin['y']);
            $radius = max($e['radiusX'], $e['radiusY']);
            $half = $distance <= $radius ? M_PI : asin($radius / $distance);
            $angle = atan2($e['center']['y'] - $origin['y'], $e['center']['x'] - $origin['x']);
            $index('ellipses', $id, $angle - $half - 1e-9, 2 * $half + 2e-9);
        }
        $angles = [];
        // Bound circle chord error rather than tying tessellation to camera zoom.
        $steps = max(64, (int) ceil(M_PI / acos(max(-1, 1 - .15 / max(1, $range)))));
        for ($i = 0; $i < $steps; $i++) {
            $angles[] = $i * 2 * M_PI / $steps;
        }
        $event = static function (array $p, bool $spread = true) use ($origin, &$angles) {
            $a = atan2($p['y'] - $origin['y'], $p['x'] - $origin['x']);
            foreach ($spread ? [-1e-8, 0, 1e-8] : [0] as $epsilon) {
                $angles[] = fmod($a + $epsilon + 2 * M_PI, 2 * M_PI);
            }
        };
        foreach ($segments as [$a, $b]) {
            $event($a);
            $event($b);
        }
        foreach ($ellipses as $e) {
            $dx = $origin['x'] - $e['center']['x'];
            $dy = $origin['y'] - $e['center']['y'];
            $x = ($dx * $e['cos'] + $dy * $e['sin']) / $e['radiusX'];
            $y = (-$dx * $e['sin'] + $dy * $e['cos']) / $e['radiusY'];
            $d = hypot($x, $y);
            $parameters = [];
            if ($d > 1) {
                $a = atan2($y, $x);
                $offset = acos(1 / $d);
                $parameters = [[$a - $offset, true], [$a + $offset, true]];
            }
            $n = max(16, (int) ceil(M_PI / acos(max(-1, 1 - .1 / max(1, $e['radiusX'], $e['radiusY'])))));
            for ($i = 0; $i < $n; $i++) {
                $parameters[] = [$i * 2 * M_PI / $n, false];
            }
            foreach ($parameters as [$a, $tangent]) {
                if (! $tangent && $x * cos($a) + $y * sin($a) < 1) {
                    continue;
                }
                $ex = cos($a) * $e['radiusX'];
                $ey = sin($a) * $e['radiusY'];
                $event(['x' => $e['center']['x'] + $ex * $e['cos'] - $ey * $e['sin'],
                    'y' => $e['center']['y'] + $ex * $e['sin'] + $ey * $e['cos']], $tangent);
            }
        }
        foreach ([[0, 0], [$width, 0], [$width, $height], [0, $height]] as [$x, $y]) {
            $event(compact('x', 'y'));
        }
        sort($angles, SORT_NUMERIC);
        $angles = array_values(array_unique($angles, SORT_REGULAR));
        // Reuse one conservative ray index for exact epsilon validation too. Querying
        // a world-space rectangle for every ray rechecks unrelated silhouettes.
        $exactCandidates = $this->los->radialCandidates($origin, 512);
        $cast = function (float $angle) use ($origin, $range, $width, $height, $buckets, $segments, $ellipses, $exactCandidates) {
            $angle = fmod($angle, 2 * M_PI);
            $dx = cos($angle);
            $dy = sin($angle);
            $distance = $range;
            foreach ([['x', $dx, $width], ['y', $dy, $height]] as [$axis, $direction, $limit]) {
                if (abs($direction) > 1e-12) {
                    $distance = min($distance, max(0, (($direction > 0 ? $limit : 0) - $origin[$axis]) / $direction));
                }
            }
            $sector = min(511, (int) floor($angle * 512 / (2 * M_PI)));
            $bucket = $buckets[$sector];
            foreach ($bucket['segments'] as $id) {
                [$a, $b] = $segments[$id];
                $sx = $b['x'] - $a['x'];
                $sy = $b['y'] - $a['y'];
                $den = $dx * $sy - $dy * $sx;
                if (abs($den) < 1e-12) {
                    continue;
                }
                $qx = $a['x'] - $origin['x'];
                $qy = $a['y'] - $origin['y'];
                $t = ($qx * $sy - $qy * $sx) / $den;
                $u = ($qx * $dy - $qy * $dx) / $den;
                if ($t >= 0 && $u >= -1e-10 && $u <= 1 + 1e-10) {
                    $distance = min($distance, $t);
                }
            }
            foreach ($bucket['ellipses'] as $id) {
                $e = $ellipses[$id];
                $qx = $origin['x'] - $e['center']['x'];
                $qy = $origin['y'] - $e['center']['y'];
                $x = ($qx * $e['cos'] + $qy * $e['sin']) / $e['radiusX'];
                $y = (-$qx * $e['sin'] + $qy * $e['cos']) / $e['radiusY'];
                $vx = ($dx * $e['cos'] + $dy * $e['sin']) / $e['radiusX'];
                $vy = (-$dx * $e['sin'] + $dy * $e['cos']) / $e['radiusY'];
                $a = $vx * $vx + $vy * $vy;
                $b = $x * $vx + $y * $vy;
                $disc = $b * $b - $a * ($x * $x + $y * $y - 1);
                if ($disc >= 0) {
                    $t = (-$b - sqrt($disc)) / $a;
                    if ($t >= 0) {
                        $distance = min($distance, $t);
                    }
                }
            }
            $distance = max(0, $distance - .0001);
            // Honor MAP-08A's epsilon at grazes and curve tangencies too.
            $distance = $this->los->clearDistance($origin, $dx, $dy, $distance, $exactCandidates[$sector]);

            return ['x' => $origin['x'] + $dx * $distance, 'y' => $origin['y'] + $dy * $distance];
        };
        $points = array_map($cast, $angles);
        $result = [];
        // Resolve intersections/overlapping silhouettes between angular events.
        $refine = function ($a, $b, $pa, $pb, $depth = 0) use (&$refine, &$result, $cast) {
            if ($depth >= 14 || $b - $a < 1e-7) {
                $result[] = $pa;

                return;
            }
            $mid = ($a + $b) / 2;
            $pm = $cast($mid);
            $dx = $pb['x'] - $pa['x'];
            $dy = $pb['y'] - $pa['y'];
            $length = $dx * $dx + $dy * $dy;
            $t = $length > 0 ? max(0, min(1, (($pm['x'] - $pa['x']) * $dx + ($pm['y'] - $pa['y']) * $dy) / $length)) : 0;
            if (hypot($pm['x'] - $pa['x'] - $t * $dx, $pm['y'] - $pa['y'] - $t * $dy) > .15) {
                $refine($a, $mid, $pa, $pm, $depth + 1);
                $refine($mid, $b, $pm, $pb, $depth + 1);
            } else {
                $result[] = $pa;
            }
        };
        foreach ($angles as $i => $angle) {
            $next = ($i + 1) % count($angles);
            $refine($angle, $next ? $angles[$next] : $angles[0] + 2 * M_PI, $points[$i], $points[$next]);
        }
        // Remove redundant straight-boundary samples without smoothing away apertures.
        $simple = [];
        foreach ($result as $p) {
            while (count($simple) >= 2) {
                $a = $simple[count($simple) - 2];
                $b = $simple[count($simple) - 1];
                $dx = $p['x'] - $a['x'];
                $dy = $p['y'] - $a['y'];
                $length = hypot($dx, $dy);
                if ($length < 1e-12 || abs(($b['x'] - $a['x']) * $dy - ($b['y'] - $a['y']) * $dx) / $length > 1e-8) {
                    break;
                }
                $t = (($b['x'] - $a['x']) * $dx + ($b['y'] - $a['y']) * $dy) / ($length * $length);
                if ($t < 0 || $t > 1) {
                    break;
                }
                array_pop($simple);
            }
            $simple[] = $p;
        }

        return $simple;
    }
}
