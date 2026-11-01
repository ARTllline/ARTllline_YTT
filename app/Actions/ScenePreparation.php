<?php

namespace App\Actions;

use App\Models\Campaign;
use App\Models\Scene;
use App\Models\SceneNote;
use App\Models\User;
use App\Realtime\ScenePublisher;
use App\Services\CharacterGameplay;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class ScenePreparation
{
    public function place(User $user, Scene $scene, int $id, float $x, float $y): array
    {
        return DB::transaction(function () use ($user, $scene, $id, $x, $y) {
            $campaign = Campaign::whereKey($scene->campaign_id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $source = app(CharacterLibrary::class)->query($user)->where('kind', 'player_character')->lockForUpdate()->findOrFail($id);
            // An assigned hero retains its existing runtime identity. Other placements
            // are snapshots; preparation never moves the global library record.
            $character = $source;
            if ($source->campaign_id !== $campaign->id) {
                $data = $source->toArray();
                app(CharacterGameplay::class)->validate($campaign, $data, null);
                $character = app(NpcLibrary::class)->clone($source, $campaign, $user);
            }
            $result = app(TokenActions::class)->create($user, $scene, ['character_id' => $character->id, 'x' => $x, 'y' => $y]);
            app(CharacterActions::class)->publish($user, $character);
            $result['revision'] = $scene->fresh()->revision;
            $result['character'] = app(CharacterActions::class)->projection($character->fresh());

            return $result;
        }, 3);
    }

    public function duplicate(User $user, Scene $source, string $name): Scene
    {
        return DB::transaction(function () use ($user, $source, $name) {
            $campaign = Campaign::whereKey($source->campaign_id)->lockForUpdate()->firstOrFail();
            $source = Scene::whereKey($source->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $copy = $source->replicate(['revision']);
            $copy->name = $name;
            $copy->sort_order = ($campaign->scenes()->max('sort_order') ?? -1) + 1;
            $copy->save();
            foreach ($source->tokens()->with(['character', 'conditions'])->get() as $token) {
                $next = $token->replicate();
                $next->scene_id = $copy->id;
                $next->interactions = [];
                if ($token->character && $token->character->kind === 'npc') {
                    $next->character_id = app(NpcLibrary::class)->clone($token->character, $campaign, $user)->id;
                }
                $next->save();
                foreach ($token->conditions as $condition) {
                    $next->conditions()->create($condition->only(['key', 'label', 'normalized_label', 'visibility', 'created_by']));
                }
            }
            foreach ($source->props()->get() as $prop) {
                $next = $prop->replicate();
                $next->scene_id = $copy->id;
                // Interaction references belong to the original scene's automation.
                $next->interactions = [];
                $next->save();
            }
            foreach ($source->fogActions()->get()->concat(SceneNote::where('scene_id', $source->id)->get()) as $object) {
                $next = $object->replicate();
                $next->scene_id = $copy->id;
                $next->save();
            }
            app(ScenePublisher::class)->campaign($campaign);

            return $copy;
        }, 3);
    }
}
