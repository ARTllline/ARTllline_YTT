<?php

namespace App\Actions;

use App\Models\MapMaterialVersion;
use App\Models\Scene;
use App\Models\User;
use App\Services\MovementCollision;
use App\Services\RoomAssembly;
use App\Services\SceneVisibility;
use App\Services\StructuralGeometry;
use App\Services\StructureData;
use App\Services\StructureJunctions;
use App\Services\TokenMovement;
use App\Services\WallCurve;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

class StructureActions
{
    public function execute(User $user, Scene $scene, array $input, bool $history = false): array
    {
        return app(SceneTransaction::class)->run($scene, function (Scene $scene) use ($user, $input, $history) {
            $stateKey = array_key_exists('door', $input) ? 'door'
                : (array_key_exists('opening', $input) ? 'opening' : null);
            $gm = Gate::forUser($user)->allows('update', $scene);
            Gate::forUser($user)->authorize(! $history && $stateKey === 'opening' ? 'view' : 'update', $scene);
            abort_unless($scene->mapWorld?->schema_version === 1, 409, 'Сначала создайте MapWorld.');
            $before = StructureData::graph($scene);
            abort_unless(($input['expected'] ?? null) === StructureData::hash($before, $gm), 409, 'Структура изменилась в другом окне. Повторите действие.');

            if ($history) {
                $snapshot = $input['value']['snapshot'] ?? null;
                abort_unless(is_string($snapshot) && strlen($snapshot) <= 600000, 422);
                try {
                    $saved = json_decode(Crypt::decryptString($snapshot), true, flags: JSON_THROW_ON_ERROR);
                } catch (\Exception) {
                    abort(422, 'Некорректная история структуры.');
                }
                abort_unless($saved['scene'] === $scene->id, 422);
                $next = $saved['graph'];
            } elseif ($stateKey) {
                $patch = Validator::make($input, [
                    $stateKey => $stateKey === 'door' ? 'required|array:id,open,locked' : 'required|array:id,open',
                    "$stateKey.id" => 'required|string|max:36',
                    "$stateKey.open" => $stateKey === 'door' ? 'sometimes|required|boolean' : 'required|boolean',
                    "$stateKey.locked" => 'sometimes|required|boolean',
                ])->validate()[$stateKey];
                abort_unless(count($patch) === 2, 422, 'Укажите одно действие для двери.');
                $next = $before;
                $index = array_search($patch['id'], array_column($next['openings'] ?? [], 'id'), true);
                abort_unless($index !== false && ($stateKey !== 'door' || $next['openings'][$index]['type'] === 'door'), 404);
                $opening = $next['openings'][$index];
                $field = array_key_exists('open', $patch) ? 'open' : 'locked';
                abort_if(! $gm && ! $this->seesOpening($scene, $user, $before, $opening), 403, 'Проём вне обзора.');
                abort_if($field === 'open' && ($opening['locked'] ?? false), 422, 'Дверь заперта. Сначала отоприте замок.');
                $next['openings'][$index][$field] = (bool) $patch[$field];
                // Keep retained sources in sync so reshaping the room preserves opening state.
                foreach ($next['assemblies'] ?? [] as $ai => $assembly) {
                    foreach ($assembly['sources'] as $si => $source) {
                        foreach ($source['graph']['openings'] ?? [] as $oi => $sourceOpening) {
                            if ($sourceOpening['id'] === $patch['id']) {
                                $next['assemblies'][$ai]['sources'][$si]['graph']['openings'][$oi][$field] = (bool) $patch[$field];
                            }
                        }
                    }
                }
            } else {
                $next = $this->validate($input['value'] ?? null);
                $next = StructureJunctions::connect($next, $before);
                $next = $this->validate($next);
                abort_if(strlen(json_encode($next)) > 180000, 422, 'Достигнут предел размера структуры.');
            }
            StructuralGeometry::validate($next, $before);
            if (! $history && ! $stateKey) {
                StructuralGeometry::preserveOpenings($before, $next);
            }
            StructuralGeometry::inside($next, $scene->width, $scene->height);
            $this->guardMovedWalls($scene, $before, $next);
            $opened = array_column(array_filter($before['openings'] ?? [],
                fn ($opening) => $opening['type'] === 'door' && $opening['open']), 'id');
            if ($opened) {
                $closed = array_filter(StructuralGeometry::compile($next)['shapes'],
                    fn ($shape) => in_array($shape['openingId'] ?? null, $opened, true));
                if ($closed) {
                    $collision = app(MovementCollision::class);
                    foreach ($scene->tokens()->cursor() as $token) {
                        $position = ['x' => (float) $token->x, 'y' => (float) $token->y];
                        $radius = TokenMovement::radius($token);
                        abort_if($collision->blocks($position, $position, $radius, $closed),
                            422, 'Дверь нельзя закрыть: проход занят.');
                    }
                }
            }

            $ids = StructureData::versions($next);
            abort_if(count($ids) > 24, 422, 'На карте допускается до 24 версий материалов структуры.');
            $versions = MapMaterialVersion::with('material')->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $existing = StructureData::versions($before);
            $editable = RoomAssembly::editable($next);
            foreach (['edges' => 'wall', 'rooms' => 'floor', 'floors' => 'floor', 'openings' => null] as $kind => $type) {
                foreach ([...($next[$kind] ?? []), ...($editable[$kind] ?? [])] as $surface) {
                    if ($id = $surface['materialVersionId'] ?? null) {
                        $version = $versions->get($id);
                        abort_unless($version?->type === ($type ?? $surface['type']), 422, 'Выбранный материал удалён или не подходит поверхности.');
                        abort_unless($history || $version->material->builtin_key || $version->material->user_id === $user->id || in_array($id, $existing, true), 403);
                    }
                }
            }
            StructureData::write($scene, $next);

            return ['_structureBefore' => $before] + ($gm ? ['structure' => StructureData::projection($scene, true),
                'structureEdit' => ['before' => $this->capture($scene, $before), 'after' => $this->capture($scene, $next)]] : []);
        }, 'structure.updated');
    }

    private function seesOpening(Scene $scene, User $user, array $graph, array $opening): bool
    {
        if (! $scene->vision_enabled) {
            return true;
        }
        $edge = array_column($graph['edges'], null, 'id')[$opening['edgeId']];
        $path = WallCurve::path($edge, array_column($graph['vertices'], null, 'id'));
        $center = $opening['center'] * WallCurve::length($path);
        $a = WallCurve::along($path, $center - $opening['width'] / 2);
        $b = WallCurve::along($path, $center + $opening['width'] / 2);
        $dx = $b['x'] - $a['x'];
        $dy = $b['y'] - $a['y'];
        $normal = (min(4, $edge['thickness'] / 2) + .01) / hypot($dx, $dy);
        $vision = app(SceneVisibility::class);
        foreach ([.25, .5, .75] as $t) {
            foreach ([-$normal, $normal] as $side) {
                $point = ['x' => $a['x'] + $t * $dx - $side * $dy, 'y' => $a['y'] + $t * $dy + $side * $dx];
                if ($vision->seesPoint($scene, $user, $point)) {
                    return true;
                }
            }
        }

        return false;
    }

    private function guardMovedWalls(Scene $scene, array $before, array $next): void
    {
        $oldVertices = array_column($before['vertices'], null, 'id');
        $oldEdges = array_column($before['edges'], null, 'id');
        $moved = [];
        $remaining = array_column($next['vertices'], null, 'id');
        foreach ($oldVertices as $id => $_) {
            if (! isset($remaining[$id])) {
                $moved[$id] = true;
            }
        }
        foreach ($next['vertices'] as $vertex) {
            $old = $oldVertices[$vertex['id']] ?? null;
            if ($old && ($old['x'] != $vertex['x'] || $old['y'] != $vertex['y'])) {
                $moved[$vertex['id']] = true;
            }
        }
        if (! $moved && ! array_filter($next['edges'], fn ($edge) => isset($oldEdges[$edge['id']]) && ($edge['curve'] ?? null) != ($oldEdges[$edge['id']]['curve'] ?? null))) {
            return;
        }

        $next['edges'] = array_filter($next['edges'], fn ($edge) => ! isset($oldEdges[$edge['id']])
            || isset($moved[$edge['a']]) || isset($moved[$edge['b']])
            || $edge['a'] !== $oldEdges[$edge['id']]['a'] || $edge['b'] !== $oldEdges[$edge['id']]['b']
            || ($edge['curve'] ?? null) != ($oldEdges[$edge['id']]['curve'] ?? null));
        $shapes = StructuralGeometry::compile($next)['shapes'];
        if (! $shapes) {
            return;
        }
        $collision = app(MovementCollision::class);
        foreach ($scene->tokens()->cursor() as $token) {
            $position = ['x' => (float) $token->x, 'y' => (float) $token->y];
            abort_if($collision->blocks($position, $position, TokenMovement::radius($token), $shapes),
                422, 'Перемещение перекрывает место, занятое токеном.');
        }
    }

    private function capture(Scene $scene, array $graph): array
    {
        return ['hash' => StructureData::hash($graph),
            'snapshot' => Crypt::encryptString(json_encode(['scene' => $scene->id, 'graph' => $graph], JSON_THROW_ON_ERROR))];
    }

    private function curve(array $value, string $id): array
    {
        $rules = ['group' => $id, 'kind' => 'required|in:circle,ellipse',
            'cx' => 'required|numeric|between:0,20000', 'cy' => 'required|numeric|between:0,20000',
            'rx' => 'required|numeric|between:8,10000', 'ry' => 'required|numeric|between:8,10000',
            'rotation' => 'required|numeric|between:-360,360', 'start' => 'required|numeric|between:-720,720',
            'sweep' => 'required|numeric|between:-360,360'];
        $curve = Validator::make($value, $rules)->validate();
        foreach (['cx', 'cy', 'rx', 'ry', 'rotation', 'start', 'sweep'] as $key) {
            $curve[$key] = round((float) $curve[$key], in_array($key, ['rotation', 'start', 'sweep'], true) ? 6 : 3);
        }
        ksort($curve);

        return $curve;
    }

    private function validate(mixed $value, bool $source = false): array
    {
        $graph = Validator::make(['value' => $value], [
            'value' => $source ? 'required|array:vertices,edges,rooms,openings' : 'required|array:vertices,edges,rooms,openings,assemblies,floors',
            'value.vertices' => 'present|array|list|max:512', 'value.edges' => 'present|array|list|max:512',
            'value.openings' => 'sometimes|array|list|max:256',
            'value.rooms' => 'present|array|list|max:128',
            'value.assemblies' => 'sometimes|array|list|max:8',
            'value.floors' => 'sometimes|array|list|max:128',
        ])->validate()['value'];
        $id = 'required|string|regex:/^[a-z][a-z0-9-]{0,35}$/D';
        $rules = [
            'vertices' => ['id' => $id, 'x' => 'required|numeric|between:0,20000', 'y' => 'required|numeric|between:0,20000'],
            'edges' => ['id' => $id, 'a' => $id, 'b' => $id, 'thickness' => 'required|numeric|between:2,80',
                'materialVersionId' => 'present|nullable|integer|min:1', 'blocksMovement' => 'required|boolean',
                'blocksVision' => 'required|boolean', 'blocksLight' => 'required|boolean',
                'curve' => 'sometimes|array:group,kind,cx,cy,rx,ry,rotation,start,sweep'],
            'openings' => ['id' => $id, 'edgeId' => $id, 'type' => 'required|in:door,window',
                'materialVersionId' => 'sometimes|nullable|integer|min:1',
                'center' => 'required|numeric|between:0,1', 'width' => 'required|numeric|between:8,512',
                'open' => 'required_if:type,door|boolean',
                'locked' => 'required_if:type,door|prohibited_if:type,window|boolean',
                'hinge' => 'required_if:type,door|prohibited_if:type,window|in:a,b',
                'direction' => 'required_if:type,door|prohibited_if:type,window|in:left,right',
                'angle' => 'required_if:type,door|prohibited_if:type,window|numeric|between:30,150',
                'frame' => 'required_if:type,window|prohibited_if:type,door|in:wood,iron',
                'blocksMovement' => 'required_if:type,window|prohibited_if:type,door|boolean',
                'blocksVision' => 'required_if:type,window|prohibited_if:type,door|boolean',
                'blocksLight' => 'required_if:type,window|prohibited_if:type,door|boolean'],
            'rooms' => ['id' => $id, 'loop' => 'required|array|list|min:3|max:128', 'loop.*' => $id,
                'materialVersionId' => 'present|nullable|integer|min:1'],
        ];
        $next = [];
        foreach ($rules as $kind => $fields) {
            $entries = [];
            foreach ($graph[$kind] ?? [] as $entry) {
                abort_unless(is_array($entry), 422);
                $row = Validator::make($entry, $fields)->validate();
                abort_if(isset($entries[$row['id']]), 422, 'Повторяющийся ID структуры.');
                $canonical = [];
                foreach (array_intersect_key($fields, $row) as $key => $_) {
                    if ($row[$key] === null && $kind === 'openings') {
                        continue;
                    }
                    $canonical[$key] = match ($key) {
                        'curve' => $this->curve($row[$key], $id),
                        'center' => round((float) $row[$key], 8),
                        'x', 'y', 'thickness', 'width', 'angle' => round((float) $row[$key], 3),
                        'materialVersionId' => $row[$key] === null ? null : (string) (int) $row[$key],
                        'blocksMovement', 'blocksVision', 'blocksLight', 'open', 'locked' => (bool) $row[$key],
                        default => $row[$key],
                    };
                }
                $entries[$row['id']] = $canonical;
            }
            if (! $source) {
                ksort($entries);
            }
            if ($kind !== 'openings' || $entries) {
                $next[$kind] = array_values($entries);
            }
        }

        if (! $source && ! empty($graph['assemblies'])) {
            $assemblies = [];
            $sourceEdges = $sourceSegments = 0;
            foreach ($graph['assemblies'] as $assembly) {
                $assembly = Validator::make($assembly, ['id' => 'required|string|regex:/^a[a-z0-9]{1,12}$/D', 'sources' => 'required|array|list|min:2|max:32'])->validate();
                abort_if(isset($assemblies[$assembly['id']]), 422, 'Повторяющийся ID сборки.');
                foreach ($assembly['sources'] as &$part) {
                    $part = Validator::make($part, ['mode' => 'required|in:union,partition,trim', 'graph' => 'required|array'])->validate();
                    $part['graph'] = $this->validate($part['graph'], true);
                    $sourceEdges += count($part['graph']['edges']);
                    abort_if($sourceEdges > 512, 422, 'Достигнут предел исходных стен сборки.');
                    abort_unless(count($part['graph']['rooms']) === 1 && count($part['graph']['edges']) === count($part['graph']['rooms'][0]['loop']), 422, 'Источник сборки должен быть одним замкнутым помещением.');
                    StructuralGeometry::validate($part['graph']);
                    $vertices = array_column($part['graph']['vertices'], null, 'id');
                    foreach ($part['graph']['edges'] as $edge) {
                        $sourceSegments += count(WallCurve::path($edge, $vertices)) - 1;
                    }
                    abort_if($sourceSegments > 4096, 422, 'Достигнут предел детализации исходных форм.');
                }
                unset($part);
                $assemblies[$assembly['id']] = $assembly;
            }
            $next['assemblies'] = array_values($assemblies);
            $next = RoomAssembly::rebuild($next);
            abort_if(count($next['vertices']) > 512 || count($next['edges']) > 512 || count($next['rooms']) > 128, 422, 'Достигнут предел структуры.');
        }

        return $next;
    }
}
