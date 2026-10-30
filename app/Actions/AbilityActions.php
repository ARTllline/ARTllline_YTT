<?php

namespace App\Actions;

use App\Combat\CombatExecution;
use App\Combat\ConditionRules;
use App\Combat\TurnBudget;
use App\Items\ItemActions;
use App\Models\AbilityExecution;
use App\Models\Campaign;
use App\Models\CampaignMember;
use App\Models\Character;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Services\AbilityGeometry;
use App\Services\DamageRoller;
use App\Services\SceneSnapshotBuilder;
use App\Spells\SpellCasting;
use App\Spells\SpellEffects;
use App\Spells\SpellScrolls;
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
            app(SpellEffects::class)->expire($scene);
            $character = $this->authorizeActor($user, $scene, $data);
            $context = ['sceneId' => (string) $scene->id, 'epoch' => (int) $data['epoch'], 'target' => $data['target'] ?? null, 'rollMode' => $data['rollMode'], ...array_intersect_key($data, array_flip(['castLevel', 'effectChoice', 'manualComplete']))];
            if ($existing = $this->replay($user, $character, $data['abilityId'], $context)) {
                return ['execution' => $existing];
            }
            Gate::forUser($user)->authorize('view', $scene);
            abort_unless($campaign->active_scene_id === $scene->id && $campaign->live_revision === $data['epoch'], 409, 'Сцена изменилась.');
            if ($character instanceof Character && $campaign->roleFor($user) !== 'gm') {
                abort_unless((int) CampaignMember::where('campaign_id', $campaign->id)->where('user_id', $user->id)->value('active_character_id') === $character->id, 409, 'Выберите этого персонажа как действующего.');
            }
            $ability = $fromItem && isset($data['inventoryItemId']) && $character instanceof Character ?
                app(ItemActions::class)->resolve($character, $character->inventory()->with('definition')->findOrFail($data['inventoryItemId']), $data['itemAction'] ?? 'use') :
                collect($character->abilities ?? [])->firstWhere('id', $data['abilityId']);

            abort_unless($ability && $ability['enabled'], 403, 'Способность больше недоступна.');
            abort_if(($ability['item_only'] ?? false) && ! $fromItem, 403, 'Это действие доступно только через предмет.');
            if (isset($ability['spell'])) {
                abort_unless($character instanceof Character, 422, 'Заклинания требуют постоянного Character.');
                if ($data['manualComplete'] ?? false) {
                    abort_unless($campaign->roleFor($user) === 'gm' && ! app(TurnBudget::class)->active($scene->id), 403);
                }
                $data['_gmCompleted'] = $data['manualComplete'] ?? false;
                $ability = app(SpellCasting::class)->prepare($character, $ability, $data, $scene, $fromItem);
                $ability['_effectChoice'] = $data['effectChoice'] ?? null;
            }
            // A result runs with a current GM's authority, never a player-forged author ID.
            $author = $campaign->members()->wherePivot('role', 'gm')->orderBy('users.id')->firstOrFail();
            $actor = $character instanceof Token ? $character : $scene->tokens()->where('character_id', $character->id)->where('is_hidden', false)->first();
            abort_if(isset($ability['spell']) && ! empty($ability['spell']['effects']) && ! $actor, 422, 'Для эффектов заклинания разместите доступный токен персонажа.');
            abort_if(isset($ability['spell']) && ($ability['requires_sight'] ?? false) && $actor && app(ConditionRules::class)->has($actor, ['blinded']), 422, 'Для этого заклинания нужно видеть цель; персонаж ослеплён.');
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
            if (isset($ability['spell'])) {
                app(SpellCasting::class)->spend($character, $ability, $scene, $fromItem);
                if ($ability['spell']['concentration']) {
                    app(SpellEffects::class)->stop($character, 'replacement');
                }
            }
            abort_if(count($victims) > 200, 422, 'Слишком много целей.');
            $scrollCheck = isset($ability['_scroll']) ? app(SpellScrolls::class)->check($character, $ability, $actor) : null;
            $resolved = $scrollCheck && ! $scrollCheck['success'] ? ['roll' => $scrollCheck, 'provenance' => $scrollCheck['provenance'], 'success' => false, 'critical' => false, 'damage' => null, 'damageRolls' => [], 'outcomes' => [], 'feedbacks' => []] : app(CombatExecution::class)->resolve($author, $character, $actor, $ability, $victims, $data['rollMode'], $scene);
            if (isset($ability['spell']) && (! $scrollCheck || $scrollCheck['success'])) {
                app(SpellEffects::class)->start($author, $character, $actor, $scene, $ability, $victims, $resolved);
            }
            $roll = $resolved['roll'];
            $provenance = $resolved['provenance'];
            $success = $resolved['success'];
            $damage = $resolved['damage'];
            $outcomes = $resolved['outcomes'];
            $feedbacks = $resolved['feedbacks'];
            $feedback = $feedbacks[0] ?? null;
            $healing = $healingRoll = null;
            if ($success) {
                $result = $ability['result'];
                if ($result['type'] === 'heal') {
                    $healingRoll = isset($result['dice']) ? app(DamageRoller::class)->roll($result['dice']) : null;
                    $healing = min(max(0, $target->max_hp - $target->hp), $healingRoll['total'] ?? $result['amount']);
                    app(TokenCombatActions::class)->adjustHp($author, $target, $healing);
                    if ($target instanceof Token) {
                        $feedback = ['tokenId' => (string) $target->id, 'text' => '+'.$healing, 'tone' => 'heal'];
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
                ...(isset($ability['spell']) ? ['castLevel' => $ability['_castLevel'], 'coverage' => $ability['spell']['coverage'] ?? 'PARTIAL', 'manualResolution' => ($ability['spell']['coverage'] ?? 'PARTIAL') !== 'FULL' ? 'pending' : null] : []),
                'abilityId' => $ability['id'], 'abilityName' => $ability['name'], 'category' => $ability['category'],
                'actorId' => (string) $character->id, 'actorName' => $character->name,
                'target' => $data['target'] ?? null, 'roll' => $roll, 'success' => $success,
                'provenance' => $provenance,
                'scrollCheck' => $scrollCheck, 'damage' => $damage, 'damageRolls' => $resolved['damageRolls'], 'critical' => $resolved['critical'], 'outcomes' => $outcomes, 'healing' => $healing, 'healingRoll' => $healingRoll,
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
