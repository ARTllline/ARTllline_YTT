<?php

namespace App\Actions;

use App\Models\Campaign;
use App\Models\ContentTemplate;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\User;
use App\Services\SceneSelection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class TemplateActions
{
    public function save(User $user, Campaign $campaign, array $data): array
    {
        return DB::transaction(function () use ($user, $campaign, $data) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $scene = Scene::where('campaign_id', $campaign->id)->whereKey($data['sceneId'])->lockForUpdate()->firstOrFail();
            [$tokens, $props] = app(SceneSelection::class)->resolve($scene, $data);
            abort_if($data['kind'] === 'encounter' && $props->isNotEmpty(), 422, 'В столкновении могут быть только токены.');
            $objects = $tokens->concat($props);
            $originX = $objects->min('x');
            $originY = $objects->min('y');
            $template = ContentTemplate::create(['campaign_id' => $campaign->id, 'kind' => $data['kind'], 'name' => $data['name']]);
            foreach ($objects as $object) {
                $prop = $object instanceof SceneProp;
                $fields = $prop ? ['name', 'rotation', 'scale_x', 'scale_y', 'z_index', 'is_locked', 'is_hidden']
                    : ['name', 'rotation', 'size', 'scale', 'kind', 'color', 'max_hp', 'ac', 'speed', 'is_hidden', 'is_locked'];
                $values = $object->only($fields);
                if (! $prop) {
                    // Reusable starting state never captures accidental damage, ownership or conditions.
                    $values['hp'] = $object->max_hp;
                }
                $values['x'] = (float) $object->x - $originX;
                $values['y'] = (float) $object->y - $originY;
                $template->items()->create(['kind' => $prop ? 'prop' : 'token',
                    'asset_id' => $prop ? $object->asset_id : $object->token_image_asset_id, 'data' => $values]);
            }

            return ['template' => $template->load('items.asset')->projection()];
        }, 3);
    }

    public function spawn(User $user, Scene $scene, array $data): array
    {
        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $template = ContentTemplate::with('items.asset')->where('campaign_id', $scene->campaign_id)->findOrFail($data['templateId']);
            $tokens = collect();
            $props = collect();
            $baseZ = (SceneProp::where('scene_id', $scene->id)->max('z_index') ?? -1) + 1;
            $originZ = $template->items->where('kind', 'prop')->min(fn ($item) => $item->data['z_index']) ?? 0;
            foreach ($template->items as $item) {
                abort_if($item->asset_id && (! $item->asset || $item->asset->campaign_id !== $scene->campaign_id || $item->asset->kind !== $item->kind), 422, 'Материал заготовки недоступен в этой кампании.');
                $values = $item->data;
                $values['x'] += $data['x'];
                $values['y'] += $data['y'];
                abort_if(abs($values['x']) > 1000000 || abs($values['y']) > 1000000, 422, 'Объекты выходят за допустимые границы.');
                if ($item->kind === 'prop') {
                    $values['z_index'] = $baseZ + $values['z_index'] - $originZ;
                    $props->push(SceneProp::create($values + ['scene_id' => $scene->id, 'asset_id' => $item->asset_id])->refresh());
                } else {
                    $tokens->push($scene->tokens()->create($values + ['token_image_asset_id' => $item->asset_id, 'owner_user_id' => null])->refresh());
                }
            }

            return app(SceneSelection::class)->result($tokens, $props, $user);
        }, 'objects.changed');
    }
}
