<?php

namespace App\Services;

use App\Jobs\RefreshSceneLighting;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\User;
use App\Support\RequestPerformance;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Shared light geometry and the independent MAP-10A visual stream. */
class SceneLighting
{
    public const SOURCE_LIMIT = 16;

    private \WeakMap $fields;

    private array $roles = [];

    public function __construct()
    {
        $this->fields = new \WeakMap;
    }

    public function invalidate(Scene $scene): void
    {
        unset($this->fields[$scene]);
    }

    public static function defaults(): array
    {
        return ['enabled' => false, 'mode' => 'day', 'brightness' => 1.0, 'color' => '#ffffff', 'sources' => []];
    }

    public static function settings(Scene $scene, bool $gm): array
    {
        $settings = $scene->lighting ?? self::defaults();

        return $gm ? $settings : array_diff_key($settings, ['sources' => true]);
    }

    /** Shared render projection for snapshots, light reads and incremental publication. */
    public function render(Scene $scene, User $user): array
    {
        return app(RequestPerformance::class)->measure('lighting_projection', fn () => $this->project($scene, $user));
    }

    private function project(Scene $scene, User $user): array
    {
        $gm = ($this->roles[$scene->campaign_id.':'.$user->id] ??= $scene->campaign->roleFor($user)) === 'gm';
        $settings = self::settings($scene, $gm);
        $base = ['sceneId' => (string) $scene->id, 'revision' => $scene->revision, 'settings' => $settings];
        if (! $settings['enabled']) {
            return $base + ['sources' => [], 'width' => 1, 'height' => 1, 'cellSize' => 1];
        }
        $field = $this->fields[$scene] ??= $this->field($scene);
        extract($field);
        $view = ! $gm ? app(SceneVisibility::class)->view($scene, $user) : null;
        $current = ! $gm && $scene->vision_enabled
            ? app(SceneVisibility::class)->currentBits($scene, $user, $width, $height, $cell) : null;
        $sources = [];
        $spill = null;
        foreach ($entries as $entry) {
            $source = $entry['source'];
            $token = isset($source['tokenId']) ? $tokens->get($source['tokenId']) : null;
            if (! $gm && $token?->is_hidden) {
                continue;
            }
            $known = $gm || ! $token || $view['tokens']->contains('id', $token->id);
            // Static emitters also require current visibility before disclosing their center.
            if (! $gm && ! $token && $scene->vision_enabled) {
                $known = app(SceneVisibility::class)->seesPoint($scene, $user, $source);
            }
            $bits = $current === null ? $entry['bits'] : ($entry['bits'] & $current);
            if (! $known) {
                // Irradiance only: an unseen public emitter contributes no ID/center/shape.
                $this->spill($spill, $bits, $source, $width, $height, $cell);

                continue;
            }
            $sources[] = array_intersect_key($source, array_flip(['id', 'tokenId', 'radius', 'color', 'intensity', 'falloff', 'x', 'y'])) + ['mask' => LightRaster::encode($bits)];
        }

        return $base + ['sources' => $sources, 'width' => $width, 'height' => $height, 'cellSize' => $cell]
            + ($spill !== null ? ['spill' => base64_encode(gzcompress($spill, 1))] : []);
    }

    /** Current-authorized RGB pixels without an emitter definition or raw blocker. */
    private function spill(?string &$pixels, string $bits, array $source, int $width, int $height, float $cell): void
    {
        if (trim($bits, "\0") === '' || $source['intensity'] <= 0) {
            return;
        }
        $pixels ??= str_repeat("\0", $width * $height * 4);
        $color = array_map(fn ($offset) => hexdec(substr($source['color'], $offset, 2)), [1, 3, 5]);
        for ($byte = 0, $length = strlen($bits); $byte < $length; $byte++) {
            $value = ord($bits[$byte]);
            if (! $value) {
                continue;
            }
            for ($b = 0; $b < 8; $b++) {
                if (! ($value & (1 << $b))) {
                    continue;
                }
                $index = $byte * 8 + $b;
                if ($index >= $width * $height) {
                    break;
                }
                $x = ($index % $width + .5) * $cell;
                $y = (intdiv($index, $width) + .5) * $cell;
                $d = hypot($x - $source['x'], $y - $source['y']) / $source['radius'];
                if ($d >= 1) {
                    continue;
                }
                $weight = ((1 - $d * $d * (3 - 2 * $d)) ** $source['falloff']) * $source['intensity'];
                for ($channel = 0; $channel < 3; $channel++) {
                    $offset = $index * 4 + $channel;
                    $pixels[$offset] = chr(min(255, ord($pixels[$offset]) + (int) round($color[$channel] * $weight)));
                }
                $pixels[$index * 4 + 3] = "\xff";
            }
        }
    }

    /** Called once per immutable revision; unchanged emitters reuse their prior silhouette. */
    private function field(Scene $scene): array
    {
        [$width, $height, $cell] = self::dimensions($scene);
        $tokens = $scene->tokens()->get()->keyBy('id');
        $sources = $this->sources($scene, $tokens);
        $entries = $this->masks($scene, app(SceneVisibility::class)->compiledGeometry($scene), $sources, $width, $height, $cell);

        return compact('cell', 'width', 'height', 'tokens', 'entries');
    }

    public function sources(Scene $scene, \Illuminate\Support\Collection $tokens): array
    {
        $sources = [];
        foreach (($scene->lighting['sources'] ?? []) as $source) {
            if (! $source['enabled']) {
                continue;
            }
            $token = isset($source['tokenId']) ? $tokens->get($source['tokenId']) : null;
            if (isset($source['tokenId']) && ! $token) {
                continue;
            }
            $origin = $token ? ['x' => (float) $token->x, 'y' => (float) $token->y] : ['x' => $source['x'], 'y' => $source['y']];
            $sources[] = array_replace($source, $origin);
        }

        $remaining = self::SOURCE_LIMIT - count($sources);
        if ($remaining <= 0 || ! ($scene->lighting['enabled'] ?? false)) {
            return $sources;
        }
        $props = SceneProp::where('scene_id', $scene->id)->where('is_hidden', false)
            ->whereBetween('x', [0, $scene->width])->whereBetween('y', [0, $scene->height])
            ->whereNotNull('preset_snapshot->light')->orderBy('id')->limit($remaining)
            ->get(['id', 'name', 'x', 'y', 'preset_snapshot']);
        foreach ($props as $prop) {
            $sources[] = [
                // Colon keeps generated IDs distinct from manually supplied IDs.
                'id' => 'prop:'.$prop->id, 'name' => $prop->name, 'enabled' => true,
                'x' => (float) $prop->x, 'y' => (float) $prop->y,
            ] + $prop->preset_snapshot['light'];
        }

        return $sources;
    }

    /** The gameplay and visual passes use the same grid and cached light silhouettes. */
    public static function dimensions(Scene $scene): array
    {
        $cell = max(2, (int) ceil(max($scene->width, $scene->height) / 384));

        return [(int) ceil($scene->width / $cell), (int) ceil($scene->height / $cell), $cell];
    }

    public function masks(Scene $scene, array $compiled, array $sources, int $width, int $height, int $cell): array
    {
        if (! $sources) {
            return [];
        }
        $shapes = array_values(array_filter($compiled['shapes'], fn ($s) => $s['blocksLight'] ?? false));
        $geometryKey = hash('sha256', json_encode([$shapes, $scene->width, $scene->height]));
        $cacheKey = 'lighting-masks-v3:'.$scene->id;
        $cache = Cache::get($cacheKey, []);
        $ids = [...array_column($scene->lighting['sources'] ?? [], 'id'), ...array_column($sources, 'id')];
        $next = array_intersect_key($cache, array_flip($ids));
        $entries = [];
        $polygon = null;
        foreach ($sources as $source) {
            $origin = ['x' => $source['x'], 'y' => $source['y']];
            $key = hash('sha256', json_encode([$geometryKey, $origin, $source['radius']]));
            $entry = $cache[$source['id']] ?? null;
            if (($entry['key'] ?? null) !== $key) {
                $polygon ??= new VisibilityPolygon(['shapes' => $shapes], 'blocksLight');
                $points = app(RequestPerformance::class)->measure('lighting_polygon', fn () => $polygon->build($origin, $source['radius'], $scene->width, $scene->height));
                $entry = ['key' => $key, 'bits' => LightRaster::polygons([$points], $width, $height, $cell)];
            }
            $next[$source['id']] = $entry;
            $entries[] = ['source' => $source, 'bits' => $entry['bits']];
        }
        if ($next !== $cache) {
            Cache::put($cacheKey, $next, 300);
        }

        return $entries;
    }

    /** Queue metadata only. No light geometry, raster or DTO work on the command path. */
    public function schedule(Scene $scene, array $result, string $type): void
    {
        if (! ($scene->lighting['enabled'] ?? false) && ! isset($result['lighting'])) {
            return;
        }
        $sources = $scene->lighting['sources'] ?? [];
        $attached = array_filter(array_column($sources, 'tokenId'));
        $tokens = [...($result['tokens'] ?? []), ...(isset($result['token']) ? [$result['token']] : [])];
        $ids = [...array_column($tokens, 'id'), $result['deletedId'] ?? null];
        if (! isset($result['lighting']) && ! ($result['_lightingInvalidated'] ?? false)
            && $type !== 'vision.updated' && ! array_intersect($attached, $ids)) {
            return;
        }
        $sceneId = $scene->id;
        DB::afterCommit(static function () use ($sceneId) {
            try {
                RefreshSceneLighting::dispatch($sceneId);
            } catch (\Throwable $exception) {
                // An unavailable visual queue must not fail an already committed command.
                report($exception);
            }
        });
    }
}
