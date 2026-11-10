<?php

namespace App\Actions;

use App\Models\Campaign;
use App\Models\Scene;
use App\Realtime\CommandContext;
use App\Realtime\ScenePublisher;
use App\Services\CombatView;
use App\Services\FogExploration;
use App\Services\SceneVisibility;
use App\Services\StructureData;
use App\Spells\SpellEffects;
use Closure;
use Illuminate\Support\Facades\DB;

class SceneTransaction
{
    public function run(Scene $scene, Closure $mutation, string $type = 'scene.updated'): array
    {
        return DB::transaction(function () use ($scene, $mutation, $type) {
            // Every writer locks campaign then scene, including activation and deletion.
            $campaign = Campaign::whereKey($scene->campaign_id)->lockForUpdate()->firstOrFail();
            $locked = Scene::whereKey($scene->id)->lockForUpdate()->firstOrFail();
            $locked->setRelation('campaign', $campaign);
            $vision = app(SceneVisibility::class);
            $before = app(SpellEffects::class)->project(function () use ($locked, $type, $campaign, $vision) {
                $before = [];
                if ($locked->vision_enabled || $type === 'vision.updated') {
                    foreach ($campaign->members()->wherePivot('role', 'player')->get() as $member) {
                        $before[$member->id] = $vision->projection($locked, $member);
                    }
                }

                return $before;
            });
            $geometryBefore = $before ? $vision->movementGeometryKey($locked) : null;
            $result = $mutation($locked);
            if ($result['_combatChanged'] ?? false) {
                $result['combat'] = app(CombatView::class)->build($locked, true);
            }
            unset($result['_combatChanged']);
            $wasVisible = $result['_wasVisible'] ?? false;
            unset($result['_wasVisible']);
            $previousVisibility = $result['_previousVisibility'] ?? ['tokens' => [], 'props' => []];
            unset($result['_previousVisibility']);
            // Private light blockers may change without any public structure delta.
            if (($locked->lighting['enabled'] ?? false) && (isset($result['_structureBefore']) || isset($result['propEdits']) || isset($result['props']) || isset($result['deletedPropIds'])
                || array_key_exists('mapWorld', $result) || isset($result['scene']['width']) || isset($result['scene']['height']))) {
                $result['_lightingInvalidated'] = true;
            }
            $locked->increment('revision');
            $vision->invalidate($locked);
            if ($geometryBefore !== null) {
                $result['movementGeometryChanged'] = $geometryBefore !== $vision->movementGeometryKey($locked);
            }
            // Commit territory before recipient deltas; party viewers receive the same union
            // even when only another participant moved. No online-presence dependency.
            if ($locked->vision_enabled) {
                $changedViewers = [];
                foreach ($campaign->members()->wherePivot('role', 'player')->get() as $member) {
                    if ($type === 'vision.updated' || ($before[$member->id]['viewSignature'] ?? null) !== $vision->view($locked, $member)['signature']) {
                        $changedViewers[] = $member;
                    }
                }
                if ($changedViewers) {
                    app(FogExploration::class)->record($locked, $changedViewers);
                    if ($locked->lighting['enabled'] ?? false) $result['_lightingInvalidated'] = true;
                }
            }
            $result = ['revision' => $locked->revision, 'mutationId' => app(CommandContext::class)->id()] + $result;
            $locked->setRelation('campaign', $campaign);

            // One immutable DTO scope after all writes, separate from the before scope.
            return app(SpellEffects::class)->project(function () use ($locked, $type, $result, $wasVisible, $previousVisibility, $before, $campaign, $vision) {
                app(ScenePublisher::class)->changed($locked, $type, $result, $wasVisible, $previousVisibility, $before);
                app(\App\Services\SceneLighting::class)->schedule($locked, $result, $type);
                unset($result['_lightingInvalidated']);

                $viewer = auth()->user();
                if ($viewer && $campaign->roleFor($viewer) === 'player' && array_key_exists('combat', $result)) {
                    $result['combat'] = app(CombatView::class)->build($locked, false, $viewer);
                }

                if ($viewer && $campaign->roleFor($viewer) === 'player' && isset($before[$viewer->id])) {
                    $payload = app(ScenePublisher::class)->visionPayload($locked, $viewer, $result, $before[$viewer->id]);
                    if (isset($result['token']) && $vision->view($locked, $viewer)['tokens']->contains('id', (int) $result['token']['id'])) {
                        $payload['token'] = collect($vision->projection($locked, $viewer)['tokens'])->firstWhere('id', (string) $result['token']['id']);
                    }
                    $result = array_intersect_key($result, array_flip(['revision', 'mutationId'])) + $payload;
                } elseif ($viewer && $campaign->roleFor($viewer) === 'player' && isset($result['_structureBefore'])) {
                    $result += StructureData::patch($locked, $result['_structureBefore'], false);
                }

                unset($result['_structureBefore']);

                return $result;
            });
        }, 3);
    }
}
