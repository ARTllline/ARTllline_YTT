<?php

namespace App\Http\Controllers;

use App\Actions\HandoutActions;
use App\Models\Campaign;
use App\Models\Handout;
use Illuminate\Http\Request;
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
        $data = $request->validate(['handoutId' => 'required|integer']);

        return $actions->show($request->user(), $campaign, (string) $data['handoutId']);
    }
}
