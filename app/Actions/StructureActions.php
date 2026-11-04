<?php

namespace App\Actions;

use App\Models\MapMaterialVersion;
use App\Models\Scene;
use App\Models\User;
use App\Services\StructuralGeometry;
use App\Services\StructureData;
use App\Services\MovementCollision;
use App\Services\TokenMovement;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

class StructureActions
{
    public function execute(User $user, Scene $scene, array $input, bool $history = false): array
    {
        return app(SceneTransaction::class)->run($scene, function (Scene $scene) use ($user, $input, $history) {
            Gate::forUser($user)->authorize('update', $scene);
            abort_unless($scene->mapWorld?->schema_version === 1, 409, 'Сначала создайте MapWorld.');
            $before = StructureData::graph($scene);
            abort_unless(($input['expected'] ?? null) === StructureData::hash($before), 409, 'Структура изменилась в другом окне. Повторите действие.');

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
            } elseif (array_key_exists('door', $input)) {
                $door = Validator::make(['door' => $input['door']], [
                    'door' => 'required|array:id,open,locked',
                    'door.id' => 'required|string|max:36',
                    'door.open' => 'sometimes|required|boolean',
                    'door.locked' => 'sometimes|required|boolean',
                ])->validate()['door'];
                abort_unless(count($door) === 2, 422, 'Укажите одно действие для двери.');
                $next = $before;
                $index = array_search($door['id'], array_column($next['openings'] ?? [], 'id'), true);
                abort_unless($index !== false && $next['openings'][$index]['type'] === 'door', 404);
                $opening = &$next['openings'][$index];
                abort_if(isset($door['open']) && $opening['locked'], 422, 'Дверь заперта. Сначала отоприте замок.');
                foreach (['open', 'locked'] as $field) {
                    if (isset($door[$field])) {
                        $opening[$field] = (bool) $door[$field];
                    }
                }
                unset($opening);
            } else {
                $next = $this->validate($input['value'] ?? null);
                abort_if(strlen(json_encode($next)) > 180000, 422, 'Достигнут предел размера структуры.');
            }
            StructuralGeometry::validate($next);
            if (! $history && ! array_key_exists('door', $input)) {
                StructuralGeometry::preserveOpenings($before, $next);
            }
            StructuralGeometry::inside($next, $scene->width, $scene->height);
            $openDoors = array_column(array_filter($before['openings'] ?? [],
                fn ($opening) => $opening['type'] === 'door' && $opening['open']), 'id');
            if ($openDoors) {
                $closed = array_filter(StructuralGeometry::compile($next)['shapes'],
                    fn ($shape) => in_array($shape['openingId'] ?? null, $openDoors, true));
                if ($closed) {
                    foreach ($scene->tokens()->cursor() as $token) {
                        $position = ['x' => (float) $token->x, 'y' => (float) $token->y];
                        abort_if(app(MovementCollision::class)->blocks($position, $position, TokenMovement::radius($token), $closed),
                            422, 'Дверь нельзя закрыть: проход занят.');
                    }
                }
            }

            $ids = StructureData::versions($next);
            abort_if(count($ids) > 24, 422, 'На карте допускается до 24 версий материалов структуры.');
            $versions = MapMaterialVersion::with('material')->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $existing = StructureData::versions($before);
            foreach (['edges' => 'wall', 'rooms' => 'floor'] as $kind => $type) {
                foreach (array_unique(array_filter(array_column($next[$kind], 'materialVersionId'))) as $id) {
                    $version = $versions->get($id);
                    abort_unless($version?->type === $type, 422, 'Выбранный материал удалён или не подходит поверхности.');
                    abort_unless($history || $version->material->user_id === $user->id || in_array($id, $existing, true), 403);
                }
            }
            StructureData::write($scene, $next);

            return ['structure' => StructureData::projection($scene, true), '_structureBefore' => $before,
                'structureEdit' => ['before' => $this->capture($scene, $before), 'after' => $this->capture($scene, $next)]];
        }, 'structure.updated');
    }

    private function capture(Scene $scene, array $graph): array
    {
        return ['hash' => StructureData::hash($graph),
            'snapshot' => Crypt::encryptString(json_encode(['scene' => $scene->id, 'graph' => $graph], JSON_THROW_ON_ERROR))];
    }

    private function validate(mixed $value): array
    {
        $graph = Validator::make(['value' => $value], [
            'value' => 'required|array:vertices,edges,rooms,openings',
            'value.vertices' => 'present|array|list|max:512', 'value.edges' => 'present|array|list|max:512',
            'value.openings' => 'sometimes|array|list|max:256',
            'value.rooms' => 'present|array|list|max:128',
        ])->validate()['value'];
        $id = 'required|string|regex:/^[a-z][a-z0-9-]{0,35}$/D';
        $rules = [
            'vertices' => ['id' => $id, 'x' => 'required|numeric|between:0,20000', 'y' => 'required|numeric|between:0,20000'],
            'edges' => ['id' => $id, 'a' => $id, 'b' => $id, 'thickness' => 'required|numeric|between:2,80',
                'materialVersionId' => 'present|nullable|integer|min:1', 'blocksMovement' => 'required|boolean',
                'blocksVision' => 'required|boolean', 'blocksLight' => 'required|boolean'],
            'openings' => ['id' => $id, 'edgeId' => $id, 'type' => 'required|in:door,window',
                'center' => 'required|numeric|between:0,1', 'width' => 'required|numeric|between:8,512',
                'open' => 'required_if:type,door|prohibited_if:type,window|boolean',
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
                        'center' => round((float) $row[$key], 8),
                        'x', 'y', 'thickness', 'width', 'angle' => round((float) $row[$key], 3),
                        'materialVersionId' => $row[$key] === null ? null : (string) (int) $row[$key],
                        'blocksMovement', 'blocksVision', 'blocksLight', 'open', 'locked' => (bool) $row[$key],
                        default => $row[$key],
                    };
                }
                $entries[$row['id']] = $canonical;
            }
            ksort($entries);
            if ($kind !== 'openings' || $entries) {
                $next[$kind] = array_values($entries);
            }
        }

        return $next;
    }
}
