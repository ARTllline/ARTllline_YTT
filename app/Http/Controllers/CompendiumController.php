<?php

namespace App\Http\Controllers;

use App\Compendium\CompendiumContent;
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
        $consumer = app(CompendiumContent::class);
        $query = $consumer->browseQuery(CompendiumEntry::with('source')->whereNull('library_user_id'));
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

        return ['entries' => collect($page->items())->filter(fn ($e) => $consumer->gates($e)['browse'])->map(fn ($e) => $e->only(['id', 'source_id', 'entity_type', 'external_key', 'name', 'slug']) + ['source' => $e->source, 'icon' => $e->visualIcon()])->values()->all(), 'page' => $page->currentPage(), 'pages' => $page->lastPage(), 'total' => $page->total(),
            'sources' => CompendiumSource::orderBy('name')->get(), 'types' => CompendiumSync::TYPES];
    }

    public function show(Campaign $campaign, CompendiumEntry $entry): array
    {
        Gate::authorize('update', $campaign);

        abort_if($entry->library_user_id !== null, 404);
        app(CompendiumContent::class)->require($entry, 'browse');

        return ['entry' => $entry->load('source')->toArray() + ['icon' => $entry->visualIcon()], 'permissions' => app(CompendiumContent::class)->gates($entry), 'content_reference' => app(CompendiumContent::class)->unified($entry) ? app(CompendiumContent::class)->reference($entry) : null, 'copies' => CompendiumCopy::where('campaign_id', $campaign->id)->where('compendium_entry_id', $entry->id)->orderByDesc('id')->limit(20)->get()];
    }

    public function copy(Request $r, Campaign $campaign, CopyCompendiumEntry $copy): array
    {
        Gate::authorize('update', $campaign);
        $data = $r->validate(['entry_id' => 'required|integer|min:1', 'character_id' => 'sometimes|nullable|integer|min:1', 'clientMutationId' => 'required|uuid']);

        return $copy->copy($r->user(), $campaign, CompendiumEntry::whereNull('library_user_id')->findOrFail($data['entry_id']), $data['character_id'] ?? null);
    }
}
