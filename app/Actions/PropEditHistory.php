<?php

namespace App\Actions;

use App\Models\Asset;
use App\Models\LootContainer;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\SceneTrigger;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/** Presence inverses for decorative props only. Signed snapshots never replay gameplay. */
class PropEditHistory
{
    private const FIELDS = ['id', 'scene_id', 'asset_id', 'name', 'x', 'y', 'rotation', 'scale_x', 'scale_y', 'z_index', 'is_hidden', 'is_locked', 'preset_snapshot'];

    private function independent(SceneProp $prop): bool
    {
        return ! $prop->interactions && ! LootContainer::where('prop_id', $prop->id)->exists()
            && ! SceneTrigger::where('prop_id', $prop->id)->exists()
            && ! DB::table('object_checks')->where('scene_id', $prop->scene_id)->where('object_kind', 'prop')->where('object_id', $prop->id)->exists();
    }

    public function capture(SceneProp $prop, bool $present): ?array
    {
        if (! $this->independent($prop)) {
            return null;
        }

        return ['id' => (string) $prop->id, 'present' => $present, 'snapshot' => Crypt::encryptString(json_encode($prop->only(self::FIELDS), JSON_THROW_ON_ERROR))];
    }

    public function apply(Scene $scene, array $changes): array
    {
        $result = ['props' => [], 'deletedPropIds' => [], '_previousVisibility' => ['tokens' => [], 'props' => []]];
        $seen = [];
        foreach ($changes as $change) {
            abort_unless(($change['kind'] ?? '') === 'propPresence', 422);
            $expected = $change['expected'] ?? [];
            $value = $change['value'] ?? [];
            abort_unless(is_bool($expected['present'] ?? null) && is_bool($value['present'] ?? null)
                && $expected['present'] !== $value['present'] && ($expected['snapshot'] ?? null) === ($value['snapshot'] ?? null), 422);
            try {
                $attributes = json_decode(Crypt::decryptString($value['snapshot']), true, 32, JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
                abort(422, 'Недействительный снимок объекта.');
            }
            $id = $attributes['id'];
            abort_unless((string) $id === (string) $change['id'] && (int) $attributes['scene_id'] === $scene->id && ! isset($seen[$id]), 422);
            $seen[$id] = true;
            $prop = SceneProp::find($id);
            if ($expected['present']) {
                abort_unless($prop && $prop->scene_id === $scene->id && $this->independent($prop), 409, 'Объект изменён или связан с игровыми данными.');
                foreach ($attributes as $key => $attribute) {
                    abort_unless($attribute == $prop->$key, 409, 'Объект изменён другим действием.');
                }
                if (! $prop->is_hidden) {
                    $result['_previousVisibility']['props'][] = (string) $id;
                }
                $prop->delete();
                $result['deletedPropIds'][] = (string) $id;
            } else {
                abort_if($prop, 409, 'Объект уже существует.');
                abort_unless(Asset::whereKey($attributes['asset_id'])->exists(), 409, 'Текстура объекта удалена.');
                $prop = new SceneProp;
                $prop->forceFill($attributes)->save();
                $result['props'][] = $prop->load('asset')->projection(true);
            }
        }

        return $result;
    }
}
