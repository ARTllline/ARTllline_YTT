<?php

namespace App\Services;

use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\Token;
use App\Models\User;
use App\Spells\SpellEffects;
use App\Support\RequestPerformance;

/** Request-scoped, revision-keyed authority. No private geometry leaves this service. */
class SceneVisibility
{
    private array $contexts = [];

    private array $views = [];

    private array $masks = [];
    private array $rasters = [];

    private array $projections = [];

    private array $polygons = [];

    /** A retried DB transaction may reuse a revision with different accepted state. */
    public function invalidate(Scene $scene): void
    {
        $key = $scene->id.':'.$scene->revision;
        unset($this->contexts[$key], $this->polygons[$key]);
        foreach (['views', 'masks', 'rasters', 'projections'] as $property) {
            foreach (array_keys($this->{$property}) as $entry) {
                if (str_starts_with($entry, $key.':')) {
                    unset($this->{$property}[$entry]);
                }
            }
        }
    }

    private function context(Scene $scene): array
    {
        $key = $scene->id.':'.$scene->revision;

        return $this->contexts[$key] ??= (function () use ($scene) {
            $compiled = $scene->vision_enabled ? StructuralGeometry::forScene($scene) : ['shapes' => []];

            $tokens = $scene->tokens()->with(['character.portraitAsset', 'character.inventory.definition', 'imageAsset', 'conditions'])->orderBy('z_index')->orderBy('id')->get();
            foreach ($tokens as $token) {
                $token->setRelation('scene', $scene);
            }

            return ['los' => new LineOfSight($compiled), 'compiled' => $compiled,
                'illumination' => new SceneIllumination($scene, $compiled, $tokens->keyBy('id')),
                'tokens' => $tokens,
                'props' => $scene->props()->with('asset')->orderBy('z_index')->orderBy('id')->get()];
        })();
    }

    /** Internal render projection reuses the immutable compiled geometry, never its DTO. */
    public function compiledGeometry(Scene $scene): array
    {
        return $scene->vision_enabled ? $this->context($scene)['compiled'] : StructuralGeometry::forScene($scene);
    }

    /** Server-only fingerprint: projection filtering must not look like an obstacle edit. */
    public function movementGeometryKey(Scene $scene): string
    {
        $shapes = array_values(array_filter($this->context($scene)['compiled']['shapes'], fn ($s) => $s['blocksMovement'] ?? false));
        $shapes = array_map(fn ($s) => array_diff_key($s, array_flip(['blocksVision', 'blocksLight'])), $shapes);

        return hash('sha256', json_encode([$scene->width, $scene->height, (bool) $scene->mapWorld,
            app(SceneSnapshotBuilder::class)->grid($scene), $shapes], JSON_THROW_ON_ERROR));
    }

    public function view(Scene $scene, User $user): array
    {
        return app(RequestPerformance::class)->measure('vision_view', fn () => $this->viewMeasured($scene, $user));
    }

    private function viewMeasured(Scene $scene, User $user): array
    {
        $key = $scene->id.':'.$scene->revision.':'.$user->id;

        return $this->views[$key] ??= (function () use ($scene, $user) {
            $ctx = $this->context($scene);
            $observers = $ctx['tokens']->filter(fn ($t) => ! $t->is_hidden && $t->owner_user_id === $user->id && $t->kind === 'player_character');
            $eyes = $observers->map(fn ($token) => $this->eyes($scene, $token))->values()->all();
            $nearby = $litEyes = [];
            if ($ctx['illumination']->ambient === SceneIllumination::DARKNESS) {
                foreach ($eyes as $i => $eye) {
                    foreach ($ctx['illumination']->nearbySources($eye) as $source) {
                        $nearby[$source['id']] = $source;
                        $litEyes[$i] = true;
                    }
                }
            }
            $pointVisible = fn (array $point, ?string $self = null) => ! $scene->vision_enabled || $this->pointVisible($ctx, $eyes, $point, $self);
            $tokens = $ctx['tokens']->filter(fn ($t) => ! $t->is_hidden && ($observers->contains('id', $t->id) || $pointVisible(['x' => (float) $t->x, 'y' => (float) $t->y])))->values();
            $props = $ctx['props']->filter(fn ($p) => ! $p->is_hidden && $pointVisible(['x' => (float) $p->x, 'y' => (float) $p->y], 'prop:'.$p->id))->values();
            $signature = hash('sha256', json_encode([$scene->vision_enabled, $scene->fog_memory_policy, $scene->width, $scene->height, $ctx['los']->geometryKey,
                $eyes, $ctx['illumination']->signature($nearby)]));

            return compact('tokens', 'props', 'observers', 'eyes', 'litEyes', 'signature');
        })();
    }

    private function eyes(Scene $scene, Token $token): array
    {
        $feet = app(CharacterRules::class)->darkvisionFeet($token->character);
        $distance = $feet * match ($scene->distance_unit) {
            'm' => .3048,
            'squares' => .2,
            default => 1,
        };
        $range = (float) $token->vision_range;

        return ['origin' => ['x' => (float) $token->x, 'y' => (float) $token->y], 'range' => $range,
            'darkvision' => min($range, $distance * ($scene->grid_size ?? 60) / ($scene->distance_per_cell ?: 5))];
    }

    public function seesPoint(Scene $scene, User $user, array $point): bool
    {
        return ! $scene->vision_enabled || $this->pointVisible($this->context($scene), $this->view($scene, $user)['eyes'], $point);
    }

    /** Effective SRD light for an explicitly sight-dependent rule, or null on legacy scenes. */
    public function perceivedLight(Scene $scene, Token $observer, array $point, ?string $self = null): ?int
    {
        if (! $scene->vision_enabled || ! ($scene->lighting['enabled'] ?? false)) {
            return null;
        }
        $ctx = $this->context($scene);
        ['origin' => $origin, 'range' => $range, 'darkvision' => $darkvision] = $this->eyes($scene, $observer);
        $hit = $ctx['los']->point($origin, $point, $range);
        if (! $hit['visible']) {
            $front = $self && $hit['reason'] === 'blocked' ? $this->propFront($ctx['los'], $origin, $point, $range, $self) : null;
            if ($front === null) {
                return SceneIllumination::DARKNESS;
            }
            [$point, $hit['distance']] = $front;
        }
        $level = $ctx['illumination']->level($point);

        return min(SceneIllumination::BRIGHT, $level + (int) ($darkvision > 0 && $hit['distance'] <= $darkvision + LineOfSight::EPSILON));
    }

    private function pointVisible(array $ctx, array $eyes, array $point, ?string $self = null): bool
    {
        $light = null;
        foreach ($eyes as ['origin' => $origin, 'range' => $range, 'darkvision' => $darkvision]) {
            $hit = $ctx['los']->point($origin, $point, $range);
            if ($hit['visible']) {
                if ($ctx['illumination']->ambient !== SceneIllumination::DARKNESS
                    || ($darkvision > 0 && $hit['distance'] <= $darkvision + LineOfSight::EPSILON)
                    || ($light ??= $ctx['illumination']->level($point)) > SceneIllumination::DARKNESS) {
                    return true;
                }
            } elseif ($self && $hit['reason'] === 'blocked') {
                // Preserve the prop's front surface without testing light through its own collider.
                $front = $this->propFront($ctx['los'], $origin, $point, $range, $self);
                if ($front === null) {
                    continue;
                }
                [$frontPoint, $distance] = $front;
                if (($darkvision > 0 && $distance <= $darkvision + LineOfSight::EPSILON)
                    || $ctx['illumination']->level($frontPoint) > SceneIllumination::DARKNESS) {
                    return true;
                }
            }
        }

        return false;
    }

    private function propFront(LineOfSight $los, array $origin, array $point, float $range, string $self): ?array
    {
        $blocker = $los->point($origin, $point, $range, true)['blocker'];
        if ($blocker['id'] !== $self) {
            return null;
        }
        $front = $blocker['point'];
        $distance = hypot($front['x'] - $origin['x'], $front['y'] - $origin['y']);
        $offset = min(1, .001 / max(.001, $distance));

        return [['x' => $front['x'] + ($origin['x'] - $front['x']) * $offset, 'y' => $front['y'] + ($origin['y'] - $front['y']) * $offset], $distance];
    }

    public function allows(Token|SceneProp $object, User $user): bool
    {
        $scene = $object->scene;
        $role = $scene->campaign->roleFor($user);
        if ($role === 'gm') {
            return true;
        }
        if ($role !== 'player' || $scene->campaign->active_scene_id !== $scene->id) {
            return false;
        }
        if ($object->is_hidden) {
            return false;
        }
        if (! $scene->vision_enabled) {
            return true;
        }

        return $this->view($scene, $user)[$object instanceof Token ? 'tokens' : 'props']->contains('id', $object->id);
    }

    public function currentMask(Scene $scene, User $user): array
    {
        return app(RequestPerformance::class)->measure('vision_mask', fn () => $this->currentMaskMeasured($scene, $user));
    }

    private function currentMaskMeasured(Scene $scene, User $user): array
    {
        if (! $scene->vision_enabled) {
            return ['enabled' => false, 'polygons' => []];
        }
        $key = $scene->id.':'.$scene->revision;
        if (isset($this->masks[$key.':'.$user->id])) {
            return $this->masks[$key.':'.$user->id];
        }
        $ctx = $this->context($scene);
        $polygon = $this->polygons[$key] ??= new VisibilityPolygon($ctx['compiled']);

        ['eyes' => $eyes, 'litEyes' => $litEyes] = $this->view($scene, $user);
        $build = fn ($origin, $range) => app(RequestPerformance::class)->measure('los_polygon', fn () => $polygon->build($origin, $range, $scene->width, $scene->height));
        if ($ctx['illumination']->ambient !== SceneIllumination::DARKNESS) {
            return $this->masks[$key.':'.$user->id] = ['enabled' => true, 'polygons' => array_map(fn ($eye) => $build($eye['origin'], $eye['range']), $eyes)];
        }

        [$width, $height, $cell] = SceneLighting::dimensions($scene);
        $empty = str_repeat("\0", (int) ceil($width * $height / 8));
        $lit = $litEyes ? $ctx['illumination']->bits() : $empty;
        $normal = $darkvision = [];
        foreach ($eyes as $i => ['origin' => $origin, 'range' => $range, 'darkvision' => $darkRange]) {
            if (isset($litEyes[$i])) {
                $normal[$i] = $build($origin, $range);
            }
            if ($darkRange > 0) {
                $darkvision[] = ($darkRange === $range ? ($normal[$i] ?? null) : null) ?? $build($origin, $darkRange);
            }
        }
        $visibleLight = LightRaster::polygons($normal, $width, $height, $cell) & $lit;
        $visibleDark = LightRaster::polygons($darkvision, $width, $height, $cell) & ~$visibleLight;
        $this->rasters[$key.':'.$user->id] = $bits = $visibleLight | $visibleDark;
        $raster = ['width' => $width, 'height' => $height, 'cellSize' => $cell, 'bits' => LightRaster::encode($bits)];
        if (trim($visibleDark, "\0") !== '') {
            $raster['darkvision'] = LightRaster::encode($visibleDark);
        }

        return $this->masks[$key.':'.$user->id] = ['enabled' => true, 'polygons' => [], 'raster' => $raster];
    }

    public function currentBits(Scene $scene, User $user, int $width, int $height, int $cell): string
    {
        $mask = $this->currentMask($scene, $user);
        if (! isset($mask['raster'])) {
            return LightRaster::polygons($mask['polygons'], $width, $height, $cell);
        }
        $bits = $this->rasters[$scene->id.':'.$scene->revision.':'.$user->id];
        $raster = $mask['raster'];

        return $raster['cellSize'] === $cell ? $bits : LightRaster::resample($bits, $raster['width'], $raster['height'], $raster['cellSize'], $width, $height, $cell);
    }

    public function mask(Scene $scene, User $user): array
    {
        $mask = $this->currentMask($scene, $user);

        return $scene->vision_enabled && app(RequestPerformance::class)->exploration ? $mask + ['explored' => app(FogExploration::class)->projection($scene, $user)] : $mask;
    }

    public function projection(Scene $scene, User $user): array
    {
        return app(RequestPerformance::class)->measure('vision_projection', fn () => $this->projectionMeasured($scene, $user));
    }

    private function projectionMeasured(Scene $scene, User $user): array
    {
        $key = $scene->id.':'.$scene->revision.':'.$user->id;
        if (isset($this->projections[$key])) {
            return $this->projections[$key];
        }
        $view = $this->view($scene, $user);

        return $this->projections[$key] = app(SpellEffects::class)->project(fn () => ['tokens' => $view['tokens']->map(fn ($t) => app(SceneSnapshotBuilder::class)->token($t, false, $user))->all(),
            'props' => $view['props']->map(fn ($p) => $p->projection(false))->all(),
            'viewSignature' => $view['signature'],
            'signature' => hash('sha256', $view['signature'].json_encode(app(FogExploration::class)->projection($scene, $user)))]);
    }

    /** Only changed/revealed entities and previously delivered IDs are sent. */
    public function delta(Scene $scene, User $user, array $before): array
    {
        $after = $this->projection($scene, $user);
        $delta = [];
        foreach (['tokens' => 'deletedIds', 'props' => 'deletedPropIds'] as $kind => $deleted) {
            $old = array_column($before[$kind] ?? [], null, 'id');
            $new = array_column($after[$kind], null, 'id');
            $delta[$kind] = array_values(array_filter($new, fn ($value) => ($old[$value['id']] ?? null) !== $value));
            $delta[$deleted] = array_values(array_map(strval(...), array_diff(array_keys($old), array_keys($new))));
        }
        if (($before['signature'] ?? null) !== $after['signature']) {
            $delta['vision'] = $this->mask($scene, $user);
        }

        return $delta;
    }
}
