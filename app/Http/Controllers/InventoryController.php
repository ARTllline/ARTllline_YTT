<?php

namespace App\Http\Controllers;

use App\Actions\AbilityActions;
use App\Actions\CharacterActions;
use App\Actions\InventoryActions;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\ItemDefinition;
use App\Models\Scene;
use App\Services\InventoryGrid;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class InventoryController extends Controller
{
    public function show(Request $r, Campaign $campaign, Character $character, InventoryActions $actions): array
    {
        $c = app(AbilityActions::class)->authorize($r->user(), $campaign, $character->id);

        return $actions->snapshot($c);
    }

    public function command(Request $r, Campaign $campaign, Character $character, InventoryActions $actions): array
    {
        $data = $r->validate(['clientMutationId' => 'required|uuid', 'action' => 'required|in:move,equip,unequip,split,arrange,give,remove',
            'itemId' => 'required_unless:action,arrange,give|uuid', 'definitionId' => 'required_if:action,give|uuid',
            'quantity' => 'required_if:action,give,split|integer|between:1,999',
            'x' => 'required_if:action,move|integer|between:0,9', 'y' => 'required_if:action,move|integer|between:0,5',
            'slot' => 'required_if:action,equip|string|max:32|regex:/^[a-z][a-z0-9_]*$/']);
        $data['characterId'] = $character->id;

        return $actions->command($r->user(), $campaign, $character, $data);
    }

    public function useItem(Request $r, Scene $scene, InventoryActions $actions): array
    {
        $rules = AbilityController::commandRules();
        unset($rules['abilityId']);
        $data = $r->validate($rules + ['inventoryItemId' => 'required|uuid']);

        return AbilityController::present($actions->useItem($r->user(), $scene, $data));
    }

    public function definitions(Request $r, Campaign $campaign): array
    {
        Gate::authorize('update', $campaign);

        return ['definitions' => ItemDefinition::where('campaign_id', $campaign->id)->orderBy('name')->get()];
    }

    public function saveDefinition(Request $r, Campaign $campaign): array
    {
        Gate::authorize('update', $campaign);
        $data = $r->validate(['id' => 'sometimes|uuid', 'name' => 'required|string|max:80', 'icon' => 'required|in:item_sword,item_shield,item_potion,item_scroll,item_armor,item_boots,item_helmet,item_ring,item_amulet,item_cloak,item_gloves,sword,shield,potion,book,flame,focus',
            'description' => 'nullable|string|max:1000', 'category' => 'required|in:weapon,armor,consumable,scroll,trinket', 'rarity' => 'required|in:common,uncommon,rare,epic,legendary',
            'width' => 'required|integer|between:1,4', 'height' => 'required|integer|between:1,4', 'max_stack' => 'required|integer|between:1,99',
            'equipment_slots' => 'present|array|list|max:16', 'equipment_slots.*' => 'required|string|max:32|regex:/^[a-z][a-z0-9_]*$/|distinct',
            'modifiers' => 'present|array:ac,speed,checks', 'modifiers.ac' => 'sometimes|integer|between:-20,20', 'modifiers.speed' => 'sometimes|integer|between:-100,100',
            'modifiers.checks' => 'sometimes|array|max:30', 'modifiers.checks.*' => 'integer|between:-20,20', 'use_ability_id' => 'nullable|uuid']);

        // Accept old clients' size fields, but all newly saved definitions are single-cell.
        $data['width'] = $data['height'] = 1;

        return DB::transaction(function () use ($campaign, $data, $r) {
            Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            if (! empty($data['use_ability_id'])) {
                abort_unless($campaign->characters()->get()->contains(fn ($c) => collect($c->abilities ?? [])->contains('id', $data['use_ability_id'])), 422, 'Способность должна принадлежать этой кампании.');
            }
            $item = isset($data['id']) ? ItemDefinition::where('campaign_id', $campaign->id)->findOrFail($data['id']) : (new ItemDefinition)->forceFill(['campaign_id' => $campaign->id]);
            unset($data['id']);
            $item->fill($data);
            $item->save();
            foreach ($campaign->characters()->whereHas('inventory', fn ($q) => $q->where('item_definition_id', $item->id))->get() as $c) {
                $all = $c->inventory()->with('definition')->get()->toArray();
                foreach ($all as $i) {
                    if ($i['quantity'] < 1) {
                        continue;
                    }
                    abort_if($i['quantity'] > $i['definition']['max_stack'], 422, 'Сначала уменьшите стопки предмета.');
                    if ($i['equipped_slot']) {
                        abort_unless(in_array($i['equipped_slot'], $i['definition']['equipment_slots'], true), 422, 'Сначала снимите предмет.');
                    } else {
                        abort_unless(app(InventoryGrid::class)->fits($all, $i['definition'], $i['x'], $i['y'], [$i['id']]), 422, 'Новый размер пересекает другие предметы.');
                    }
                }
                app(CharacterActions::class)->publish($r->user(), $c->fresh());
            }

            return ['definition' => $item];
        }, 3);
    }
}
