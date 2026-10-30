<?php

namespace App\Actions;

use App\Http\Controllers\AbilityController;
use App\Items\LootActions;
use App\Models\Campaign;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Services\SceneSnapshotBuilder;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpFoundation\Response;

class IdempotentCommand
{
    public function execute(User $user, string $id, string $operation, int $resource, array $payload, Closure $next): Response
    {
        $sort = function (array $value) use (&$sort): array {
            ksort($value);

            return array_map(fn ($item) => is_array($item) ? $sort($item) : $item, $value);
        };
        $hash = hash('sha256', json_encode([$operation, $resource, $sort($payload)], JSON_THROW_ON_ERROR));
        // Resolve routing before opening the transaction: a consistent read here
        // would pin MySQL REPEATABLE READ to a snapshot older than the writer lock.
        $existing = DB::table('scene_mutation_receipts')->where('user_id', $user->id)->where('client_mutation_id', $id)->first();
        $campaignId = $existing?->campaign_id ?? match (true) {
            str_starts_with($operation, 'token.') => Token::findOrFail($resource)->scene->campaign_id,
            in_array($operation, ['scene.create', 'scene.activate']) || str_starts_with($operation, 'campaign.') => Campaign::findOrFail($resource)->id,
            default => Scene::findOrFail($resource)->campaign_id,
        };
        try {
            return DB::transaction(function () use ($user, $id, $operation, $resource, $hash, $next, $campaignId, $payload) {
                // Acquire the campaign writer lock before the receipt FK acquires a
                // shared lock on it. Concurrent receipt inserts otherwise deadlock
                // when SceneTransaction later upgrades that same campaign lock.
                $campaign = Campaign::whereKey($campaignId)->lockForUpdate()->firstOrFail();
                // Unique insertion serializes retries even across processes and scenes.
                // Reservation and result commit together; no incomplete receipt is visible.
                DB::table('scene_mutation_receipts')->insertOrIgnore([
                    'user_id' => $user->id, 'client_mutation_id' => $id, 'fingerprint' => $hash,
                    'campaign_id' => $campaignId, 'operation' => $operation, 'resource_id' => $resource,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
                $receipt = DB::table('scene_mutation_receipts')->where('user_id', $user->id)->where('client_mutation_id', $id)->lockForUpdate()->first();
                abort_unless(hash_equals($receipt->fingerprint, $hash), 409, 'This mutation ID was already used for a different command.');
                if ($receipt->result !== null) {
                    $result = json_decode($receipt->result, true, flags: JSON_THROW_ON_ERROR);
                    if ($operation === 'token.move' && $campaign->roleFor($user) !== 'gm') {
                        abort_if(array_key_exists('isHidden', $result['token']), 403, 'Your role changed. Reload the scene before moving again.');
                        $token = Token::findOrFail($resource);
                        Gate::forUser($user)->authorize('move', $token);
                        // A former GM may now be a player. Never replay the older privileged DTO.
                        $safe = app(SceneSnapshotBuilder::class)->token($token, false, $user);
                        $result['token'] = array_intersect_key($result['token'], $safe);
                        $result['token']['canMove'] = $safe['canMove'];
                        $result['token']['conditions'] = array_values(array_filter($result['token']['conditions'] ?? [], fn ($condition) => in_array($condition['id'], array_column($safe['conditions'], 'id'), true)));
                    } elseif ($operation === 'campaign.loot') {
                        app(LootActions::class)->authorize($user, $campaign, $payload);
                        app(LootActions::class)->assertReceiptReadable($user, $campaign, $result);
                    } elseif ($operation === 'campaign.inventory.command') {
                        app(AbilityActions::class)->authorize($user, $campaign, $payload['_routeCharacterId']);
                        if (in_array($payload['action'] ?? '', ['give', 'remove', 'put']) || (($payload['action'] ?? '') === 'configure' && array_key_exists('weapon_proficient', $payload))) {
                            Gate::forUser($user)->authorize('update', $campaign);
                        }
                    } elseif (in_array($operation, ['scene.ability', 'campaign.resource', 'scene.inventory.use'])) {
                        if ($operation === 'scene.ability') {
                            app(AbilityActions::class)->authorizeActor($user, Scene::findOrFail($resource), $payload);
                        } else {
                            app(AbilityActions::class)->authorize($user, $campaign, $payload['characterId']);
                        }
                    } elseif ($operation === 'scene.interact') {
                        $scene = Scene::findOrFail($resource);
                        $scene->setRelation('campaign', $campaign);
                        app(ObjectInteraction::class)->authorize($user, $scene, $payload);
                        // A GM preview receipt must never be replayed after becoming a player.
                        abort_if(isset($result['handout']) && $campaign->roleFor($user) !== 'gm', 403);
                    } else {
                        Gate::forUser($user)->authorize('update', $campaign);
                    }

                    if (in_array($operation, ['scene.ability', 'scene.inventory.use']) && $campaign->roleFor($user) !== 'gm') {
                        $result = AbilityController::present($result);
                    }

                    return new JsonResponse($result, $receipt->status, ['Idempotent-Replay' => 'true']);
                }
                $response = $next();
                if ($response->getStatusCode() >= 400) {
                    throw new RejectedCommand($response);
                }
                $result = json_decode($response->getContent(), true, flags: JSON_THROW_ON_ERROR);
                $result['mutationId'] = $id;
                DB::table('scene_mutation_receipts')->where('id', $receipt->id)->update([
                    'result_revision' => $result['revision'] ?? null, 'result' => json_encode($result, JSON_THROW_ON_ERROR),
                    'status' => $response->getStatusCode(), 'updated_at' => now(),
                ]);

                return new JsonResponse($result, $response->getStatusCode());
            }, 3);
        } catch (RejectedCommand $rejected) {
            return $rejected->response;
        }
    }
}
