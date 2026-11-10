<?php

namespace App\Services;

/** Parametric wall axes; matches tabletop/structure/curves.ts. No persisted tessellation. */
class WallCurve
{
    public static function point(array $c, float $t): array
    {
        $a = deg2rad($c['start'] + $c['sweep'] * $t);
        $r = deg2rad($c['rotation']);
        $x = $c['rx'] * cos($a);
        $y = $c['ry'] * sin($a);

        return ['x' => round($c['cx'] + $x * cos($r) - $y * sin($r), 3),
            'y' => round($c['cy'] + $x * sin($r) + $y * cos($r), 3)];
    }

    public static function path(array $edge, array $vertices): array
    {
        if (! isset($edge['curve'])) {
            return [$vertices[$edge['a']], $vertices[$edge['b']]];
        }
        $c = $edge['curve'];
        $step = min(deg2rad(5), 2 * acos(1 - .25 / max($c['rx'], $c['ry'])));
        $count = max(1, (int) ceil(deg2rad(abs($c['sweep'])) / $step));
        $path = [];
        for ($i = 0; $i <= $count; $i++) {
            $path[] = $i === 0 ? $vertices[$edge['a']] : ($i === $count ? $vertices[$edge['b']] : self::point($c, $i / $count));
        }

        return $path;
    }

    public static function length(array $path): float
    {
        $length = 0;
        for ($i = 1; $i < count($path); $i++) {
            $length += hypot($path[$i]['x'] - $path[$i - 1]['x'], $path[$i]['y'] - $path[$i - 1]['y']);
        }

        return $length;
    }

    public static function along(array $path, float $offset): array
    {
        for ($i = 1; $i < count($path); $i++) {
            $a = $path[$i - 1];
            $b = $path[$i];
            $length = hypot($b['x'] - $a['x'], $b['y'] - $a['y']);
            if ($offset <= $length || $i === count($path) - 1) {
                $t = $offset / $length;

                return ['x' => $a['x'] + ($b['x'] - $a['x']) * $t, 'y' => $a['y'] + ($b['y'] - $a['y']) * $t];
            }
            $offset -= $length;
        }

        return $path[0];
    }

    public static function runs(array $edge, array $vertices, array $openings): array
    {
        $path = self::path($edge, $vertices);
        $length = self::length($path);
        $offsets = [0];
        for ($i = 1; $i < count($path); $i++) {
            $offsets[] = $offsets[$i - 1] + hypot($path[$i]['x'] - $path[$i - 1]['x'], $path[$i]['y'] - $path[$i - 1]['y']);
        }
        $runs = [];
        $solid = function ($start, $end, $roundA, $roundB) use (&$runs, $path, $offsets) {
            $points = [self::along($path, $start)];
            foreach ($path as $i => $p) {
                if ($offsets[$i] > $start + 1e-6 && $offsets[$i] < $end - 1e-6) {
                    $points[] = $p;
                }
            }
            $points[] = self::along($path, $end);
            for ($i = 1; $i < count($points); $i++) {
                if (hypot($points[$i]['x'] - $points[$i - 1]['x'], $points[$i]['y'] - $points[$i - 1]['y']) > 1e-6) {
                    $runs[] = ['a' => $points[$i - 1], 'b' => $points[$i],
                        'roundA' => $i > 1 || $roundA, 'roundB' => $i < count($points) - 1 || $roundB];
                }
            }
        };
        $start = 0;
        foreach ($openings as $opening) {
            $left = $opening['center'] * $length - $opening['width'] / 2;
            $right = $left + $opening['width'];
            $solid($start, $left, $start === 0, false);
            $runs[] = ['a' => self::along($path, $left), 'b' => self::along($path, $right),
                'roundA' => false, 'roundB' => false, 'opening' => $opening];
            $start = $right;
        }
        $solid($start, $length, $start === 0, true);

        return $runs;
    }

    public static function room(array $room, array $graph): array
    {
        $vertices = array_column($graph['vertices'], null, 'id');
        $edges = [];
        foreach ($graph['edges'] as $edge) {
            $edges[StructuralGeometry::pair($edge['a'], $edge['b'])] = $edge;
        }
        $path = [];
        foreach ($room['loop'] as $i => $a) {
            $b = $room['loop'][($i + 1) % count($room['loop'])];
            $edge = $edges[StructuralGeometry::pair($a, $b)];
            $points = self::path($edge, $vertices);
            array_push($path, ...array_slice($edge['a'] === $a ? $points : array_reverse($points), 0, -1));
        }

        return $path;
    }
}
