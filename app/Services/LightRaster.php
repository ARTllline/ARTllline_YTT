<?php

namespace App\Services;

/** Bounded scan conversion, independent of Fog's persisted territory format. */
class LightRaster
{
    public static function resample(string $bits, int $width, int $height, int $cell, int $outWidth, int $outHeight, int $outCell): string
    {
        $out = str_repeat("\0", (int) ceil($outWidth * $outHeight / 8));
        if (trim($bits, "\0") === '') {
            return $out;
        }
        $columns = [];
        for ($x = 0; $x < $outWidth; $x++) {
            $sample = (int) floor(($x + .5) * $outCell / $cell);
            if ($sample < $width) {
                $columns[] = $sample;
            }
        }
        for ($y = 0; $y < $outHeight; $y++) {
            $row = (int) floor(($y + .5) * $outCell / $cell);
            if ($row >= $height) {
                break;
            }
            $start = $row * $width;
            if (trim(substr($bits, intdiv($start, 8), intdiv($start + $width - 1, 8) - intdiv($start, 8) + 1), "\0") === '') {
                continue;
            }
            $target = $y * $outWidth;
            foreach ($columns as $x => $column) {
                $sample = $start + $column;
                if (ord($bits[$sample >> 3]) & (1 << ($sample & 7))) {
                    $index = $target + $x;
                    $byte = $index >> 3;
                    $out[$byte] = chr(ord($out[$byte]) | (1 << ($index & 7)));
                }
            }
        }

        return $out;
    }

    /** Byte RLE; bounded binary data, never geometry. Fall back to raw for noisy masks. */
    public static function encode(string $bits): string
    {
        $rle = '';
        for ($i = 0, $length = strlen($bits); $i < $length;) {
            $value = $bits[$i];
            $end = $i + 1;
            while ($end < $length && $bits[$end] === $value && $end - $i < 65535) {
                $end++;
            }
            $rle .= pack('vC', $end - $i, ord($value));
            $i = $end;
        }

        return strlen($rle) < strlen($bits) ? '~'.base64_encode($rle) : base64_encode($bits);
    }

    public static function polygons(array $polygons, int $width, int $height, float $cell): string
    {
        $bits = str_repeat("\0", (int) ceil($width * $height / 8));
        foreach ($polygons as $polygon) {
            if (count($polygon) < 3) {
                continue;
            }
            $first = max(0, (int) ceil(min(array_column($polygon, 'y')) / $cell - .5));
            $last = min($height - 1, (int) floor(max(array_column($polygon, 'y')) / $cell - .5));
            for ($y = $first; $y <= $last; $y++) {
                $scan = ($y + .5) * $cell;
                $crossings = [];
                $a = $polygon[count($polygon) - 1];
                foreach ($polygon as $b) {
                    if (($a['y'] > $scan) !== ($b['y'] > $scan)) {
                        $crossings[] = $a['x'] + ($scan - $a['y']) * ($b['x'] - $a['x']) / ($b['y'] - $a['y']);
                    }
                    $a = $b;
                }
                sort($crossings, SORT_NUMERIC);
                for ($i = 0; $i + 1 < count($crossings); $i += 2) {
                    $left = max(0, (int) ceil($crossings[$i] / $cell - .5));
                    $right = min($width - 1, (int) floor($crossings[$i + 1] / $cell - .5));
                    // Fill whole bytes in C; only the two partial bytes need bit operations.
                    $start = $y * $width + $left;
                    $end = $y * $width + $right;
                    while ($start <= $end && $start % 8) {
                        $byte = intdiv($start, 8);
                        $bits[$byte] = chr(ord($bits[$byte]) | (1 << ($start++ % 8)));
                    }
                    $bytes = max(0, intdiv($end - $start + 1, 8));
                    if ($bytes) {
                        $bits = substr_replace($bits, str_repeat("\xff", $bytes), intdiv($start, 8), $bytes);
                        $start += $bytes * 8;
                    }
                    while ($start <= $end) {
                        $byte = intdiv($start, 8);
                        $bits[$byte] = chr(ord($bits[$byte]) | (1 << ($start++ % 8)));
                    }
                }
            }
        }

        return $bits;
    }
}
