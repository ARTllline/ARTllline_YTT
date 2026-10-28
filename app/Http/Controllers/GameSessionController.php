<?php

namespace App\Http\Controllers;

use App\Actions\SessionActions;
use App\Models\Campaign;
use App\Models\ContentTemplate;
use App\Models\Cue;
use App\Models\GameSession;
use App\Models\Handout;
use App\Services\SessionPlan;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class GameSessionController extends Controller
{
    public function index(Campaign $campaign, SessionPlan $plans): array
    {
        Gate::authorize('update', $campaign);
        $sessions = GameSession::where('campaign_id', $campaign->id)->latest('id')->get();

        return ['sessions' => $sessions->map(fn ($s) => $plans->view($s, false)), 'activeId' => $sessions->firstWhere('status', 'active')?->id];
    }

    public function show(Campaign $campaign, GameSession $gameSession, SessionPlan $plans): array
    {
        Gate::authorize('update', $campaign);
        abort_unless($gameSession->campaign_id === $campaign->id, 404);

        return $plans->view($gameSession);
    }

    public function resources(Request $request, Campaign $campaign): array
    {
        Gate::authorize('update', $campaign);
        $type = $request->string('type')->toString();
        $query = match ($type) {
            'scene' => $campaign->scenes(),
            'cue' => Cue::whereHas('scene', fn ($q) => $q->where('campaign_id', $campaign->id)),
            'handout' => Handout::where('campaign_id', $campaign->id),
            'encounter' => ContentTemplate::where('campaign_id', $campaign->id)->where('kind', 'encounter'),
            default => abort(422),
        };
        $column = $type === 'handout' ? 'title' : 'name';
        $search = mb_substr($request->string('search')->toString(), 0, 160);
        $page = $query->where($column, 'like', '%'.addcslashes($search, '%_\\').'%')->orderBy($column)->paginate(40);

        return ['items' => collect($page->items())->map(fn ($r) => ['id' => (string) $r->id, 'name' => $r->{$column}, 'sceneId' => $type === 'cue' ? (string) $r->scene_id : null]), 'pages' => $page->lastPage()];
    }

    public function command(Request $request, Campaign $campaign, SessionActions $actions): array
    {
        Gate::authorize('update', $campaign);

        return $actions->execute($request->user(), $campaign, $request->route('command'), $request->all());
    }
}
