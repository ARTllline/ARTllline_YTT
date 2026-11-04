<?php

namespace App\Services;

use App\Models\MapMaterialVersion;
use App\Models\Scene;
use Illuminate\Support\Facades\DB;

class TerrainData
{
    public function chunks(Scene $scene)
    {
        return DB::table('terrain_chunks')->where('map_world_id', $scene->mapWorld?->id ?? 0);
    }

    public function read(Scene $scene, string $key): array
    {
        [$x, $y] = array_map(intval(...), explode(':', $key));
        $chunk = $this->chunks($scene)->where('x', $x)->where('y', $y)->first();
        if (! $chunk) {
            return [];
        }

        return DB::table('terrain_masks')->where('terrain_chunk_id', $chunk->id)->orderBy('map_material_version_id')->get()
            ->mapWithKeys(fn ($m) => [(string) $m->map_material_version_id => gzuncompress(base64_decode($m->mask))])->all();
    }

    public function hash(array $layers): ?string
    {
        if (! $layers) {
            return null;
        }
        ksort($layers, SORT_NUMERIC);
        $bytes = '';
        foreach ($layers as $id => $mask) {
            $bytes .= $id.':'.$mask;
        }

        return hash('sha256', $bytes);
    }

    public function write(Scene $scene, string $key, array $layers): void
    {
        [$x, $y] = array_map(intval(...), explode(':', $key));
        $query = $this->chunks($scene)->where('x', $x)->where('y', $y);
        if (! $layers) {
            $query->delete();

            return;
        }
        $hash = $this->hash($layers);
        $id = $query->value('id');
        if (! $id) {
            $id = DB::table('terrain_chunks')->insertGetId(['map_world_id' => $scene->mapWorld->id, 'x' => $x, 'y' => $y, 'hash' => $hash]);
        } else {
            $query->update(['hash' => $hash]);
        }
        DB::table('terrain_masks')->where('terrain_chunk_id', $id)->delete();
        foreach ($layers as $version => $mask) {
            DB::table('terrain_masks')->insert(['terrain_chunk_id' => $id,
                'map_material_version_id' => $version, 'mask' => base64_encode(gzcompress($mask, 6))]);
        }
    }

    /** Compact manifest only. Masks travel over authorized HTTP, never through Reverb. */
    public function manifest(Scene $scene, bool $gm, ?array $keys = null): array
    {
        $chunks = $this->chunks($scene)->orderBy('y')->orderBy('x')->get();
        if ($keys !== null) {
            $chunks = $chunks->filter(fn ($c) => in_array($c->x.':'.$c->y, $keys, true));
        }
        $masks = DB::table('terrain_masks')->whereIn('terrain_chunk_id', $chunks->pluck('id'))->get(['terrain_chunk_id', 'map_material_version_id']);
        $versions = $masks->pluck('map_material_version_id')->unique();
        $materials = MapMaterialVersion::with('asset')->whereIn('id', $versions)->get()->map(fn ($v) => $gm ? $v->projection() : [
            'versionId' => (string) $v->id, 'asset' => app(SceneSnapshotBuilder::class)->asset($v->asset),
            'repeatSize' => $v->repeat_size, 'rotation' => $v->rotation, 'variation' => $v->variation])->all();
        $entries = $chunks->map(fn ($c) => ['key' => $c->x.':'.$c->y, 'hash' => $c->hash,
            'versions' => $masks->where('terrain_chunk_id', $c->id)->pluck('map_material_version_id')->map(strval(...))->values()->all()])->values()->all();
        if ($keys !== null) {
            foreach (array_diff($keys, array_column($entries, 'key')) as $key) {
                $entries[] = ['key' => $key, 'hash' => null];
            }
        }

        return ['chunks' => $entries, 'materials' => $materials];
    }
}
