<?php

namespace App\Actions;

use App\Events\TabletopEvent;
use App\Models\ObjectCheck;
use App\Models\Scene;
use App\Models\User;
use App\Realtime\ChannelAccess;
use App\Realtime\CommandContext;
use App\Realtime\SafeBroadcast;
use App\Services\CheckRoller;
use App\Services\TokenCheckStats;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class ObjectCheckActions
{
    /** Called under the campaign writer lock, inside the mutation receipt transaction. */
    public function execute(User $user, Scene $scene, array $data, array $action): array
    {
        $checks = ObjectCheck::where('scene_id', $scene->id)->where('object_kind', $data['kind'])
            ->where('object_id', $data['id'])->where('action_id', $action['id']);
        $context = ['actorTokenId' => isset($data['actorTokenId']) ? (string) $data['actorTokenId'] : null, 'rollMode' => $data['rollMode'] ?? 'normal'];
        $mutation = app(CommandContext::class)->id();
        // Durable roll identity also survives eventual transport-receipt cleanup.
        $existing = ObjectCheck::where('user_id', $user->id)->where('mutation_id', $mutation)->first();
        if ($existing) {
            abort_unless($existing->scene_id === $scene->id && $existing->object_kind === $data['kind']
                && $existing->object_id === (int) $data['id'] && $existing->action_id === $action['id'], 409);

            abort_if($existing->request_context !== null && $existing->request_context != $context, 409);

            return ['accepted' => true, 'check' => $existing->projection()];
        }
        $config = $action['check'];
        if ($config['retry'] !== 'repeatable') {
            $previous = $checks->when($config['retry'] === 'once_per_player', fn ($q) => $q->where('user_id', $user->id))->oldest('created_at')->first();
            if ($previous) {
                abort_unless($previous->user_id === $user->id, 409, 'Эта проверка уже выполнена.');

                return ['accepted' => true, 'check' => $previous->projection()];
            }
        }
        $token = null;
        if (isset($data['actorTokenId'])) {
            $token = $scene->tokens()->findOrFail($data['actorTokenId']);
            // Actor authorization also runs on receipt replay.
        } else {
            $owned = $scene->tokens()->with('character')->where('is_hidden', false)->where(function ($q) use ($user) {
                $q->where(fn ($q) => $q->whereNull('character_id')->where('owner_user_id', $user->id))
                    ->orWhereHas('character', fn ($q) => $q->where('owner_user_id', $user->id));
            })->limit(2)->get();
            $token = $owned->count() === 1 ? $owned->first() : null;
        }
        $provenance = app(TokenCheckStats::class)->resolve($token, $config);
        $roll = app(CheckRoller::class)->roll($provenance['finalModifier'], $config['dc'], $context['rollMode']);
        $dice = $roll['rawDice'];
        $mode = $roll['rollMode'];
        $natural = $roll['natural'];
        $total = $roll['total'];
        $success = $roll['success'];
        $branch = $config[$success ? 'success' : 'failure'];
        $check = ObjectCheck::create(['id' => (string) Str::uuid(), 'scene_id' => $scene->id,
            'object_kind' => $data['kind'], 'object_id' => $data['id'], 'action_id' => $action['id'],
            'user_id' => $user->id, 'token_id' => $token?->id, 'mutation_id' => $mutation,
            'action_label' => $action['label'], 'label' => $config['label'], 'ability_key' => $config['ability_key'] ?? null,
            'provenance' => $provenance, 'raw_dice' => $dice, 'roll_mode' => $mode, 'request_context' => $context,
            'natural' => $natural, 'modifier' => $provenance['finalModifier'], 'total' => $total, 'dc' => $config['dc'],
            'dc_visible' => $config['dc_visible'] ?? false, 'success' => $success, 'branch' => $branch, 'created_at' => now()]);
        $result = app(ObjectInteraction::class)->result($user, $scene, $action['author_id'], $branch);
        $event = new TabletopEvent(ChannelAccess::gm($scene->campaign_id, $scene->id), [
            'type' => 'check.resolved', 'sceneId' => (string) $scene->id, 'check' => $check->projection(),
            'actor' => ['id' => (string) $user->id, 'name' => $user->name],
            'kind' => $data['kind'], 'objectId' => (string) $data['id'],
        ]);
        DB::afterCommit(fn () => app(SafeBroadcast::class)->send($event));

        return ['accepted' => true, 'check' => $check->projection()] + $result;
    }

    public function history(User $user, Scene $scene, string $kind, int $id): array
    {
        Gate::forUser($user)->authorize('update', $scene);
        app(ObjectInteractionActions::class)->object($scene, $kind, $id);

        return ['checks' => ObjectCheck::where('scene_id', $scene->id)->where('object_kind', $kind)->where('object_id', $id)
            ->orderByDesc('created_at')->limit(20)->get()->map(fn ($c) => $c->projection() + [
                'actor' => ['id' => (string) $c->user_id, 'name' => User::find($c->user_id)?->name ?? 'Игрок'],
                'dc' => (int) $c->dc,
            ])->all()];
    }
}
