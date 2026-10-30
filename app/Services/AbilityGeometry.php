<?php

namespace App\Services;

use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\Token;

/** World-space geometry, measured with the scene ruler's Euclidean distance convention. */
class AbilityGeometry
{
    public function distance(Scene $scene, Token $a, Token|array $b): float
    {
        $x = $b instanceof Token ? $b->x : $b['x'];
        $y = $b instanceof Token ? $b->y : $b['y'];

        return hypot($x - $a->x, $y - $a->y) * (float) $scene->distance_per_cell / (float) $scene->grid_size;
    }

    public function validate(Scene $scene, array $ability, ?Token $actor, mixed $target, ?array $input): array
    {
        $area = $ability['area'] ?? null;
        $range = $ability['range'] ?? null;
        if (! $area && ! $range) {
            return [];
        }
        abort_unless($actor, 422, 'Нужен доступный токен персонажа на сцене.');
        $point = $target instanceof Token ? ['x' => $target->x, 'y' => $target->y] : $input;
        if ($ability['target'] === 'prop') {
            $prop = SceneProp::where('scene_id', $scene->id)->findOrFail($input['id']);
            $point = ['x' => $prop->x, 'y' => $prop->y];
        }
        if (in_array($ability['target'], ['self', 'none'])) {
            $point = ['x' => $actor->x, 'y' => $actor->y];
        }
        abort_unless(isset($point['x'], $point['y']) && is_finite((float) $point['x']) && is_finite((float) $point['y']), 422);
        $units = (float) $scene->distance_per_cell / (float) $scene->grid_size;
        $distance = $this->distance($scene, $actor, $point);
        $limit = $range['long'] ?? $range['normal'] ?? null;
        if ($limit !== null) {
            abort_if($distance > $limit + 0.00001, 422, 'Цель вне дальности способности.');
        }
        if (! $area || $area['shape'] === 'none') {
            return [];
        }
        abort_unless($ability['target'] === 'point', 422);
        abort_if(in_array($area['shape'], ['cone', 'line']) && $distance < 0.00001, 422, 'Выберите направление области.');

        return $scene->tokens()->with('character')->where('is_hidden', false)->orderBy('id')->get()
            ->filter(fn ($token) => ! (in_array($area['shape'], ['cone', 'line']) && $token->id === $actor->id)
                && $this->contains($area, ['x' => $actor->x, 'y' => $actor->y], $point, ['x' => $token->x, 'y' => $token->y], $units))
            ->all();
    }

    public function contains(array $area, array $origin, array $aim, array $point, float $units): bool
    {
        $shape = $area['shape'];
        if ($shape === 'circle') {
            return hypot($point['x'] - $aim['x'], $point['y'] - $aim['y']) * $units <= $area['size'] + 0.00001;
        }
        if ($shape === 'rectangle') {
            return abs($point['x'] - $aim['x']) * $units <= $area['size'] / 2 + 0.00001 && abs($point['y'] - $aim['y']) * $units <= $area['width'] / 2 + 0.00001;
        }
        $angle = atan2($aim['y'] - $origin['y'], $aim['x'] - $origin['x']);
        $dx = ($point['x'] - $origin['x']) * $units;
        $dy = ($point['y'] - $origin['y']) * $units;
        if ($shape === 'line') {
            $along = $dx * cos($angle) + $dy * sin($angle);
            $across = abs(-$dx * sin($angle) + $dy * cos($angle));

            return $along >= -0.00001 && $along <= $area['size'] + 0.00001 && $across <= $area['width'] / 2 + 0.00001;
        }
        $delta = atan2(sin(atan2($dy, $dx) - $angle), cos(atan2($dy, $dx) - $angle));

        return hypot($dx, $dy) <= $area['size'] + 0.00001 && abs($delta) <= M_PI / 6 + 0.00001;
    }
}
