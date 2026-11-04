<?php

namespace App\Services;

use App\Models\SceneProp;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class PropCollider
{
    public const FLAGS = ['blocksMovement', 'blocksVision', 'blocksLight'];

    public static function instancePatch(SceneProp $prop, array $patch): array
    {
        if (array_key_exists('collider', $patch)) {
            abort_unless($prop->preset_snapshot && ! $prop->is_locked && is_array($patch['collider']), 422,
                'Коллайдер доступен только у незаблокированного экземпляра пресета.');
            $patch['preset_snapshot'] = array_replace($prop->preset_snapshot, ['collider' => self::validate($patch['collider'])]);
            unset($patch['collider']);
        }

        return $patch;
    }

    public static function validate(array $input): array
    {
        $type = Validator::make($input, ['type' => 'required|in:none,rectangle,circle,polygon'])->validate()['type'];
        $coordinate = 'required|numeric|between:-16384,16384';
        $dimension = 'required|numeric|between:0.01,16384';
        $rules = ['type' => 'required|string'];
        foreach (self::FLAGS as $flag) {
            $rules[$flag] = 'required|boolean';
        }
        $rules += match ($type) {
            'rectangle' => ['x' => $coordinate, 'y' => $coordinate, 'width' => $dimension, 'height' => $dimension],
            'circle' => ['x' => $coordinate, 'y' => $coordinate, 'radius' => $dimension],
            'polygon' => ['points' => 'required|array|list|min:3|max:32', 'points.*' => 'required|array:x,y',
                'points.*.x' => $coordinate, 'points.*.y' => $coordinate],
            default => [],
        };
        $shape = Validator::make($input, $rules)->validate();
        foreach (self::FLAGS as $flag) {
            $shape[$flag] = (bool) $shape[$flag];
        }
        foreach (['x', 'y', 'width', 'height', 'radius'] as $field) {
            if (isset($shape[$field])) {
                $shape[$field] = round((float) $shape[$field], 4);
            }
        }
        if ($type === 'polygon') {
            $shape['points'] = array_map(fn ($point) => [
                'x' => round((float) $point['x'], 4), 'y' => round((float) $point['y'], 4),
            ], $shape['points']);
            self::validatePolygon($shape['points']);
        }

        return $shape;
    }

    private static function validatePolygon(array $points): void
    {
        $count = count($points);
        $area = 0;
        $fail = static fn () => throw ValidationException::withMessages([
            'collider' => 'Контур должен иметь площадь и не содержать совпадающих вершин или пересечений.',
        ]);
        $points = array_map(fn ($point, $id) => $point + ['id' => $id], $points, array_keys($points));
        for ($i = 0; $i < $count; $i++) {
            $a = $points[$i];
            $b = $points[($i + 1) % $count];
            if (hypot($a['x'] - $b['x'], $a['y'] - $b['y']) < 0.01) {
                $fail();
            }
            $area += $a['x'] * $b['y'] - $b['x'] * $a['y'];
            for ($j = $i + 1; $j < $count; $j++) {
                $c = $points[$j];
                if (hypot($a['x'] - $c['x'], $a['y'] - $c['y']) < 0.01
                    || StructuralGeometry::crosses($a, $b, $c, $points[($j + 1) % $count])) {
                    $fail();
                }
            }
        }
        if (abs($area) < 0.02) {
            $fail();
        }
    }

    public static function compile(SceneProp $prop): ?array
    {
        $snapshot = $prop->preset_snapshot;
        $shape = $snapshot['collider'] ?? null;
        if (! $shape || $shape['type'] === 'none') {
            return null;
        }
        $rotation = (float) $prop->rotation;
        $cos = cos(deg2rad($rotation));
        $sin = sin(deg2rad($rotation));
        $originX = $prop->x;
        $originY = $prop->y;
        $scaleX = $prop->scale_x;
        $scaleY = $prop->scale_y;
        $pivotX = $snapshot['width'] * $snapshot['pivotX'];
        $pivotY = $snapshot['height'] * $snapshot['pivotY'];
        $transform = static function ($x, $y) use ($originX, $originY, $scaleX, $scaleY, $pivotX, $pivotY, $cos, $sin) {
            $x = ($x - $pivotX) * $scaleX;
            $y = ($y - $pivotY) * $scaleY;

            return ['x' => $originX + $x * $cos - $y * $sin,
                'y' => $originY + $x * $sin + $y * $cos];
        };
        $world = match ($shape['type']) {
            'circle' => ['kind' => 'ellipse', 'center' => $transform($shape['x'], $shape['y']),
                'radiusX' => $shape['radius'] * $scaleX, 'radiusY' => $shape['radius'] * $scaleY,
                'rotation' => $rotation],
            'rectangle' => ['kind' => 'polygon', 'points' => [
                $transform($shape['x'], $shape['y']),
                $transform($shape['x'] + $shape['width'], $shape['y']),
                $transform($shape['x'] + $shape['width'], $shape['y'] + $shape['height']),
                $transform($shape['x'], $shape['y'] + $shape['height']),
            ]],
            'polygon' => ['kind' => 'polygon', 'points' => array_map(fn ($p) => $transform($p['x'], $p['y']), $shape['points'])],
        };

        return $world + ['id' => 'prop:'.$prop->id, 'propId' => (string) $prop->id,
            'source' => 'prop'] + array_intersect_key($shape, array_flip(self::FLAGS));
    }
}
