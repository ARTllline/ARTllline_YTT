<?php

namespace App\Http\Controllers;

use App\Actions\ObjectInteraction;
use App\Actions\ObjectInteractionActions;
use App\Actions\RegionActions;
use App\Actions\TriggerActions;
use App\Models\Cue;
use App\Models\Handout;
use App\Models\Scene;
use App\Models\SceneTrigger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class AutomationController extends Controller
{
    public function index(Request $request, Scene $scene): array
    {
        Gate::authorize('update', $scene);
        $query = SceneTrigger::where('scene_id', $scene->id);
        if ($request->boolean('summary')) {
            return ['enabled' => (clone $query)->where('enabled', true)->count()];
        }
        $triggers = $query->orderBy('id')->get();

        return ['triggers' => $triggers->map(fn ($t) => $t->projection())->all(),
            'cues' => Cue::where('scene_id', $scene->id)->orderBy('name')->get(['id', 'name'])->map(fn ($c) => ['id' => (string) $c->id, 'name' => $c->name])->all(),
            'history' => DB::table('trigger_fires')->whereIn('trigger_id', $triggers->pluck('id'))->orderByDesc('id')->limit(30)->get(['id', 'trigger_id', 'source_event', 'source_key', 'cue_run_id', 'fired_at'])->all()];
    }

    public function regions(Request $request, Scene $scene, RegionActions $actions): array
    {
        return $actions->execute($request->user(), $scene, $request->all());
    }

    public function triggers(Request $request, Scene $scene, TriggerActions $actions): array
    {
        return $actions->execute($request->user(), $scene, $request->all());
    }

    public function interact(Request $request, Scene $scene, ObjectInteraction $action): array
    {
        $data = $request->validate(['kind' => 'required|in:token,prop', 'id' => 'required|integer|min:1', 'epoch' => 'required|integer|min:0',
            'actionId' => 'sometimes|required|uuid', 'result_target' => 'prohibited', 'result_type' => 'prohibited', 'cueId' => 'prohibited', 'handoutId' => 'prohibited']);

        return $action->execute($request->user(), $scene, $data);
    }

    public function objectActions(Request $request, Scene $scene, ObjectInteractionActions $actions): array
    {
        return $actions->save($request->user(), $scene, $request->all());
    }

    public function interactionResources(Scene $scene): array
    {
        Gate::authorize('update', $scene);

        return [
            'handouts' => Handout::where('campaign_id', $scene->campaign_id)->orderBy('title')->get(['id', 'title'])->map(fn ($h) => ['id' => (string) $h->id, 'name' => $h->title])->all(),
            'cues' => Cue::where('scene_id', $scene->id)->orderBy('name')->get(['id', 'name'])->map(fn ($c) => ['id' => (string) $c->id, 'name' => $c->name])->all(),
        ];
    }
}
