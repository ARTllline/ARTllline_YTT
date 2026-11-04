<?php

namespace App\Services;

use App\Models\SceneRegion;
use App\Models\Token;
use Illuminate\Support\Facades\Validator;

class RegionGeometry
{
    private const EPSILON = 1.0e-7;

    public static function validate(array $data): array
    {
        $data = Validator::make($data, ['name' => 'required|string|max:160', 'shape' => 'required|in:rectangle,circle', 'enabled' => 'required|boolean',
            'geometry' => 'required|array:x,y,width,height,radius', 'geometry.x' => 'required|numeric|between:-1000000,1000000',
            'geometry.y' => 'required|numeric|between:-1000000,1000000',
            'geometry.width' => 'required_if:shape,rectangle|numeric|between:10,100000', 'geometry.height' => 'required_if:shape,rectangle|numeric|between:10,100000',
            'geometry.radius' => 'required_if:shape,circle|numeric|between:5,50000'])->validate();
        $keys = $data['shape'] === 'circle' ? ['x', 'y', 'radius'] : ['x', 'y', 'width', 'height'];
        $data['geometry'] = array_map(fn ($v) => round((float) $v, 3), array_intersect_key($data['geometry'], array_flip($keys)));

        return $data;
    }

    /** Token discs intersect rectangles/circles; boundary contact counts as inside. */
    public static function contains(SceneRegion $region, Token $token): bool
    {
        $g = $region->geometry;
        $radius = $token->size * $token->scale / 2;
        if ($region->shape === 'circle') {
            return hypot($token->x - $g['x'], $token->y - $g['y']) <= $g['radius'] + $radius;
        }
        $x = max($g['x'], min($token->x, $g['x'] + $g['width']));
        $y = max($g['y'], min($token->y, $g['y'] + $g['height']));

        return hypot($token->x - $x, $token->y - $y) <= $radius;
    }

    /** Ordered transitions of a token disc along an already accepted polyline.
     * Boundary contact is inside, including a tangent (enter then exit).
     * Merge contact intervals across waypoints so a shared boundary fires once.
     */
    public static function crossings(SceneRegion $region, Token $token, array $path): array
    {
        $intervals = [];
        $distance = 0.0;
        $radius = TokenMovement::radius($token);
        for ($i = 1; $i < count($path); $i++) {
            $a = $path[$i - 1];
            $b = $path[$i];
            $length = hypot($b['x'] - $a['x'], $b['y'] - $a['y']);
            if ($length == 0) {
                continue;
            }
            $interval = self::contact($region, $a, $b, $radius);
            if ($interval !== null) {
                $start = $distance + $interval[0] * $length;
                $end = $distance + $interval[1] * $length;
                $last = count($intervals) - 1;
                if ($last >= 0 && $start <= $intervals[$last][1] + self::EPSILON) {
                    $intervals[$last][1] = max($end, $intervals[$last][1]);
                } else {
                    $intervals[] = [$start, $end];
                }
            }
            $distance += $length;
        }
        if ($distance == 0) {
            return [];
        }
        $events = [];
        foreach ($intervals as [$start, $end]) {
            if ($start > self::EPSILON) {
                $events[] = ['distance' => $start, 'type' => 'region.enter'];
            }
            if ($end < $distance - self::EPSILON) {
                $events[] = ['distance' => $end, 'type' => 'region.exit'];
            }
        }

        return $events;
    }

    /** A rectangle dilated by a disc has round corners, not square padding. */
    private static function contact(SceneRegion $region, array $a, array $b, float $radius): ?array
    {
        $g = $region->geometry;
        if ($region->shape === 'circle') {
            return self::disc($a, $b, $g['x'], $g['y'], $g['radius'] + $radius);
        }
        $x = $g['x'];
        $y = $g['y'];
        $right = $x + $g['width'];
        $bottom = $y + $g['height'];
        $pieces = [self::box($a, $b, $x - $radius, $y, $right + $radius, $bottom),
            self::box($a, $b, $x, $y - $radius, $right, $bottom + $radius)];
        foreach ([[$x, $y], [$right, $y], [$x, $bottom], [$right, $bottom]] as [$cx, $cy]) {
            $pieces[] = self::disc($a, $b, $cx, $cy, $radius);
        }
        $pieces = array_values(array_filter($pieces, fn ($piece) => $piece !== null));

        // The union is convex, so the clipped contact is one closed interval.
        return $pieces ? [min(array_column($pieces, 0)), max(array_column($pieces, 1))] : null;
    }

    private static function box(array $a, array $b, float $left, float $top, float $right, float $bottom): ?array
    {
        $low = 0.0;
        $high = 1.0;
        foreach (['x' => [$left, $right], 'y' => [$top, $bottom]] as $axis => [$min, $max]) {
            $delta = $b[$axis] - $a[$axis];
            if ($delta == 0) {
                if ($a[$axis] < $min || $a[$axis] > $max) {
                    return null;
                }

                continue;
            }
            $p = ($min - $a[$axis]) / $delta;
            $q = ($max - $a[$axis]) / $delta;
            $low = max($low, min($p, $q));
            $high = min($high, max($p, $q));
        }

        return $low <= $high ? [$low, $high] : null;
    }

    private static function disc(array $a, array $b, float $x, float $y, float $radius): ?array
    {
        $dx = $b['x'] - $a['x'];
        $dy = $b['y'] - $a['y'];
        $squared = $dx * $dx + $dy * $dy;
        $px = $x - $a['x'];
        $py = $y - $a['y'];
        $center = ($px * $dx + $py * $dy) / $squared;
        $perpendicular = abs($px * $dy - $py * $dx) / sqrt($squared);
        if ($perpendicular > $radius + self::EPSILON) {
            return null;
        }
        $half = sqrt(max(0, ($radius - $perpendicular) * ($radius + $perpendicular)) / $squared);
        $low = max(0.0, $center - $half);
        $high = min(1.0, $center + $half);

        return $low <= $high ? [$low, $high] : null;
    }
}
