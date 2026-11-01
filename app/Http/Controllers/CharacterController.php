<?php

namespace App\Http\Controllers;

use App\Actions\CharacterActions;
use App\Actions\CharacterLibrary;
use App\Combat\CombatMetadata;
use App\Models\Campaign;
use App\Models\Character;
use App\Services\CharacterCatalog;
use App\Services\CharacterGameplay;
use App\Services\CharacterRules;
use App\Services\TokenCheckStats;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class CharacterController extends Controller
{
    public function catalog(Request $request, Campaign $campaign): array
    {
        Gate::authorize('view', $campaign);
        $catalog = app(CharacterCatalog::class);

        return ['damageTypes' => CombatMetadata::types(), 'ready' => $catalog->ready(), 'skills' => array_values($catalog->skills()), 'conditions' => array_values($catalog->entries('conditions')),
            ...($campaign->roleFor($request->user()) === 'gm' ? ['defaults' => $catalog->ready() ? app(CharacterRules::class)->defaults() : null] : [])];
    }

    public function index(Request $request, Campaign $campaign, CharacterActions $actions): array
    {
        Gate::authorize('view', $campaign);

        return $actions->roster($campaign, $request->user());
    }

    public function save(Request $request, Campaign $campaign, CharacterActions $actions): array
    {
        Gate::authorize('update', $campaign);
        $data = $this->saveData($request);

        return $actions->save($request->user(), $campaign, $data);
    }

    public function saveData(Request $request): array
    {
        return $request->validate([
            'id' => 'sometimes|integer|min:1', 'name' => 'required|string|max:80',
            'origin' => 'sometimes|nullable|array:species,background',
            'origin.species' => 'nullable|string|max:120', 'origin.background' => 'nullable|string|max:240',
            'starting_items' => 'sometimes|array|list|max:30', 'starting_items.*' => 'array:definitionId,quantity',
            'starting_items.*.definitionId' => 'required|uuid|distinct', 'starting_items.*.quantity' => 'required|integer|between:1,99',
            'starting_spells' => 'sometimes|array|list|max:24', 'starting_spells.*' => 'required|integer|min:1|distinct',
            'portrait_asset_id' => 'sometimes|nullable|integer|min:1',
            'owner_user_id' => 'sometimes|nullable|integer|min:1',
            'kind' => 'sometimes|in:player_character,npc', 'disposition' => 'sometimes|in:friendly,neutral,hostile',
            'hp' => 'sometimes|integer|between:0,9999', 'max_hp' => 'sometimes|integer|between:1,9999',
            'exhaustion' => 'sometimes|integer|between:0,6',
            'hit_point_dice' => 'sometimes|array|list|max:4', 'hit_point_dice.*' => 'array:die,max,current',
            'hit_point_dice.*.die' => 'required|in:d6,d8,d10,d12|distinct', 'hit_point_dice.*.max' => 'required|integer|between:1,100', 'hit_point_dice.*.current' => 'required|integer|between:0,100',
        ] + TokenCheckStats::rules() + CharacterGameplay::rules() + CharacterRules::validation() + CombatMetadata::profileRules());

    }

    public function preview(Request $request, Campaign $campaign): array
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate(['id' => 'sometimes|nullable|integer|min:1', 'ac' => 'nullable|integer|between:0,99',
            'speed' => 'nullable|integer|between:0,999'] + CharacterRules::validation() + TokenCheckStats::rules());
        $character = ! empty($data['id']) ? $campaign->characters()->findOrFail($data['id']) : (new Character)->forceFill(['campaign_id' => $campaign->id, 'hp' => 10, 'max_hp' => 10]);
        app(CharacterRules::class)->prepare($data);
        unset($data['id']);
        $character->fill($data);

        return ['derived' => app(CharacterRules::class)->derived($character)];
    }

    public function destroy(Request $request, Campaign $campaign, Character $character, CharacterActions $actions): array
    {
        Gate::authorize('update', $campaign);
        abort_unless($character->campaign_id === $campaign->id, 404);

        return $actions->delete($request->user(), $campaign, $character);
    }

    public function library(Request $request, CharacterLibrary $library, CharacterActions $actions): array
    {
        return ['characters' => $library->query($request->user())->where('kind', 'player_character')->with(['portraitAsset', 'inventory.definition', 'campaign'])->orderBy('name')->get()->map(fn ($c) => $actions->projection($c))->all(), 'activeCharacterId' => null];
    }

    public function librarySave(Request $request, CharacterLibrary $library): array
    {
        $assignment = $request->validate(['campaign_id' => 'present|nullable|integer|min:1']);

        return $library->save($request->user(), $assignment + $this->saveData($request));
    }

    public function libraryDestroy(Request $request, Character $character, CharacterLibrary $library): array
    {
        return $library->delete($request->user(), $character->id);
    }

    public function libraryCatalog(): array
    {
        $catalog = app(CharacterCatalog::class);

        return ['damageTypes' => CombatMetadata::types(), 'ready' => $catalog->ready(),
            'skills' => array_values($catalog->skills()), 'conditions' => array_values($catalog->entries('conditions')),
            'defaults' => $catalog->ready() ? app(CharacterRules::class)->defaults() : null];
    }

    public function libraryPreview(Request $request, CharacterLibrary $library): array
    {
        $data = $request->validate(['id' => 'sometimes|nullable|integer|min:1', 'ac' => 'nullable|integer|between:0,99',
            'speed' => 'nullable|integer|between:0,999'] + CharacterRules::validation() + TokenCheckStats::rules());
        $character = ! empty($data['id']) ? $library->find($request->user(), $data['id']) : (new Character)->forceFill(['hp' => 10, 'max_hp' => 10]);
        app(CharacterRules::class)->prepare($data);
        unset($data['id']);
        $character->fill($data);

        return ['derived' => app(CharacterRules::class)->derived($character)];
    }

    public function select(Request $request, Campaign $campaign, CharacterActions $actions): array
    {
        $data = $request->validate(['character_id' => 'present|nullable|integer|min:1']);

        return $actions->select($request->user(), $campaign, $data['character_id']);
    }
}
