<?php

namespace App\Http\Controllers;

use App\Actions\CharacterLibrary;
use App\Actions\InventoryActions;
use App\Actions\ItemLibrary;
use App\Models\Character;
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
