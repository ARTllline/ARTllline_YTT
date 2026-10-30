<?php

namespace App\Http\Controllers;

use App\Combat\AdventuringActions;
use App\Models\Scene;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class AdventuringController extends Controller
{
    public function command(Request $request, Scene $scene): array
    {
        $d = $request->validate([
            'action' => 'required|in:death-save,stabilize,short-rest,long-rest,spend-die,finish-rest,stable,revive,reset-saves,exhaustion,configure-dice,npc-outcome,reduction,knock-out,stable-recovery',
            'maxHpLoss' => 'sometimes|integer|between:0,9999',
            'scoreLoss' => 'sometimes|array:str,dex,con,int,wis,cha', 'scoreLoss.*' => 'integer|between:0,29',
            'tokenId' => 'required_unless:action,short-rest,long-rest|integer|min:1',
            'targetId' => 'required_if:action,stabilize|integer|min:1',
            'characterIds' => 'required_if:action,short-rest,long-rest|array|min:1|max:30', 'characterIds.*' => 'integer|min:1|distinct',
            'confirmWorldTime' => 'sometimes|boolean', 'combatOverride' => 'sometimes|boolean',
            'die' => 'required_if:action,spend-die|in:d6,d8,d10,d12', 'restId' => 'required_if:action,spend-die,finish-rest|uuid',
            'hp' => 'required_if:action,revive|integer|between:1,9999', 'level' => 'required_if:action,exhaustion|integer|between:0,6',
            'outcome' => 'required_if:action,npc-outcome|in:dead,defeated,unconscious',
            'pools' => 'present_if:action,configure-dice|array|list|max:4', 'pools.*' => 'array:die,max,current',
            'pools.*.die' => 'required|in:d6,d8,d10,d12|distinct', 'pools.*.max' => 'required|integer|between:1,100', 'pools.*.current' => 'required|integer|between:0,100',
        ]);
        $result = app(AdventuringActions::class)->execute($request->user(), $scene, $d);
        if ($scene->campaign->roleFor($request->user()) !== 'gm') {
            // SceneTransaction publishes filtered events; HTTP needs the same boundary.
            $result['tokens'] = $scene->tokens()->whereIn('id', array_column($result['tokens'] ?? [], 'id'))->where('is_hidden', false)->get()
                ->map(fn ($t) => app(SceneSnapshotBuilder::class)->token($t, false, $request->user()))->all();
        }

        return $result;
    }

    public function history(Scene $scene): array
    {
        Gate::authorize('update', $scene);

        return ['events' => DB::table('lifecycle_commands')->where('scene_id', $scene->id)->latest('id')->limit(30)->get()->map(fn ($r) => ['id' => $r->id, 'createdAt' => $r->created_at, 'result' => json_decode($r->result, true)])->all()];
    }
}
