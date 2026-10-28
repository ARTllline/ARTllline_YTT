<?php

namespace App\Http\Controllers;

use App\Actions\TemplateActions;
use App\Models\Campaign;
use App\Models\ContentTemplate;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class TemplateController extends Controller
{
    public function index(Request $request, Campaign $campaign): array
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate(['kind' => 'required|in:prefab,encounter', 'search' => 'nullable|string|max:120', 'page' => 'nullable|integer|min:1']);
        $page = ContentTemplate::where('campaign_id', $campaign->id)->where('kind', $data['kind'])
            ->when(! empty($data['search']), fn ($q) => $q->where('name', 'like', '%'.str_replace(['%', '_'], ['\\%', '\\_'], $data['search']).'%'))
            ->with('items.asset')->orderByDesc('id')->paginate(20);

        return ['templates' => $page->getCollection()->map(fn ($t) => $t->projection())->all(), 'pages' => $page->lastPage()];
    }

    public function store(Request $request, Campaign $campaign, TemplateActions $actions): array
    {
        Gate::authorize('update', $campaign);

        return $actions->save($request->user(), $campaign, $request->validate(ObjectController::selectionRules() + [
            'kind' => 'required|in:prefab,encounter', 'sceneId' => 'required|integer', 'name' => 'required|string|max:160']));
    }

    public function destroy(Request $request, Campaign $campaign): array
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate(['templateId' => 'required|integer']);

        return DB::transaction(function () use ($campaign, $data) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::authorize('update', $campaign);
            ContentTemplate::where('campaign_id', $campaign->id)->findOrFail($data['templateId'])->delete();

            return ['deleted' => true];
        });
    }
}
