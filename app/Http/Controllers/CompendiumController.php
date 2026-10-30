<?php

namespace App\Http\Controllers;

use App\Compendium\CompendiumSync;
use App\Compendium\CopyCompendiumEntry;
use App\Models\Campaign;
use App\Models\CompendiumCopy;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class CompendiumController extends Controller
{
    public function index(Request $r, Campaign $campaign): array
    {
        Gate::authorize('update', $campaign);
        $data = $r->validate(['search' => 'sometimes|nullable|string|max:100', 'type' => ['sometimes', 'nullable', Rule::in(CompendiumSync::TYPES)],
            'source' => 'sometimes|nullable|integer|min:1', 'page' => 'sometimes|integer|min:1']);
        $query = CompendiumEntry::with('source')->select(['id', 'source_id', 'entity_type', 'external_key', 'name', 'slug']);
        if ($data['type'] ?? null) {
            $query->where('entity_type', $data['type']);
        }
        if ($data['source'] ?? null) {
            $query->where('source_id', $data['source']);
        }
        if ($search = trim($data['search'] ?? '')) {
            // Literal substring search; SRD fits in a small local indexed catalogue.
            $query->whereRaw("name LIKE ? ESCAPE '!'", ['%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search).'%']);
        }
        $page = $query->orderBy('name')->orderBy('id')->paginate(30);

        return ['entries' => $page->items(), 'page' => $page->currentPage(), 'pages' => $page->lastPage(), 'total' => $page->total(),
            'sources' => CompendiumSource::orderBy('name')->get(), 'types' => CompendiumSync::TYPES];
    }

    public function show(Campaign $campaign, CompendiumEntry $entry): array
    {
        Gate::authorize('update', $campaign);

        return ['entry' => $entry->load('source'), 'copies' => CompendiumCopy::where('campaign_id', $campaign->id)->where('compendium_entry_id', $entry->id)->orderByDesc('id')->limit(20)->get()];
    }

    public function copy(Request $r, Campaign $campaign, CopyCompendiumEntry $copy): array
    {
        Gate::authorize('update', $campaign);
        $data = $r->validate(['entry_id' => 'required|integer|min:1', 'character_id' => 'sometimes|nullable|integer|min:1', 'clientMutationId' => 'required|uuid']);

        return $copy->copy($r->user(), $campaign, CompendiumEntry::findOrFail($data['entry_id']), $data['character_id'] ?? null);
    }
}
