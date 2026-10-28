<?php

namespace App\Services;

use App\Models\SceneRegion;
use App\Models\Token;
use Illuminate\Support\Facades\Validator;

class RegionGeometry
{
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
}
