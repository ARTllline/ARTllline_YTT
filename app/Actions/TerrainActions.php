<?php

namespace App\Actions;

use App\Models\MapMaterialVersion;
use App\Models\Scene;
use App\Models\User;
use App\Services\TerrainBrush;
use App\Services\TerrainData;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

class TerrainActions
{
    public function execute(User $user, Scene $scene, array $input, bool $history = false): array
    {
        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $input, $history) {
            Gate::forUser($user)->authorize('update', $scene);
            abort_unless($scene->mapWorld?->schema_version === 1, 409, 'Сначала создайте MapWorld.');
            $data = app(TerrainData::class);
            $before = [];
            if ($history) {
                $validated = Validator::make($input, ['expected' => 'required|array|min:1|max:'.(TerrainBrush::MAX_CHUNKS + 1),
                    'value.snapshot' => 'required|string|max:1500000'])->validate();
                try {
                    $saved = json_decode(gzuncompress(base64_decode(Crypt::decryptString($validated['value']['snapshot']))), true, 512, JSON_THROW_ON_ERROR);
                } catch (\Throwable) {
                    abort(422, 'Некорректная история покрытия.');
                }
                // Undo-create / Redo-create gives the same Scene a new foundation PK.
                // Scene scope, current format/bounds and touched hashes remain authoritative.
                abort_unless($saved['scene'] === $scene->id, 422);
                $next = [];
                foreach ($saved['chunks'] as $key => $layers) {
                    $next[$key] = array_map(hex2bin(...), $layers);
                }
                $expected = $validated['expected'];
            } else {
                $stroke = Validator::make($input, [
                    'operation' => 'required|in:paint,erase', 'materialVersionId' => 'required_if:operation,paint|nullable|integer|min:1',
                    'size' => 'required|integer|between:4,1024', 'softness' => 'required|integer|between:0,255',
                    'strength' => 'required|integer|between:1,255', 'points' => 'required|array|list|min:1|max:'.TerrainBrush::MAX_POINTS,
                    'expected' => 'required|array|min:1|max:'.TerrainBrush::MAX_CHUNKS,
                    'expected.*' => 'nullable|string|size:64',
                ])->validate();
                // Wildcard expansion repeatedly copies the entire validation input on long polylines.
                foreach ($stroke['points'] as &$p) {
                    abort_unless(is_array($p) && count($p) === 2
                        && is_numeric($p['x'] ?? null) && is_numeric($p['y'] ?? null)
                        && $p['x'] >= 0 && $p['x'] <= $scene->width
                        && $p['y'] >= 0 && $p['y'] <= $scene->height, 422, 'Некорректные координаты мазка.');
                    $p = ['x' => floor($p['x'] * 4 + 0.5) / 4, 'y' => floor($p['y'] * 4 + 0.5) / 4];
                }
                unset($p);
                if ($stroke['operation'] === 'paint') {
                    $version = MapMaterialVersion::with('material')->lockForUpdate()->findOrFail($stroke['materialVersionId']);
                    abort_unless($version->material->builtin_key || $version->material->user_id === $user->id, 403);
                    abort_if($version->type === 'wall', 422, 'Выберите материал поверхности.');
                }
                $expected = $stroke['expected'];
                $hashes = $data->chunks($scene)->get(['x', 'y', 'hash'])
                    ->mapWithKeys(fn ($chunk) => [$chunk->x.':'.$chunk->y => $chunk->hash])->all();
                // A stale large stroke should fail before taking the raster budget under the scene lock.
                foreach ($expected as $key => $hash) {
                    abort_unless(($hashes[$key] ?? null) === $hash, 409, 'Покрытие изменилось в другом окне. Повторите мазок.');
                }
                $include = $stroke['operation'] === 'erase' ? $hashes : null;
                $brush = app(TerrainBrush::class);
                $coverage = $brush->coverage($stroke, $scene->width, $scene->height, $include);

                $next = [];
                foreach ($coverage as $key => $mask) {
                    $before[$key] = $data->read($scene, $key);
                    $next[$key] = $brush->apply($before[$key], $mask, $stroke);
                }
                abort_unless($coverage, 422, 'Мазок не затронул карту.');
            }
            foreach ($next as $key => $layers) {
                $before[$key] ??= $data->read($scene, $key);
                abort_unless(array_key_exists($key, $expected) && $data->hash($before[$key]) === $expected[$key], 409, 'Покрытие изменилось в другом окне. Повторите мазок.');
                abort_if(count($layers) > 8, 422, 'На одном участке допускается до 8 материалов. Сотрите лишнее покрытие.');
                if (! $history) {
                    continue;
                }
                // History can outlive a bounds change or a removed, unused material version.
                foreach ($layers as $version => $mask) {
                    abort_unless(MapMaterialVersion::whereKey($version)->exists(), 409, 'Материал истории удалён.');
                    [$cx, $cy] = array_map(intval(...), explode(':', $key));
                    for ($i = 0; $i < 16384; $i++) {
                        if (ord($mask[$i]) && ($cx * 256 + ($i % 128) * 2 + 1 >= $scene->width || $cy * 256 + intdiv($i, 128) * 2 + 1 >= $scene->height)) {
                            abort(409, 'Покрытие истории выходит за границы карты.');
                        }
                    }
                }
            }
            foreach ($next as $key => $layers) {
                if ($layers !== $before[$key]) {
                    $data->write($scene, $key, $layers);
                }
            }
            abort_if($data->chunks($scene)->count() > 256, 422, 'Достигнут предел 256 участков покрытия.');
            $versionCount = DB::table('terrain_masks')->whereIn('terrain_chunk_id', $data->chunks($scene)->select('id'))->distinct()->count('map_material_version_id');
            abort_if($versionCount > 32, 422, 'На карте допускается до 32 версий материалов.');

            return ['terrain' => $data->manifest($scene, true, array_keys($next)),
                'terrainEdit' => ['before' => $this->capture($scene, $before), 'after' => $this->capture($scene, $next)]];
        }, 'terrain.updated');
    }

    private function capture(Scene $scene, array $chunks): array
    {
        $hashes = [];
        foreach ($chunks as $key => &$layers) {
            $hashes[$key] = app(TerrainData::class)->hash($layers);
            $layers = array_map(bin2hex(...), $layers);
        }
        unset($layers);

        $snapshot = Crypt::encryptString(base64_encode(gzcompress(json_encode([
            'scene' => $scene->id, 'chunks' => $chunks]), 6)));
        abort_if(strlen($snapshot) > 1500000, 422, 'История мазка слишком велика. Рисуйте меньшими участками.');

        return ['hashes' => $hashes, 'snapshot' => $snapshot];
    }
}
