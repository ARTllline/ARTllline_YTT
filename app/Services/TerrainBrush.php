<?php

namespace App\Services;

/** Version 1: world-space capsules, maximum influence per stroke (never FPS/dab accumulation). */
class TerrainBrush
{
    public const CHUNK = 256;

    public const SIZE = 128;

    public const MAX_POINTS = 8192;

    public const MAX_CHUNKS = 256;

    public function coverage(array $stroke, int $width, int $height, ?array $include = null): array
    {
        $chunks = [];
        $minima = [];
        $segments = [];
        $work = 0;
        $radius = $stroke['size'] / 2;
        $feather = $radius * ($stroke['softness'] / 255);
        $strength = (int) $stroke['strength'];
        $alpha = static function (float $distance) use ($radius, $feather, $strength): int {
            $quantized = floor($distance * 256 + 0.5) / 256;
            if ($quantized >= $radius) {
                return 0;
            }

            return (int) floor($strength * ($feather ? min(1, ($radius - $quantized) / $feather) : 1) + 0.5);
        };
        $cutoff = [];
        if ($radius >= 256 && $feather) {
            for ($old = 0; $old < $strength; $old++) {
                $lo = 0;
                $hi = (int) ($radius * 256);
                while ($lo < $hi) {
                    $mid = intdiv($lo + $hi, 2);
                    if ($alpha($mid / 256) > $old) {
                        $lo = $mid + 1;
                    } else {
                        $hi = $mid;
                    }
                }
                $cutoff[$old] = ($lo - 0.5) / 256;
            }
        }
        $maxX = intdiv($width - 2, 2);
        $maxY = intdiv($height - 2, 2);

        foreach ($stroke['points'] as $i => $b) {
            $a = $stroke['points'][max(0, $i - 1)];
            $ends = [$a['x'].','.$a['y'], $b['x'].','.$b['y']];
            sort($ends, SORT_STRING);
            $segment = implode(':', $ends);
            if (isset($segments[$segment])) {
                continue;
            }
            abort_if($work >= 24000000, 422, 'Достигнут предел вычислений мазка.');
            $segments[$segment] = true;
            $dx = $b['x'] - $a['x'];
            $dy = $b['y'] - $a['y'];
            $length = $dx * $dx + $dy * $dy;
            $distance = static function (float $x, float $y) use ($a, $dx, $dy, $length): float {
                $t = $length ? max(0, min(1, (($x - $a['x']) * $dx + ($y - $a['y']) * $dy) / $length)) : 0;
                $ox = $x - $a['x'] - $t * $dx;
                $oy = $y - $a['y'] - $t * $dy;

                return sqrt($ox * $ox + $oy * $oy);
            };

            $firstY = max(0, (int) floor((min($a['y'], $b['y']) - $radius) / 16));
            $lastY = min(intdiv($maxY, 8), (int) floor((max($a['y'], $b['y']) + $radius) / 16));
            for ($by = $firstY; $by <= $lastY; $by++) {
                $t1 = $dy ? ($by * 16 - $radius - $a['y']) / $dy : 0;
                $t2 = $dy ? ($by * 16 + 16 + $radius - $a['y']) / $dy : 1;
                $start = $a['x'] + $dx * max(0, min(1, min($t1, $t2)));
                $end = $a['x'] + $dx * max(0, min(1, max($t1, $t2)));
                $firstX = max(0, (int) floor((min($start, $end) - $radius) / 16));
                $lastX = min(intdiv($maxX, 8), (int) floor((max($start, $end) + $radius) / 16));
                for ($bx = $firstX; $bx <= $lastX; $bx++) {
                    $work++;
                    if ($bx === $firstX || $bx % 16 === 0) {
                        $key = intdiv($bx, 16).':'.intdiv($by, 16);
                    }
                    if ($include !== null && ! isset($include[$key])) {
                        continue;
                    }
                    $block = ($by % 16) * 16 + $bx % 16;
                    $previous = isset($minima[$key]) ? ord($minima[$key][$block]) : 0;
                    if ($previous === $strength) {
                        continue;
                    }
                    // The farthest sample is sqrt(7² + 7²) from the block centre.
                    $cx = $bx * 16 + 8 - $a['x'];
                    $cy = $by * 16 + 8 - $a['y'];
                    $t = $length ? max(0, min(1, ($cx * $dx + $cy * $dy) / $length)) : 0;
                    $ox = $cx - $t * $dx;
                    $oy = $cy - $t * $dy;
                    $center = sqrt($ox * $ox + $oy * $oy);
                    $upper = $alpha(max(0, $center - 9.9));
                    if ($upper <= $previous) {
                        continue;
                    }
                    $uniform = $alpha($center + 9.9) === $upper;
                    $xEnd = min(7, $maxX - $bx * 8);
                    $yEnd = min(7, $maxY - $by * 8);
                    $offset = ($by % 16) * 8 * 128 + ($bx % 16) * 8;
                    $minimum = $strength;
                    $changed = false;
                    $work += intdiv(($xEnd + 1) * ($yEnd + 1) + 7, 8);
                    // The supporting plane of the convex distance function is a per-sample lower bound.
                    $nx = $cutoff && $center ? $ox / $center : 0;
                    $ny = $cutoff && $center ? $oy / $center : 0;
                    for ($y = 0; $y <= $yEnd; $y++) {
                        $row = $offset + $y * 128;
                        for ($x = 0; $x <= $xEnd; $x++) {
                            $old = isset($chunks[$key]) ? ord($chunks[$key][$row + $x]) : 0;
                            $value = $old;
                            if ($old < $upper && ($uniform || ! $cutoff || ! $old
                                    || $center + $nx * ($x * 2 - 7) + $ny * ($y * 2 - 7) < $cutoff[$old] + 1e-7)) {
                                if (! $uniform) {
                                    $work++;
                                }
                                $value = max($old, $uniform ? $upper : $alpha($distance($bx * 16 + $x * 2 + 1, $by * 16 + $y * 2 + 1)));
                                if ($value > $old) {
                                    if (! isset($chunks[$key])) {
                                        abort_if(count($chunks) >= self::MAX_CHUNKS, 422, 'Достигнут предел 256 участков покрытия.');
                                        $chunks[$key] = str_repeat("\0", 16384);
                                        $minima[$key] = str_repeat("\0", 256);
                                    }
                                    $chunks[$key][$row + $x] = chr($value);
                                    $changed = true;
                                }
                            }
                            $minimum = min($minimum, $value);
                        }
                    }
                    if ($changed) {
                        $minima[$key][$block] = chr($minimum);
                    }
                }
            }
        }

        return $chunks;
    }

    public function apply(array $layers, string $coverage, array $stroke): array
    {
        $target = (int) ($stroke['materialVersionId'] ?? 0);
        $painting = $stroke['operation'] === 'paint';
        if (! $layers) {
            return $painting ? [$target => $coverage] : [];
        }
        if ($painting) {
            $layers[$target] ??= str_repeat("\0", 16384);
        }
        ksort($layers, SORT_NUMERIC);
        // Material weights are premultiplied coverage. Paint replaces a fraction of ALL weights.
        for ($i = 0; $i < 16384; $i++) {
            $a = ord($coverage[$i]);
            if (! $a) {
                continue;
            }
            $retained = 255 - $a;
            $total = 0;
            $sum = 0;
            $largest = -1;
            $recipient = $target;
            foreach ($layers as $id => &$mask) {
                $weight = ord($mask[$i]);
                if (! $painting && $weight > $largest) {
                    $largest = $weight;
                    $recipient = $id;
                }
                $total += $weight;
                $value = intdiv($weight * $retained, 255);
                if ($painting && $id === $target) {
                    $value += $a;
                }
                $mask[$i] = chr($value);
                $sum += $value;
            }
            unset($mask);
            $desired = intdiv($total * $retained, 255) + ($painting ? $a : 0);
            $layers[$recipient][$i] = chr(ord($layers[$recipient][$i]) + $desired - $sum);
        }

        return array_filter($layers, fn ($mask) => trim($mask, "\0") !== '');
    }
}
