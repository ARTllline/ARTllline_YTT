<?php

namespace App\Http\Controllers;

use App\Actions\CharacterActions;
use App\Actions\NpcLibrary;
use App\Actions\StoreImage;
use App\Models\Asset;
use App\Models\CompendiumEntry;
use App\Models\Scene;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Http\Request;

class NpcLibraryController extends Controller
{
    public function index(Request $r, NpcLibrary $library): array
    {
        return ['characters' => $library->query($r->user())->with(['portraitAsset', 'inventory.definition'])->orderBy('name')->get()->map(fn ($c) => app(CharacterActions::class)->projection($c))->all()];
    }

    public function monsters(Request $r): array
    {
        $data = $r->validate(['search' => 'sometimes|string|max:100', 'page' => 'sometimes|integer|min:1']);
        $entries = CompendiumEntry::with('source')->whereNull('library_user_id')->where('entity_type', 'monsters')
            ->when($data['search'] ?? '', fn ($q, $search) => $q->where('name', 'like', '%'.$search.'%'))->orderBy('name')->paginate(24);

        return ['entries' => $entries->map(fn ($e) => ['id' => $e->id, 'name' => $e->name, 'data' => $e->normalized_data,
            'source' => ['name' => $e->source->name, 'license' => $e->source->license, 'url' => $e->source->source_url]]), 'pages' => $entries->lastPage()];
    }

    public function save(Request $r, NpcLibrary $library): array
    {
        $r->validate(['campaign_id' => 'prohibited', 'owner_user_id' => 'nullable', 'starting_items' => 'prohibited', 'starting_spells' => 'prohibited']);
        $casting = $r->validate([
            'npc_loot_backpack' => 'sometimes|boolean',
            'spellcasting' => 'sometimes|nullable|array:slots,cantrip_tier,scroll_list,scroll_max_level,verbal_blocked,recovery',
            'spellcasting.slots' => 'sometimes|array:1,2,3,4,5,6,7,8,9',
            'spellcasting.slots.*' => 'array:max,current', 'spellcasting.slots.*.max' => 'required|integer|between:0,99',
            'spellcasting.slots.*.current' => 'required|integer|between:0,99',
            'spellcasting.cantrip_tier' => 'sometimes|integer|between:1,4',
            'spellcasting.scroll_list' => 'sometimes|array|list|max:339', 'spellcasting.scroll_list.*' => 'string|max:100|distinct',
            'spellcasting.scroll_max_level' => 'sometimes|integer|between:0,9', 'spellcasting.verbal_blocked' => 'sometimes|boolean',
            'spellcasting.recovery' => 'sometimes|in:manual,long_rest',
        ]);
        foreach ($casting['spellcasting']['slots'] ?? [] as $slot) {
            abort_if($slot['current'] > $slot['max'], 422, 'Ячейки превышают максимум.');
        }

        return $library->save($r->user(), $casting + app(CharacterController::class)->saveData($r));
    }

    public function copy(Request $r, NpcLibrary $library): array
    {
        return $library->copy($r->user(), $r->validate(['npcId' => 'required_without:entryId|prohibits:entryId|integer|min:1', 'entryId' => 'required_without:npcId|integer|min:1']));
    }

    public function place(Request $r, Scene $scene, NpcLibrary $library): array
    {
        $data = $r->validate(['encounter' => 'sometimes|array:id,groupId', 'encounter.id' => 'required_with:encounter|uuid', 'encounter.groupId' => 'required_with:encounter|string|max:40', 'npcId' => 'required|integer|min:1', 'x' => 'required|numeric|between:-1000000,1000000', 'y' => 'required|numeric|between:-1000000,1000000']);

        return $library->place($r->user(), $scene, $data['npcId'], $data['x'], $data['y'], $data['encounter'] ?? null);
    }

    public function portraits(Request $r): array
    {
        return ['assets' => Asset::whereNull('campaign_id')->where('library_user_id', $r->user()->id)->where('kind', 'token')->latest('id')->get()->map(fn ($a) => app(SceneSnapshotBuilder::class)->asset($a))];
    }

    public function upload(Request $r, StoreImage $images): array
    {
        $r->validate(['file' => 'required|file|max:16384']);

        return ['asset' => app(SceneSnapshotBuilder::class)->asset($images->execute($r->user(), null, $r->file('file'), 'token'))];
    }
}
