<?php

namespace App\Http\Controllers;

use App\Actions\AbilityActions;
use App\Models\Campaign;
use App\Models\Character;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CharacterHotbarController extends Controller
{
    public function show(Request $request, Campaign $campaign, Character $character): array
    {
        $character = app(AbilityActions::class)->authorize($request->user(), $campaign, $character->id);
        $stored = DB::table('character_hotbars')->where('character_id', $character->id)->where('user_id', $request->user()->id)->value('slots');
        $available = collect($character->abilities ?? [])->where('enabled', true)->sortBy('sort_order')->pluck('id')->all();
        $slots = $stored !== null ? json_decode($stored, true) : array_slice($available, 0, 12);

        return ['slots' => array_pad(array_map(fn ($id) => in_array($id, $available, true) ? $id : null, $slots), 12, null)];
    }

    public function update(Request $request, Campaign $campaign, Character $character): array
    {
        $data = $request->validate(['slots' => 'present|array|list|size:12', 'slots.*' => 'nullable|uuid']);

        return DB::transaction(function () use ($request, $campaign, $character, $data) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            $character = app(AbilityActions::class)->authorize($request->user(), $campaign, $character->id);
            $ids = array_values(array_filter($data['slots']));
            $available = collect($character->abilities ?? [])->where('enabled', true)->pluck('id')->all();
            abort_unless(count($ids) === count(array_unique($ids)) && ! array_diff($ids, $available), 422, 'Выберите доступные способности персонажа.');
            DB::table('character_hotbars')->updateOrInsert(['user_id' => $request->user()->id, 'character_id' => $character->id], ['slots' => json_encode($data['slots']), 'created_at' => now(), 'updated_at' => now()]);

            return $this->show($request, $campaign, $character);
        });
    }
}
