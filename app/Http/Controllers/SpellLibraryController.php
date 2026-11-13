<?php

namespace App\Http\Controllers;

use App\Actions\SpellLibrary;
use App\Compendium\CompendiumContent;
use App\Models\Character;
use App\Models\CompendiumEntry;
use Illuminate\Http\Request;

class SpellLibraryController extends Controller
{
    public function index(Request $r, SpellLibrary $library): array
    {
        $d = $r->validate(['search' => 'sometimes|nullable|string|max:100', 'page' => 'sometimes|integer|min:1',
            'level' => 'sometimes|nullable|integer|between:0,9', 'school' => 'sometimes|nullable|string|max:48',
            'origin' => 'sometimes|nullable|in:custom,system']);
        $query = CompendiumEntry::with('source')->where('entity_type', 'spells')
            ->where(fn ($q) => $q->whereNull('library_user_id')->orWhere('library_user_id', $r->user()->id));
        app(CompendiumContent::class)->browseQuery($query);
        if (($d['origin'] ?? '') === 'custom') {
            $query->where('library_user_id', $r->user()->id);
        } elseif (($d['origin'] ?? '') === 'system') {
            $query->whereNull('library_user_id');
        }
        if ($search = trim($d['search'] ?? '')) {
            $query->whereRaw("name LIKE ? ESCAPE '!'", ['%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search).'%']);
        }
        if (isset($d['level'])) {
            $query->where('normalized_data->spell_level', (int) $d['level']);
        }
        if (! empty($d['school'])) {
            $query->where('normalized_data->school', $d['school']);
        }
        $page = $query->orderBy('name')->orderBy('id')->paginate(24);

        return ['entries' => collect($page->items())->filter(fn ($e) => app(CompendiumContent::class)->gates($e)['browse'])->map(fn ($e) => $library->projection($e))->values()->all(), 'page' => $page->currentPage(), 'pages' => $page->lastPage(), 'total' => $page->total()];
    }

    public function save(Request $r, SpellLibrary $library): array
    {
        return $library->save($r->user(), $r->validate([
            'clientMutationId' => 'required|uuid', 'id' => 'sometimes|integer|min:1', 'copyFrom' => 'sometimes|integer|min:1', 'ability' => 'required|array',
        ]));
    }

    public function command(Request $r, Character $character, SpellLibrary $library): array
    {
        return $library->command($r->user(), $character, $r->validate([
            'clientMutationId' => 'required|uuid', 'action' => 'required|in:add,remove,configure',
            'entryId' => 'required_if:action,add|integer|min:1', 'abilityId' => 'required_unless:action,add|uuid',
            'known' => 'sometimes|boolean', 'prepared' => 'sometimes|boolean',
            'available' => 'sometimes|boolean', 'manual_allowed' => 'sometimes|boolean',
        ]));
    }
}
