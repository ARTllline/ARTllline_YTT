<?php

namespace App\Http\Controllers;

use App\Actions\CueRunner;
use App\Models\Campaign;
use App\Models\Cue;
use App\Models\CueRun;
use App\Models\Scene;
use App\Services\CueDefinition;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class CueController extends Controller
{
    public function index(Request $request, Scene $scene): array
    {
        Gate::authorize('update', $scene);

        $query = CueRun::where('scene_id', $scene->id)->with(['steps' => fn ($q) => $q->select('id', 'cue_run_id', 'position', 'type', 'status')]);
        $pending = (clone $query)->whereIn('status', ['queued', 'running', 'failed']);
        $pendingCount = (clone $pending)->count();
        $runs = $pending->orderBy('queue_order')->limit(10)->get()
            ->concat((clone $query)->whereIn('status', ['completed', 'cancelled'])->latest()->limit(10)->get())
            ->map(fn ($run) => $run->toArray() + ['displayPosition' => $run->status === 'running' && $run->due_at?->isFuture() ? max(0, $run->position - 1) : $run->position]);

        return ['runs' => $runs, 'pendingCount' => $pendingCount] + ($request->boolean('runsOnly') ? [] : ['cues' => Cue::where('scene_id', $scene->id)->with('steps')->orderBy('sort_order')->orderBy('id')->get()]);
    }

    public function command(Request $request, Scene $scene, CueRunner $runner): array
    {
        Gate::authorize('update', $scene);
        $command = $request->route('command');
        if (in_array($command, ['cancel', 'retry'])) {
            $data = $request->validate(['runId' => 'required|uuid']);

            return ['run' => $runner->control($request->user(), $scene, $data['runId'], $command)->load('steps')];
        }

        return DB::transaction(function () use ($request, $scene, $runner, $command) {
            $campaign = Campaign::whereKey($scene->campaign_id)->lockForUpdate()->firstOrFail();
            Gate::authorize('update', $campaign);
            $scene = Scene::whereKey($scene->id)->lockForUpdate()->firstOrFail();
            if ($command === 'save') {
                $data = app(CueDefinition::class)->validate($scene, $request->all());
                $id = $request->validate(['cueId' => 'nullable|integer|min:1'])['cueId'] ?? null;
                if ($id) {
                    $cue = Cue::where('scene_id', $scene->id)->findOrFail($id);
                } else {
                    abort_if(Cue::where('scene_id', $scene->id)->count() >= 100, 422, 'В сцене можно подготовить до 100 событий.');
                    $cue = new Cue(['scene_id' => $scene->id]);
                }
                $cue->fill(['name' => $data['name'], 'description' => $data['description'] ?? null, 'sort_order' => $data['sort_order'] ?? 0])->save();
                $cue->steps()->delete();
                foreach ($data['steps'] as $position => $step) {
                    $cue->steps()->create($step + ['position' => $position]);
                }

                return ['cue' => $cue->load('steps')];
            }
            $data = $request->validate(['cueId' => 'required|integer|min:1']);
            $cue = Cue::where('scene_id', $scene->id)->findOrFail($data['cueId']);
            if ($command === 'delete') {
                $cue->delete();

                return ['deleted' => true];
            }

            return ['run' => $runner->start($request->user(), $scene, $cue)->load('steps')];
        });
    }
}
