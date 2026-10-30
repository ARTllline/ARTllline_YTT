<?php

namespace App\Actions;

use App\Combat\CombatExecution;
use App\Combat\TurnBudget;
use App\Models\AbilityExecution;
use App\Models\Campaign;
use App\Models\CampaignMember;
use App\Models\Character;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Services\AbilityGeometry;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class AbilityActions
{
    /** Also called on transport receipt replay: revoked ownership never replays private data. */
    public function authorize(User $user, Campaign $campaign, int $characterId): Character
    {
        Gate::forUser($user)->authorize('view', $campaign);
        $character = $campaign->characters()->findOrFail($characterId);
        abort_unless($campaign->roleFor($user) === 'gm' || $character->owner_user_id === $user->id, 403);

        return $character;
    }

    public function authorizeActor(User $user, Scene $scene, array $data): Character|Token
    {
        if (! empty($data['actorTokenId'])) {
            Gate::forUser($user)->authorize('view', $scene);
            $token = $scene->tokens()->findOrFail($data['actorTokenId']);
            abort_if($token->character_id, 422, 'Для связанного токена используйте Character.');
            abort_unless($scene->campaign->roleFor($user) === 'gm' || (! $token->is_hidden && $token->owner_user_id === $user->id), 403);

            return $token;
        }

        return $this->authorize($user, $scene->campaign, (int) $data['characterId']);
    }

    private function replay(User $user, Character|Token $character, string $key, array $context): ?array
    {
        $existing = AbilityExecution::where('user_id', $user->id)->where('mutation_id', app(CommandContext::class)->id())->first();
        if (! $existing) {
            return null;
        }
        abort_unless(($character instanceof Token ? $existing->token_id === $character->id : $existing->character_id === $character->id) && $existing->ability_key === $key && $existing->context == $context, 409);

        return $existing->result;
    }

    private function record(User $user, Character|Token $character, string $key, array $context, array $result): array
    {
        $id = (string) Str::uuid();
        $result['id'] = $id;
        AbilityExecution::create(['id' => $id, 'campaign_id' => $character instanceof Token ? $character->scene->campaign_id : $character->campaign_id,
            'character_id' => $character instanceof Character ? $character->id : null, 'token_id' => $character instanceof Token ? $character->id : null, 'user_id' => $user->id, 'mutation_id' => app(CommandContext::class)->id(),
            'ability_key' => $key, 'context' => $context, 'result' => $result, 'created_at' => now()]);

        return $result;
    }

    public function resource(User $user, Campaign $campaign, array $data): array
    {
        return DB::transaction(function () use ($user, $campaign, $data) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            $character = $this->authorize($user, $campaign, $data['characterId']);
            $context = ['key' => $data['key'], 'delta' => (int) $data['delta']];
            if ($existing = $this->replay($user, $character, 'resource:'.$data['key'], $context)) {
                return $existing;
            }
            $resources = $character->resources ?? [];
            $index = collect($resources)->search(fn ($r) => $r['key'] === $data['key']);
            abort_if($index === false, 422, 'Ресурс больше недоступен.');
            abort_unless($campaign->roleFor($user) === 'gm' || $resources[$index]['player_adjustable'], 403);
            $resources[$index]['current'] = max(0, min($resources[$index]['max'], $resources[$index]['current'] + $data['delta']));
            $character->update(['resources' => $resources]);
            app(CharacterActions::class)->publish($user, $character);

            return $this->record($user, $character, 'resource:'.$data['key'], $context, ['accepted' => true]);
        }, 3);
    }

    public function execute(User $user, Scene $scene, array $data, bool $fromItem = false): array
    {
        return DB::transaction(function () use ($user, $scene, $data, $fromItem) {
            $campaign = Campaign::whereKey($scene->campaign_id)->lockForUpdate()->firstOrFail();
            $scene = Scene::whereKey($scene->id)->lockForUpdate()->firstOrFail();
            $scene->setRelation('campaign', $campaign);
            $character = $this->authorizeActor($user, $scene, $data);
            $context = ['sceneId' => (string) $scene->id, 'epoch' => (int) $data['epoch'], 'target' => $data['target'] ?? null, 'rollMode' => $data['rollMode']];
            if ($existing = $this->replay($user, $character, $data['abilityId'], $context)) {
                return ['execution' => $existing];
            }
            Gate::forUser($user)->authorize('view', $scene);
            abort_unless($campaign->active_scene_id === $scene->id && $campaign->live_revision === $data['epoch'], 409, 'Сцена изменилась.');
            if ($character instanceof Character && $campaign->roleFor($user) !== 'gm') {
                abort_unless((int) CampaignMember::where('campaign_id', $campaign->id)->where('user_id', $user->id)->value('active_character_id') === $character->id, 409, 'Выберите этого персонажа как действующего.');
            }
            $ability = collect($character->abilities ?? [])->firstWhere('id', $data['abilityId']);
            abort_unless($ability && $ability['enabled'], 403, 'Способность больше недоступна.');
            abort_if(($ability['item_only'] ?? false) && ! $fromItem, 403, 'Это действие доступно только через предмет.');
            abort_if(isset($ability['spell']) && (! $ability['spell']['known'] || ! $ability['spell']['prepared']), 403, 'Заклинание не подготовлено.');
            // A result runs with a current GM's authority, never a player-forged author ID.
            $author = $campaign->members()->wherePivot('role', 'gm')->orderBy('users.id')->firstOrFail();
            $actor = $character instanceof Token ? $character : $scene->tokens()->where('character_id', $character->id)->where('is_hidden', false)->first();
            $target = $this->target($scene, $ability['target'], $data['target'] ?? null, $character, $actor);
            $areaTargets = app(AbilityGeometry::class)->validate($scene, $ability, $actor, $target, $data['target'] ?? null);
            $isArea = ! empty($ability['area']) && $ability['area']['shape'] !== 'none';
            $resources = $character->resources ?? [];
            foreach ($ability['costs'] as $cost) {
                $index = collect($resources)->search(fn ($r) => $r['key'] === $cost['key']);
                abort_if($index === false || $resources[$index]['current'] < $cost['amount'], 422, 'Недостаточно ресурса для способности.');
                $resources[$index]['current'] -= $cost['amount'];
            }
            app(TurnBudget::class)->spend($actor, $ability['activation'] ?? 'action', $scene->id);
            $victims = $isArea ? $areaTargets : ($target instanceof Token ? [$target] : []);
            abort_if(count($victims) > 200, 422, 'Слишком много целей.');
            $resolved = app(CombatExecution::class)->resolve($author, $character, $actor, $ability, $victims, $data['rollMode'], $scene);
            $roll = $resolved['roll'];
            $provenance = $resolved['provenance'];
            $success = $resolved['success'];
            $damage = $resolved['damage'];
            $outcomes = $resolved['outcomes'];
            $feedbacks = $resolved['feedbacks'];
            $feedback = $feedbacks[0] ?? null;
            if ($success) {
                $result = $ability['result'];
                if ($result['type'] === 'heal') {
                    app(TokenCombatActions::class)->adjustHp($author, $target, $result['amount']);
                    if ($target instanceof Token) {
                        $feedback = ['tokenId' => (string) $target->id, 'text' => '+'.$result['amount'], 'tone' => 'heal'];
                    }
                } elseif (in_array($result['type'], ['cue', 'handout'])) {
                    app(ObjectInteraction::class)->result($user, $scene, $author->id, ['result_type' => $result['type'], 'result_target' => $result['target']]);
                }
            }
            $character = $character->fresh(); // Healing a linked actor may already have updated HP.
            $character->update(['resources' => $resources]);
            if ($character instanceof Character) {
                app(CharacterActions::class)->publish($author, $character, $scene->id);
            }
            app(SceneTransaction::class)->run($scene, function ($locked) use ($user, $target, $feedback, $feedbacks, $isArea, $areaTargets) {
                if ($isArea) {
                    return ['_combatChanged' => true, 'charactersChanged' => true, 'gameplayFeedbacks' => $feedbacks,
                        'tokens' => array_values(array_map(fn ($token) => app(SceneSnapshotBuilder::class)->token($token->fresh(), true, $user), $areaTargets))];
                }
                $token = $target instanceof Token ? $target->fresh() : null;

                return ['_combatChanged' => true, 'charactersChanged' => true, 'gameplayFeedback' => $feedback]
                    + ($token ? ['token' => app(SceneSnapshotBuilder::class)->token($token, true, $user), '_wasVisible' => true] : []);
            }, $isArea ? 'objects.changed' : 'ability.resolved');
            // Persist the full authoritative roll; redact DC only in the player response below.
            $execution = $this->record($user, $character, $ability['id'], $context, [
                'abilityId' => $ability['id'], 'abilityName' => $ability['name'], 'category' => $ability['category'],
                'actorId' => (string) $character->id, 'actorName' => $character->name,
                'target' => $data['target'] ?? null, 'roll' => $roll, 'success' => $success,
                'provenance' => $provenance,
                'damage' => $damage, 'damageRolls' => $resolved['damageRolls'], 'critical' => $resolved['critical'], 'outcomes' => $outcomes, 'healing' => $success && $ability['result']['type'] === 'heal' ? $ability['result']['amount'] : null,
                'dcVisible' => $ability['check']['dc_visible'] ?? false,
                'mutationId' => app(CommandContext::class)->id(), 'resolvedAt' => now()->toIso8601String(),
            ]);

            return ['execution' => $execution];
        }, 3);
    }

    private function target(Scene $scene, string $type, ?array $input, Character|Token $character, ?Token $actor): Token|Character|array|null
    {
        if ($type === 'self' || $type === 'none') {
            abort_if($input !== null, 422, 'Эта способность не выбирает внешнюю цель.');

            return $type === 'self' ? ($actor ?? $character) : null;
        }
        abort_unless($actor, 422, 'Для выбора цели нужен доступный токен персонажа на сцене.');
        abort_unless(($input['kind'] ?? null) === $type, 422, 'Выберите подходящую цель.');
        if ($type === 'point') {
            abort_unless(isset($input['x'], $input['y']) && $input['x'] >= 0 && $input['y'] >= 0 && $input['x'] <= $scene->width && $input['y'] <= $scene->height, 422);

            return $input;
        }
        $object = app(ObjectInteractionActions::class)->object($scene, $type, $input['id'] ?? 0);
        abort_if($object->is_hidden, 403);

        return $object instanceof Token ? $object : null;
    }
}
