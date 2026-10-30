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
    private function available(Character $character): array
    {
        return ['ability' => collect($character->abilities ?? [])->where('enabled', true)->filter(fn ($a) => ! ($a['item_only'] ?? false) && (! isset($a['spell']) || $a['spell']['known']))->sortBy('sort_order')->pluck('id')->all(),
            'inventory_item' => $character->inventory()->with('definition')->get()->filter(fn ($i) => $i->quantity > 0 && (isset($i->definition->gameplay['weapon']) || isset($i->definition->gameplay['use']) || ($i->definition->use_ability_id && collect($character->abilities ?? [])->where('enabled', true)->contains('id', $i->definition->use_ability_id))))->pluck('id')->all()];
    }

    public function show(Request $request, Campaign $campaign, Character $character): array
    {
        $character = app(AbilityActions::class)->authorize($request->user(), $campaign, $character->id);
        $stored = DB::table('character_hotbars')->where('character_id', $character->id)->where('user_id', $request->user()->id)->value('slots');
        $available = $this->available($character);
        $slots = $stored !== null ? json_decode($stored, true) : $available['ability'];

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
            'slots.*.sourceType' => 'required_with:slots.*|in:ability,inventory_item',
            'slots.*.sourceId' => 'required_with:slots.*|uuid',
        ] : ['slots' => 'present|array|list|size:12', 'slots.*' => 'nullable|uuid']);

        return DB::transaction(function () use ($request, $campaign, $character, $data) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            $character = app(AbilityActions::class)->authorize($request->user(), $campaign, $character->id);
            $available = $this->available($character);
            $seen = [];
            foreach ($data['slots'] as $s) {
                if ($s === null) {
                    continue;
                }
                $b = is_array($s) ? $s : ['sourceType' => 'ability', 'sourceId' => $s];
                $key = $b['sourceType'].':'.$b['sourceId'];
                abort_unless(in_array($b['sourceId'], $available[$b['sourceType']] ?? [], true) && ! in_array($key, $seen, true), 422, 'Выберите доступное действие персонажа.');
                $seen[] = $key;
            }
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
