<?php

namespace App\Http\Controllers;

use App\Actions\HandoutActions;
use App\Models\Campaign;
use App\Models\Handout;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class HandoutController extends Controller
{
    public function index(Request $request, Campaign $campaign, HandoutActions $actions): array
    {
        Gate::authorize('view', $campaign);
        $request->validate(['page' => 'nullable|integer|min:1']);
        $gm = $campaign->roleFor($request->user()) === 'gm';
        $page = Handout::where('campaign_id', $campaign->id)->with('asset')
            ->when(! $gm, fn ($q) => $q->whereHas('reveals', fn ($r) => $r->where('user_id', $request->user()->id)))
            ->orderByDesc('id')->paginate(40);

        return ['handouts' => $page->getCollection()->map(fn ($h) => $actions->projection($h))->all(), 'page' => $page->currentPage(), 'pages' => $page->lastPage()];
    }

    public function store(Request $request, Campaign $campaign, HandoutActions $actions): array
    {
        Gate::authorize('update', $campaign);

        return $actions->save($request->user(), $campaign, $request->validate(['assetId' => 'required|integer', 'title' => 'required|string|max:160', 'description' => 'nullable|string|max:10000']));
    }

    public function show(Request $request, Campaign $campaign, HandoutActions $actions): array
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate(['handoutId' => 'required|integer', 'recipientIds' => 'sometimes|array|min:1|max:100', 'recipientIds.*' => 'required|integer|distinct']);

        return $actions->show($request->user(), $campaign, (string) $data['handoutId'], $data['recipientIds'] ?? null);
    }

    public function revoke(Request $request, Campaign $campaign, HandoutActions $actions): array
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate(['handoutId' => 'required|integer', 'recipientIds' => 'sometimes|array|min:1|max:100', 'recipientIds.*' => 'required|integer|distinct']);

        return $actions->revoke($request->user(), $campaign, (string) $data['handoutId'], $data['recipientIds'] ?? null);
    }

    public function detail(Request $request, Campaign $campaign, Handout $handout, HandoutActions $actions): array
    {
        return DB::transaction(function () use ($request, $campaign, $handout, $actions) {
            $campaign = Campaign::whereKey($campaign->id)->sharedLock()->firstOrFail();
            Gate::authorize('view', $campaign);
            abort_unless($handout->campaign_id === $campaign->id, 404);
            $gm = $campaign->roleFor($request->user()) === 'gm';
            abort_unless($gm || $handout->reveals()->where('user_id', $request->user()->id)->exists(), 403);
            $result = $actions->projection($handout);
            if ($gm) {
                $revealed = $handout->reveals()->pluck('user_id')->all();
                $result['recipients'] = $campaign->members()->wherePivot('role', 'player')->get()->map(fn ($p) => ['id' => (string) $p->id, 'name' => $p->name, 'hasAccess' => in_array($p->id, $revealed)])->all();
            }

            return $result;
        });
    }
}
