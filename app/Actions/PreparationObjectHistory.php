<?php

namespace App\Actions;

use App\Items\LootActions;
use App\Models\ItemDefinition;
use App\Models\LootContainer;
use App\Models\Scene;
use App\Models\User;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

/** SceneHistory inverses contain only server-issued, scene-bound authoring snapshots. */
class PreparationObjectHistory
{
    public function captureInteractions(Scene $scene, string $kind, int $id): array
    {
        $object = app(ObjectInteractionActions::class)->object($scene, $kind, $id);

        return ['scene' => $scene->id, 'objectKind' => $kind, 'objectId' => $id,
            'actions' => app(ObjectInteractionActions::class)->projection($object, true),
            'checks' => DB::table('object_checks')->where('scene_id', $scene->id)->where('object_kind', $kind)->where('object_id', $id)->orderBy('id')->pluck('id')->all()];
    }

    public function captureLoot(LootContainer $loot): array
    {
        $items = DB::table('inventory_items')->where('loot_container_id', $loot->id)->orderBy('id')->get()->map(fn ($i) => (array) $i)->all();
        $definitions = ItemDefinition::whereIn('id', array_column($items, 'item_definition_id'))->orderBy('id')->get()->mapWithKeys(fn ($d) => [$d->id => hash('sha256', json_encode($d->toArray()))])->all();

        return ['scene' => $loot->scene_id, 'container' => $loot->id, 'open' => $loot->is_open, 'items' => $items, 'definitions' => $definitions];
    }

    public function edit(string $kind, string $id, array $before, array $after): array
    {
        abort_if(strlen(json_encode([$before, $after])) > 512 * 1024, 422, 'Слишком много содержимого для одной правки.');

        return ['kind' => $kind, 'id' => $id, 'expected' => ['snapshot' => Crypt::encryptString(json_encode($after))], 'value' => ['snapshot' => Crypt::encryptString(json_encode($before))]];
    }

    public function apply(User $user, Scene $scene, array $input): array
    {
        Gate::forUser($user)->authorize('update', $scene);
        $change = Validator::make($input, [
            'changes' => 'required|array|size:1', 'changes.0.kind' => 'required|in:lootContents,interactionConfig', 'changes.0.id' => 'required|integer|min:1',
            'changes.0.expected.snapshot' => 'required|string|max:1500000', 'changes.0.value.snapshot' => 'required|string|max:1500000',
        ])->validate()['changes'][0];
        try {
            $expected = json_decode(Crypt::decryptString($change['expected']['snapshot']), true, 512, JSON_THROW_ON_ERROR);
            $value = json_decode(Crypt::decryptString($change['value']['snapshot']), true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            abort(422, 'Недействительная история содержимого.');
        }

        return DB::transaction(function () use ($user, $scene, $change, $expected, $value) {
            $scene->campaign()->lockForUpdate()->firstOrFail();
            $scene = Scene::whereKey($scene->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $scene);
            if ($change['kind'] === 'interactionConfig') {
                foreach ([$expected, $value] as $state) {
                    abort_unless(($state['scene'] ?? null) === $scene->id && ($state['objectId'] ?? null) === (int) $change['id'] && in_array($state['objectKind'] ?? null, ['token', 'prop']), 422);
                }
                abort_unless($expected['objectKind'] === $value['objectKind'] && $this->captureInteractions($scene, $expected['objectKind'], $expected['objectId']) == $expected, 409, 'Действия изменились или проверка уже выполнена. Отмена недоступна.');

                return app(ObjectInteractionActions::class)->save($user, $scene, ['kind' => $value['objectKind'], 'id' => $value['objectId'], 'actions' => $value['actions']]);
            }
            $loot = LootContainer::where('scene_id', $scene->id)->findOrFail($change['id']);
            foreach ([$expected, $value] as $state) {
                abort_unless(($state['scene'] ?? null) === $scene->id && ($state['container'] ?? null) === $loot->id, 422);
                foreach ($state['definitions'] as $id => $hash) {
                    $definition = ItemDefinition::find($id);
                    abort_unless($definition && hash_equals($hash, hash('sha256', json_encode($definition->toArray()))), 409, 'Предмет изменился. Отмена недоступна.');
                }
            }
            abort_unless($this->captureLoot($loot) == $expected, 409, 'Содержимое изменилось или добычу уже забрали. Отмена недоступна.');
            $ids = array_column($value['items'], 'id');
            abort_if(DB::table('inventory_items')->whereIn('id', $ids)->where(fn ($q) => $q->whereNull('loot_container_id')->orWhere('loot_container_id', '!=', $loot->id))->exists(), 409, 'Предмет уже передан. Отмена недоступна.');
            DB::table('inventory_items')->where('loot_container_id', $loot->id)->whereNotIn('id', $ids)->delete();
            foreach ($value['items'] as $row) {
                DB::table('inventory_items')->updateOrInsert(['id' => $row['id']], $row);
            }

            return app(LootActions::class)->changed($user, $loot);
        }, 3);
    }
}
