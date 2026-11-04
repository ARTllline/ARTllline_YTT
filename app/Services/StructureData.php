<?php

namespace App\Services;

use App\Models\MapMaterialVersion;
use App\Models\Scene;
use Illuminate\Support\Facades\DB;

class StructureData
{
    public static function graph(Scene $scene): array
    {
        return $scene->mapWorld?->structure ?? ['vertices' => [], 'edges' => [], 'rooms' => []];
    }

    public static function hash(array $graph): string
    {
        ksort($graph);
        foreach ($graph as &$entities) {
            foreach ($entities as &$entity) {
                ksort($entity);
            }
        }

        return hash('sha256', json_encode($graph, JSON_THROW_ON_ERROR));
    }

    public static function versions(array $graph): array
    {
        return array_values(array_unique(array_filter([
            ...array_column($graph['edges'], 'materialVersionId'), ...array_column($graph['rooms'], 'materialVersionId'),
        ])));
    }

    public static function write(Scene $scene, array $graph): void
    {
        $world = $scene->mapWorld;
        $world->update(['structure' => $graph['edges'] ? $graph : null]);
        DB::table('map_structure_materials')->where('map_world_id', $world->id)->delete();
        foreach (self::versions($graph) as $id) {
            DB::table('map_structure_materials')->insert(['map_world_id' => $world->id, 'map_material_version_id' => $id]);
        }
    }

    public static function projection(Scene $scene, bool $gm): array
    {
        $graph = self::graph($scene);
        $materials = MapMaterialVersion::with('asset')->whereIn('id', self::versions($graph))->get()
            ->map(fn ($v) => $gm ? $v->projection() : [
                'versionId' => (string) $v->id, 'asset' => app(SceneSnapshotBuilder::class)->asset($v->asset),
                'repeatSize' => $v->repeat_size, 'rotation' => $v->rotation,
            ])->all();

        $visible = self::visible($graph, $gm);

        return ['hash' => self::hash($visible), 'graph' => $visible, 'materials' => $materials];
    }

    public static function patch(Scene $scene, array $before, bool $gm): array
    {
        $next = self::projection($scene, $gm);
        $previous = self::visible($before, $gm);
        $base = self::hash($previous);
        if (! $gm && $next['hash'] === $base) {
            return [];
        }

        $patch = ['hash' => $next['hash'], 'base' => $base, 'materials' => $next['materials']];
        foreach (array_unique([...array_keys($next['graph']), ...array_keys($previous)]) as $kind) {
            $entities = $next['graph'][$kind] ?? [];
            $old = array_column($previous[$kind] ?? [], null, 'id');
            $new = array_column($entities, null, 'id');
            $patch[$kind] = [
                'upsert' => array_values(array_filter($new, fn ($entity, $id) => ($old[$id] ?? null) != $entity, ARRAY_FILTER_USE_BOTH)),
                'remove' => array_keys(array_diff_key($old, $new)),
            ];
        }

        // Reverb encodes event data inside another JSON envelope.
        return strlen(json_encode(json_encode($patch))) < 7500 ? ['structurePatch' => $patch] : ['structureRefresh' => true];
    }

    private static function visible(array $graph, bool $gm): array
    {
        if (! $gm) {
            foreach ($graph['edges'] as &$edge) {
                // Public walls expose movement only; vision/light remain GM data.
                unset($edge['blocksVision'], $edge['blocksLight']);
            }
            foreach ($graph['openings'] ?? [] as $i => $opening) {
                unset($opening['blocksVision'], $opening['blocksLight'], $opening['locked']);
                $graph['openings'][$i] = $opening;
            }
        }

        return $graph;
    }
}
