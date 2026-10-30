<?php

namespace App\Items;

use App\Actions\AbilityActions;
use App\Actions\CharacterActions;
use App\Actions\SceneTransaction;
use App\Combat\LifeCycle;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\InventoryItem;
use App\Models\ItemDefinition;
use App\Models\LootContainer;
use App\Models\SceneProp;
use App\Models\Token;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class LootActions
{
    public function authorize(User $u, Campaign $campaign, array $data): ?LootContainer
    {
        Gate::forUser($u)->authorize('view', $campaign);
        $gm = $campaign->roleFor($u) === 'gm';
        if (in_array($data['action'] ?? 'read', ['configure', 'give', 'remove', 'close'])) {
            Gate::forUser($u)->authorize('update', $campaign);
        }
        if (empty($data['containerId'])) {
            abort_unless($gm && ($data['action'] ?? '') === 'configure', 422);

            return null;
        }
        $loot = LootContainer::whereHas('scene', fn ($q) => $q->where('campaign_id', $campaign->id))->findOrFail($data['containerId']);
        $scene = $loot->scene;
        $object = $loot->object();
        abort_unless($object, 404);
        if (! $gm) {
            abort_unless($campaign->active_scene_id === $scene->id && ! $object->is_hidden, 403);
            abort_if($loot->kind === 'corpse' && $object instanceof Token && ! app(LifeCycle::class)->blocked($object), 403);
        }
        if (in_array($data['action'] ?? '', ['take', 'take-all'])) {
            $actor = app(AbilityActions::class)->authorize($u, $campaign, $data['characterId']);
            abort_if(app(LifeCycle::class)->blocked($actor), 422, 'Персонаж не может забирать добычу в этом состоянии.');
        }

        return $loot;
    }

    public function assertReceiptReadable(User $u, Campaign $campaign, array $result): void
    {
        if ($campaign->roleFor($u) === 'gm') {
            return;
        }
        foreach (['tokens', 'props'] as $key) {
            foreach ($result['mutation'][$key] ?? [] as $object) {
                abort_if(array_key_exists('isHidden', $object), 403, 'Роль изменилась. Обновите состояние контейнера.');
            }
        }
    }

    public function snapshot(LootContainer $loot, bool $gm): array
    {
        return $loot->summary($gm) + ['items' => ($gm || $loot->is_open) ? $loot->items()->with('definition')->where('quantity', '>', 0)->orderBy('id')->get()->map(fn ($i) => array_replace($i->toArray(), ['definition' => $i->definition->projection(false)]))->all() : []];
    }

    public function command(User $u, Campaign $campaign, array $data): array
    {
        return DB::transaction(function () use ($u, $campaign, $data) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            $loot = $this->authorize($u, $campaign, $data);
            $uuid = app(CommandContext::class)->id();
            $hash = hash('sha256', json_encode($data));
            $old = DB::table('loot_commands')->where('user_id', $u->id)->where('mutation_id', $uuid)->first();
            if ($old) {
                abort_unless(hash_equals($old->fingerprint, $hash), 409);

                $result = json_decode($old->result, true);
                $this->assertReceiptReadable($u, $campaign, $result);

                return $result;
            }
            $gm = $campaign->roleFor($u) === 'gm';
            $op = $data['action'];
            $taken = [];
            if ($op === 'configure') {
                $scene = $campaign->scenes()->findOrFail($data['sceneId']);
                $object = ($data['kind'] === 'token' ? $scene->tokens() : $scene->props())->findOrFail($data['objectId']);
                $lookup = $data['kind'] === 'token' ? ['token_id' => $object->id] : ['prop_id' => $object->id];
                $loot = LootContainer::firstOrCreate($lookup, ['scene_id' => $scene->id, 'name' => $data['name'] ?? mb_substr($object->name, 0, 80), 'kind' => $data['kind'] === 'token' ? 'corpse' : 'container', 'created_by' => $u->id]);
                if (isset($data['name'])) {
                    $loot->update(['name' => $data['name']]);
                }
            } elseif ($op === 'open' || $op === 'close') {
                $loot->update(['is_open' => $op === 'open']);
            } elseif ($op === 'give') {
                $d = ItemDefinition::where('campaign_id', $campaign->id)->findOrFail($data['definitionId']);
                $taken = app(ItemTransfers::class)->add($loot, $d, $data['quantity']);
            } elseif ($op === 'remove') {
                $i = $loot->items()->findOrFail($data['itemId']);
                $i->update(['quantity' => 0]);
            } elseif (in_array($op, ['take', 'take-all'])) {
                abort_unless($loot->is_open, 422, 'Сначала откройте контейнер.');
                $c = app(AbilityActions::class)->authorize($u, $campaign, $data['characterId']);
                $query = $loot->items()->with('definition')->where('quantity', '>', 0)->orderBy('id')->lockForUpdate();
                if ($op === 'take') {
                    $query->whereKey($data['itemId']);
                }$items = $query->get();
                abort_if($op === 'take' && $items->isEmpty(), 409, 'Предмет уже забрали.');
                foreach ($items as $i) {
                    $qty = $op === 'take' ? ($data['quantity'] ?? $i->quantity) : $i->quantity;
                    abort_if($qty > $i->quantity, 409, 'Количество изменилось. Обновите добычу.');
                    $taken = [...$taken, ...app(ItemTransfers::class)->add($c, $i->definition, $qty, $i)];
                }
                app(CharacterActions::class)->publish($u, $c->fresh());
            }
            $mutation = $this->changed($u, $loot);
            $result = ['mutation' => $mutation, 'loot' => $this->snapshot($loot->fresh(), $gm), 'transferred' => $taken];
            DB::table('loot_commands')->insert(['user_id' => $u->id, 'campaign_id' => $campaign->id, 'mutation_id' => $uuid, 'fingerprint' => $hash, 'result' => json_encode($result), 'created_at' => now()]);

            return $result;
        }, 3);
    }

    public function changed(User $u, LootContainer $loot): array
    {
        $loot->increment('version');
        $scene = $loot->scene;
        $result = app(SceneTransaction::class)->run($scene, function () use ($u, $loot) {
            $object = $loot->object();

            return $object instanceof Token ? ['tokens' => [app(SceneSnapshotBuilder::class)->token($object, true, $u)]] : ['props' => [$object->projection(true)]];
        }, 'objects.changed');
        $gm = $scene->campaign->roleFor($u) === 'gm';
        $object = $loot->object();
        if ($object instanceof Token) {
            $result['tokens'] = [app(SceneSnapshotBuilder::class)->token($object, $gm, $u)];
        } else {
            $result['props'] = [$object->projection($gm)];
        }

        return $result;
    }

    public function recipients(?User $u, Campaign $campaign, Character $source)
    {
        if (! $u) {
            return [];
        }

        return $campaign->characters()->where('id', '!=', $source->id)->get()->filter(fn ($c) => $this->canReceive($u, $campaign, $c))->map(fn ($c) => ['id' => (string) $c->id, 'name' => $c->name])->values()->all();
    }

    public function canReceive(User $u, Campaign $campaign, Character $c): bool
    {
        if ($campaign->roleFor($u) === 'gm' || $c->owner_user_id === $u->id) {
            return true;
        }

        return $c->kind === 'player_character' && $c->owner_user_id && $campaign->members()->whereKey($c->owner_user_id)->exists() && $c->tokens()->where('scene_id', $campaign->active_scene_id)->where('is_hidden', false)->exists();
    }

    public function drop(User $u, Campaign $campaign, Character $c, InventoryItem $i, int $qty, ?Token $at = null): LootContainer
    {
        $scene = $at ? $at->scene : $campaign->scenes()->findOrFail($campaign->active_scene_id);
        $actor = $at ?? $scene->tokens()->where('character_id', $c->id)->where('is_hidden', false)->first();
        abort_unless($actor, 422, 'Для сброса вещей нужен видимый токен на активной сцене.');
        $dropX = $actor->x + $scene->grid_size;
        if ($dropX > $scene->width - $scene->grid_size / 2) {
            $dropX = $actor->x - $scene->grid_size;
        }
        $dropX = max($scene->grid_size / 2, $dropX);
        $dropY = $actor->y;
        $loot = LootContainer::where('scene_id', $scene->id)->where('created_by', $u->id)->where('kind', 'drop')->get()->first(fn ($l) => ($p = $l->object()) && $p instanceof SceneProp && ! $p->is_hidden && abs($p->x - $dropX) < 0.01 && abs($p->y - $dropY) < 0.01);
        if (! $loot) {
            $prop = SceneProp::create(['scene_id' => $scene->id, 'asset_id' => null, 'name' => 'Сброшенные вещи', 'x' => $dropX, 'y' => $dropY, 'scale_x' => 0.65, 'scale_y' => 0.65, 'z_index' => ($scene->props()->max('z_index') ?? 0) + 1]);
            $loot = LootContainer::create(['scene_id' => $scene->id, 'prop_id' => $prop->id, 'name' => 'Сброшенные вещи', 'kind' => 'drop', 'is_open' => true, 'created_by' => $u->id]);
        }
        app(ItemTransfers::class)->add($loot, $i->definition, $qty, $i);
        $this->changed($u, $loot);

        return $loot;
    }
}
