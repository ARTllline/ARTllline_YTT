<?php

namespace App\Actions;

use App\Models\Campaign;
use App\Models\Cue;
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
        abort_if($object->is_hidden, 403);
        if (isset($data['actionId'])) {
            $action = collect($object->interactions ?? [])->firstWhere('id', $data['actionId']);
            abort_unless($action && app(ObjectInteractionActions::class)->available($scene, $action), 403, 'Действие больше недоступно.');
        }
    }

    public function execute(User $user, Scene $scene, array $data): array
    {
        return DB::transaction(function () use ($user, $scene, $data) {
            $campaign = Campaign::whereKey($scene->campaign_id)->lockForUpdate()->firstOrFail();
            $scene = Scene::whereKey($scene->id)->lockForUpdate()->firstOrFail();
            $scene->setRelation('campaign', $campaign);
            $this->authorize($user, $scene, $data);
            if (isset($data['actionId'])) {
                $object = app(ObjectInteractionActions::class)->object($scene, $data['kind'], $data['id']);
                $action = collect($object->interactions)->firstWhere('id', $data['actionId']);
                if ($action['check']['enabled'] ?? false) {
                    return app(ObjectCheckActions::class)->execute($user, $scene, $data, $action);
                }

                return ['accepted' => true] + $this->result($user, $scene, $action['author_id'], $action);
            }
            app(TriggerEvents::class)->event($scene, 'object.interact', 'interaction:'.app(CommandContext::class)->id(), ['kind' => $data['kind'], 'id' => (int) $data['id']]);

            // Same response for every authorized object, even without a trigger.
            return ['accepted' => true];
        });
    }

    public function result(User $actor, Scene $scene, int $authorId, array $result): array
    {
        $author = User::findOrFail($authorId);
        if ($result['result_type'] === 'handout') {
            $shown = app(HandoutActions::class)->show($author, $scene->campaign, $result['result_target'],
                $scene->campaign->roleFor($actor) === 'gm' ? [] : [(string) $actor->id]);

            return $scene->campaign->roleFor($actor) === 'gm' ? $shown : [];
        }
        if ($result['result_type'] === 'cue') {
            $cue = Cue::where('scene_id', $scene->id)->findOrFail($result['result_target']);
            app(CueRunner::class)->start($author, $scene, $cue);
        }

        return [];
    }
}
