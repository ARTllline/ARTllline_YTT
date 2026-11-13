<?php

namespace App\Http\Controllers;

use App\Actions\CharacterLibrary;
use App\Actions\InventoryActions;
use App\Actions\ItemLibrary;
use App\Compendium\CompendiumContent;
use App\Models\Character;
use App\Models\CompendiumEntry;
use App\Models\LibraryItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class ItemLibraryController extends Controller
{
    public function index(Request $r): array
    {
        return ['definitions' => LibraryItem::where('user_id', $r->user()->id)->latest('updated_at')->get()->map(fn ($i) => [...$i->definition, 'id' => $i->id])->all()];
    }

    public function save(Request $r, ItemLibrary $library): array
    {
        return $library->save($r->user(), $r->validate(InventoryController::definitionRules()));
    }

    public function compendium(Request $r): array
    {
        $data = $r->validate(['search' => 'sometimes|nullable|string|max:100', 'page' => 'sometimes|integer|min:1',
            'type' => 'sometimes|nullable|in:items,weapons,armor']);
        $consumer = app(CompendiumContent::class);
        $query = $consumer->browseQuery(CompendiumEntry::with('source')->whereNull('library_user_id')->whereIn('entity_type', ['items', 'weapons', 'armor']));
        if (! empty($data['type'])) {
            $query->where('entity_type', $data['type']);
        }
        if ($search = trim($data['search'] ?? '')) {
            $query->whereRaw("name LIKE ? ESCAPE '!'", ['%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search).'%']);
        }
        $page = $query->orderBy('name')->orderBy('id')->paginate(24);

        return ['entries' => collect($page->items())->filter(fn ($e) => $consumer->gates($e)['browse'])->map(fn ($e) => [
            'id' => $e->id, 'definition' => $consumer->item($e)->toArray(), 'copyable' => $consumer->gates($e)['copy'],
            'source' => ['name' => $e->source->name, 'version' => $e->source->version,
                'attribution' => $e->source->metadata['attribution'] ?? '', 'license' => $e->source->license],
        ])->values()->all(), 'page' => $page->currentPage(), 'pages' => $page->lastPage(), 'total' => $page->total()];
    }

    public function copyCompendium(Request $r, ItemLibrary $library): array
    {
        $data = $r->validate(['entryId' => 'required|integer|min:1', 'clientMutationId' => 'required|uuid']);

        return $library->copyCompendium($r->user(), $data['entryId']);
    }

    private function character(Request $r, Character $character): Character
    {
        $c = app(CharacterLibrary::class)->find($r->user(), $character->id);
        if ($c->campaign) {
            Gate::authorize('update', $c->campaign);
        }

        return $c;
    }

    public function inventory(Request $r, Character $character, InventoryActions $actions): array
    {
        return $actions->snapshot($this->character($r, $character));
    }

    public function command(Request $r, Character $character, InventoryActions $actions): array
    {
        $c = $this->character($r, $character);
        $data = $r->validate([
            'clientMutationId' => 'required|uuid', 'action' => 'required|in:give,remove,move,equip,unequip,split,arrange,configure',
            'libraryItemId' => 'required_if:action,give|uuid', 'itemId' => 'required_unless:action,give,arrange|uuid',
            'quantity' => 'required_if:action,give,split|integer|between:1,999',
            'x' => 'required_if:action,move|integer|between:0,9', 'y' => 'required_if:action,move|integer|between:0,5',
            'slot' => 'required_if:action,equip|string|in:'.implode(',', array_keys(InventoryActions::SLOTS)),
            'charges' => 'sometimes|nullable|integer|between:0,999', 'grip' => 'sometimes|in:one,two', 'attack_ability' => 'sometimes|in:auto,str,dex', 'weapon_proficient' => 'sometimes|boolean',
        ]);
        abort_if($data['action'] === 'give' && isset($data['slot']) && $data['quantity'] !== 1, 422, 'В слот можно выдать один предмет.');

        return $actions->command($r->user(), $c->campaign, $c, $data, true);
    }
}
