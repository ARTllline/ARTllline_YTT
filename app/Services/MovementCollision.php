<?php

namespace App\Services;

/** Continuous sweep of a circular token against compiled StructuralGeometry. */
class MovementCollision
{
    public function blocks(array $a, array $b, float $radius, array $shapes): bool
    {
        foreach ($shapes as $shape) {
            if (! $shape['blocksMovement']) {
                continue;
            }
            if ($shape['kind'] === 'band') {
                $start = $shape['a'];
                $end = $shape['b'];
                $padding = $shape['radius'];
                if (! $this->near($a, $b, [$start, $end], $radius + $padding)) {
                    continue;
                }
                foreach ([[$start, $shape['roundA']], [$end, $shape['roundB']]] as [$cap, $round]) {
                    if ($round && $this->pointDistance($cap, $a, $b) <= $radius + $padding) {
                        return true;
                    }
                }
                $angle = atan2($end['y'] - $start['y'], $end['x'] - $start['x']) + M_PI_2;
                $points = [$this->offset($start, $padding, $angle), $this->offset($end, $padding, $angle),
                    $this->offset($end, -$padding, $angle), $this->offset($start, -$padding, $angle)];
            } elseif ($shape['kind'] === 'ellipse') {
                $center = $shape['center'];
                if ($shape['radiusX'] === $shape['radiusY']) {
                    if ($this->pointDistance($center, $a, $b) <= $radius + $shape['radiusX']) {
                        return true;
                    }

                    continue;
                }
                if ($this->near($a, $b, [$center], $radius + max($shape['radiusX'], $shape['radiusY']))
                    && $this->ellipseHit($a, $b, $radius, $shape)) {
                    return true;
                }

                continue;
            } else {
                $points = $shape['points'];
                if (! $this->near($a, $b, $points, $radius)) {
                    continue;
                }
            }
            if ($this->polygonHit($a, $b, $radius, $points)) {
                return true;
            }
        }

        return false;
    }

    private function ellipseHit(array $a, array $b, float $radius, array $shape): bool
    {
        $angle = deg2rad($shape['rotation']);
        $local = static function ($point) use ($shape, $angle) {
            $x = $point['x'] - $shape['center']['x'];
            $y = $point['y'] - $shape['center']['y'];

            return ['x' => $x * cos($angle) + $y * sin($angle), 'y' => $y * cos($angle) - $x * sin($angle)];
        };
        $a = $local($a);
        $b = $local($b);
        $rx = $shape['radiusX'];
        $ry = $shape['radiusY'];
        $unit = static fn ($p) => ['x' => $p['x'] / $rx, 'y' => $p['y'] / $ry];
        if ($this->pointDistance(['x' => 0, 'y' => 0], $unit($a), $unit($b)) <= 1) {
            return true;
        }
        // An interior closest pair lies on the ellipse support line parallel to
        // the path. Otherwise the closest point on the path is an endpoint.
        $dx = $b['x'] - $a['x'];
        $dy = $b['y'] - $a['y'];
        $length = hypot($dx, $dy);
        if ($length > 0) {
            $nx = -$dy / $length;
            $ny = $dx / $length;
            $side = $a['x'] * $nx + $a['y'] * $ny;
            $support = hypot($rx * $nx, $ry * $ny);
            if (abs($side) >= $support && abs($side) - $support <= $radius) {
                $sign = $side < 0 ? -1 : 1;
                $x = $sign * $rx * $rx * $nx / $support;
                $y = $sign * $ry * $ry * $ny / $support;
                $along = (($x - $a['x']) * $dx + ($y - $a['y']) * $dy) / $length;
                if ($along >= 0 && $along <= $length) {
                    return true;
                }
            }
        }
        foreach ([$a, $b] as $point) {
            $x = $point['x'];
            $y = $point['y'];
            $low = 0;
            $high = hypot($rx * $x, $ry * $y);
            // For an exterior point the closest ellipse point is parameterized
            // by a single positive Lagrange multiplier with a monotone root.
            for ($i = 0; $i < 48; $i++) {
                $t = ($low + $high) / 2;
                if (hypot($rx * $x / ($rx * $rx + $t), $ry * $y / ($ry * $ry + $t)) > 1) {
                    $low = $t;
                } else {
                    $high = $t;
                }
            }
            if (hypot($x * $low / ($rx * $rx + $low), $y * $low / ($ry * $ry + $low)) <= $radius) {
                return true;
            }
        }

        return false;
    }

    private function near(array $a, array $b, array $points, float $padding): bool
    {
        foreach (['x', 'y'] as $axis) {
            $values = array_column($points, $axis);
            if (min($a[$axis], $b[$axis]) > max($values) + $padding
                || max($a[$axis], $b[$axis]) < min($values) - $padding) {
                return false;
            }
        }

        return true;
    }

    private function polygonHit(array $a, array $b, float $radius, array $points): bool
    {
        $inside = false;
        $previous = $points[count($points) - 1];
        foreach ($points as $point) {
            // Segment distance is zero at a crossing. Otherwise one of the four
            // endpoints realizes the closest distance, including collinear contact.
            if (StructuralGeometry::crosses($a + ['id' => 0], $b + ['id' => 1], $previous + ['id' => 2], $point + ['id' => 3])
                || min($this->pointDistance($a, $previous, $point), $this->pointDistance($b, $previous, $point),
                    $this->pointDistance($previous, $a, $b), $this->pointDistance($point, $a, $b)) <= $radius) {
                return true;
            }
            if (($point['y'] > $a['y']) !== ($previous['y'] > $a['y'])
                && $a['x'] < $point['x'] + ($previous['x'] - $point['x']) * ($a['y'] - $point['y']) / ($previous['y'] - $point['y'])) {
                $inside = ! $inside;
            }
            $previous = $point;
        }

        return $inside;
    }

    private function pointDistance(array $p, array $a, array $b): float
    {
        $dx = $b['x'] - $a['x'];
        $dy = $b['y'] - $a['y'];
        $x = $p['x'] - $a['x'];
        $y = $p['y'] - $a['y'];
        $length = $dx * $dx + $dy * $dy;
        $t = $length > 0 ? max(0, min(1, ($x * $dx + $y * $dy) / $length)) : 0;

        return hypot($x - $t * $dx, $y - $t * $dy);
    }

    private function offset(array $point, float $distance, float $angle): array
    {
        return ['x' => $point['x'] + $distance * cos($angle), 'y' => $point['y'] + $distance * sin($angle)];
    }
}
