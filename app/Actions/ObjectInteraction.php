<?php

namespace App\Actions;

use App\Models\Campaign;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Services\TriggerEvents;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class ObjectInteraction
{
    public function authorize(User $user, Scene $scene, array $data): void
    {
        Gate::forUser($user)->authorize('view', $scene);
        abort_unless($scene->campaign->active_scene_id === $scene->id && $scene->campaign->live_revision === (int) $data['epoch'], 409, 'Сцена изменилась. Повторите действие на текущей сцене.');
        $object = $data['kind'] === 'token' ? $scene->tokens()->findOrFail($data['id']) : SceneProp::where('scene_id', $scene->id)->findOrFail($data['id']);
        abort_if($scene->campaign->roleFor($user) !== 'gm' && $object->is_hidden, 403);
    }

    public function execute(User $user, Scene $scene, array $data): array
    {
        return DB::transaction(function () use ($user, $scene, $data) {
            $campaign = Campaign::whereKey($scene->campaign_id)->lockForUpdate()->firstOrFail();
            $scene = Scene::whereKey($scene->id)->lockForUpdate()->firstOrFail();
            $scene->setRelation('campaign', $campaign);
            $this->authorize($user, $scene, $data);
            app(TriggerEvents::class)->event($scene, 'object.interact', 'interaction:'.app(CommandContext::class)->id(), ['kind' => $data['kind'], 'id' => (int) $data['id']]);

            // Same response for every authorized object, even without a trigger.
            return ['accepted' => true];
        });
    }
}
