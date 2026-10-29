<?php

namespace App\Http\Controllers;

use App\Actions\AbilityActions;
use App\Models\Campaign;
use App\Models\Character;
use App\Support\ActionDeckLayout;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CharacterHotbarController extends Controller
{
    public function show(Request $request, Campaign $campaign, Character $character): array
    {
        $character = app(AbilityActions::class)->authorize($request->user(), $campaign, $character->id);
        $stored = DB::table('character_hotbars')->where('character_id', $character->id)->where('user_id', $request->user()->id)->value('slots');
        $available = collect($character->abilities ?? [])->where('enabled', true)->sortBy('sort_order')->pluck('id')->all();
        $slots = $stored !== null ? json_decode($stored, true) : $available;

        return ActionDeckLayout::normalize($slots ?? [], $available);
    }

    public function update(Request $request, Campaign $campaign, Character $character): array
    {
        // Existing twelve-ID layouts remain readable/writable; new writes use typed bindings.
        $typed = $request->has('version');
        $data = $request->validate($typed ? [
            'version' => 'required|integer|in:2',
            'slots' => 'present|array|list|size:32',
            'slots.*' => 'nullable|array:sourceType,sourceId',
            'slots.*.sourceType' => 'required_with:slots.*|in:ability',
            'slots.*.sourceId' => 'required_with:slots.*|uuid',
        ] : ['slots' => 'present|array|list|size:12', 'slots.*' => 'nullable|uuid']);

        return DB::transaction(function () use ($request, $campaign, $character, $data) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            $character = app(AbilityActions::class)->authorize($request->user(), $campaign, $character->id);
            $ids = array_values(array_filter(array_map(fn ($s) => is_array($s) ? $s['sourceId'] : $s, $data['slots'])));
            $available = collect($character->abilities ?? [])->where('enabled', true)->pluck('id')->all();
            abort_unless(count($ids) === count(array_unique($ids)) && ! array_diff($ids, $available), 422, 'Выберите доступные способности персонажа.');
            $raw = $data['slots'];
            if (! isset($data['version'])) {
                // A cached twelve-slot client may update its prefix without erasing later pages.
                $stored = DB::table('character_hotbars')->where('user_id', $request->user()->id)->where('character_id', $character->id)->value('slots');
                $raw = array_merge($raw, array_slice(ActionDeckLayout::normalize(json_decode($stored ?? '[]', true) ?? [], $available)['slots'], 12));
            }
            $layout = ActionDeckLayout::normalize($raw, $available);
            DB::table('character_hotbars')->updateOrInsert(['user_id' => $request->user()->id, 'character_id' => $character->id], ['slots' => json_encode($layout), 'created_at' => now(), 'updated_at' => now()]);

            return $this->show($request, $campaign, $character);
        });
    }
}
