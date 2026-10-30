<?php

namespace App\Http\Controllers;

use App\Actions\AbilityActions;
use App\Actions\CharacterActions;
use App\Actions\SceneTransaction;
use App\Combat\GMResolutions;
use App\Models\AbilityExecution;
use App\Models\Campaign;
use App\Models\Scene;
use App\Models\SpellEffect;
use App\Spells\SpellCasting;
use App\Spells\SpellEffects;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class SpellcastingController extends Controller
{
    public function index(Request $r, Campaign $campaign): array
    {
        Gate::forUser($r->user())->authorize('update', $campaign);
        $c = $campaign->characters()->findOrFail($r->validate(['characterId' => 'required|integer|min:1'])['characterId']);

        return ['pending' => AbilityExecution::where('character_id', $c->id)->latest('created_at')->limit(100)->get()->filter(fn ($e) => ($e->result['manualResolution'] ?? '') === 'pending')->map(fn ($e) => ['id' => $e->id, 'name' => $e->result['abilityName'], 'castLevel' => $e->result['castLevel'] ?? null, 'createdAt' => $e->created_at])->values()->all()];
    }

    public function command(Request $r, Campaign $campaign): array
    {
        $d = $r->validate(['clientMutationId' => 'required|uuid', 'characterId' => 'required|integer|min:1', 'action' => 'required|in:configure,restore,adjust,end-effect,resolve',
            'slots' => 'sometimes|array:1,2,3,4,5,6,7,8,9', 'slots.*' => 'array:max,current', 'slots.*.max' => 'required|integer|between:0,99', 'slots.*.current' => 'required|integer|between:0,99',
            'level' => 'sometimes|integer|between:1,9', 'current' => 'sometimes|integer|between:0,99', 'cantrip_tier' => 'sometimes|integer|between:1,4',
            'scroll_list' => 'sometimes|array|list|max:339', 'scroll_list.*' => 'string|max:100|distinct', 'scroll_max_level' => 'sometimes|integer|between:0,9', 'verbal_blocked' => 'sometimes|boolean',
            'recovery' => 'sometimes|in:manual,long_rest', 'effectId' => 'sometimes|uuid', 'executionId' => 'sometimes|uuid']);

        return DB::transaction(function () use ($r, $campaign, $d) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            $c = app(AbilityActions::class)->authorize($r->user(), $campaign, $d['characterId']);
            if ($d['action'] !== 'end-effect') {
                Gate::forUser($r->user())->authorize('update', $campaign);
            }
            if ($d['action'] === 'end-effect') {
                $effect = SpellEffect::where('character_id', $c->id)->findOrFail($d['effectId'] ?? '');
                app(SpellEffects::class)->end($effect, 'voluntary');
            } elseif ($d['action'] === 'resolve') {
                $cast = AbilityExecution::where('character_id', $c->id)->findOrFail($d['executionId'] ?? '');
                $scene = Scene::where('campaign_id', $campaign->id)->findOrFail($cast->context['sceneId']);
                app(SceneTransaction::class)->run($scene, function ($locked) use ($r, $cast) {
                    app(GMResolutions::class)->resolve($r->user(), $locked, $cast->id, 'resolved', '');

                    return [];
                }, 'combat.session');
            } else {
                $state = app(SpellCasting::class)->state($c);
                if ($d['action'] === 'configure') {
                    if (isset($d['recovery'])) {
                        $state['recovery'] = $d['recovery'];
                    }
                    foreach ($d['slots'] ?? [] as $level => $slot) {
                        abort_if($slot['current'] > $slot['max'], 422, 'Ячейки превышают максимум.');
                        $state['slots'][$level] = $slot;
                    }
                    $state = array_replace($state, array_intersect_key($d, array_flip(['cantrip_tier', 'scroll_list', 'scroll_max_level', 'verbal_blocked'])));
                } elseif ($d['action'] === 'restore') {
                    foreach ($state['slots'] as $level => &$slot) {
                        if (! isset($d['level']) || (int) $level === $d['level']) {
                            $slot['current'] = $slot['max'];
                        }
                    }
                    unset($slot);
                } elseif ($d['action'] === 'adjust') {
                    abort_unless(isset($d['level'], $d['current']), 422);
                    abort_if($d['current'] > $state['slots'][$d['level']]['max'], 422, 'Ячейки превышают максимум.');
                    $state['slots'][$d['level']]['current'] = $d['current'];
                } else {
                    abort(422);
                }
                $c->update(['spellcasting' => $state]);
            }
            app(CharacterActions::class)->publish($r->user(), $c->fresh());

            return ['character' => app(CharacterActions::class)->projection($c->fresh(), $campaign->roleFor($r->user()) === 'gm')];
        }, 3);
    }
}
