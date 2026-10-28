<?php

namespace App\Http\Controllers;

use App\Actions\CampaignActions;
use App\Actions\SceneActions;
use App\Models\Campaign;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class CampaignController extends Controller
{
    public function index(Request $request): array
    {
        return ['campaigns' => Campaign::whereHas('members', fn ($q) => $q->where('users.id', $request->user()->id))
            ->with(['members' => fn ($q) => $q->where('users.id', $request->user()->id)])->orderBy('name')->get()
            ->map(fn ($c) => ['id' => (string) $c->id, 'name' => $c->name, 'role' => $c->members->first()->pivot->role])->all()];
    }

    public function show(Request $request, Campaign $campaign): array
    {
        Gate::authorize('view', $campaign);
        $gm = $campaign->roleFor($request->user()) === 'gm';
        $data = ['id' => (string) $campaign->id, 'name' => $campaign->name, 'role' => $gm ? 'gm' : 'player',
            'activeSceneId' => $campaign->active_scene_id ? (string) $campaign->active_scene_id : null];
        $data['scenes'] = $campaign->scenes()->when(! $gm, fn ($q) => $q->whereKey($campaign->active_scene_id ?? 0))->orderBy('sort_order')->orderBy('id')->get(['id', 'name'])->map(fn ($s) => ['id' => (string) $s->id, 'name' => $s->name])->all();
        if ($gm) {
            $data['members'] = $campaign->members()->get()->map(fn ($u) => ['id' => (string) $u->id, 'name' => $u->name, 'role' => $u->pivot->role])->all();
        }

        return $data;
    }

    public function store(Request $request, CampaignActions $actions): array
    {
        $data = $request->validate(['name' => 'required|string|max:120']);

        return $this->show($request, $actions->create($request->user(), $data['name']));
    }

    public function update(Request $request, Campaign $campaign, CampaignActions $actions): array
    {
        Gate::authorize('update', $campaign);
        $actions->rename($request->user(), $campaign, $request->validate(['name' => 'required|string|max:120'])['name']);

        return $this->show($request, $campaign);
    }

    public function activate(Request $request, Campaign $campaign, SceneActions $actions): array
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate(['sceneId' => 'present|nullable|integer|min:1']);
        $actions->activate($request->user(), $campaign, $data['sceneId']);

        return $this->show($request, $campaign->fresh());
    }
}
