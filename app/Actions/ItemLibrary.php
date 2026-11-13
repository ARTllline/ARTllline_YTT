<?php

namespace App\Actions;

use App\Compendium\CompendiumContent;
use App\Items\ItemRules;
use App\Models\Character;
use App\Models\CompendiumEntry;
use App\Models\ItemDefinition;
use App\Models\LibraryItem;
use App\Models\LootContainer;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/** Library templates never become mutable runtime definitions. */
class ItemLibrary
{
    public function save(User $user, array $data): array
    {
        $item = isset($data['id']) ? LibraryItem::where('user_id', $user->id)->findOrFail($data['id']) : (new LibraryItem)->forceFill(['user_id' => $user->id]);
        unset($data['id']);
        $data['width'] = $data['height'] = 1;
        abort_if(! empty($data['use_ability_id']), 422, 'Глобальный предмет не может ссылаться на способность кампании.');
        abort_unless(empty(array_diff($data['equipment_slots'], array_keys(InventoryActions::SLOTS))), 422, 'Неизвестный слот.');
        $definition = new ItemDefinition($data);
        if (isset($item->definition['content'])) {
            $definition->content = $item->definition['content'];
        }
        app(ItemRules::class)->validateDefinition($definition);
        $item->definition = $definition->toArray();
        $item->save();

        return ['definition' => [...$item->definition, 'id' => $item->id]];
    }

    public function copyCompendium(User $user, int $entryId): array
    {
        return DB::transaction(function () use ($user, $entryId) {
            $entry = CompendiumEntry::with('source')->whereNull('library_user_id')->whereIn('entity_type', ['items', 'weapons', 'armor'])->whereKey($entryId)->sharedLock()->firstOrFail();
            $consumer = app(CompendiumContent::class);
            $consumer->require($entry, 'copy');
            $definition = $consumer->item($entry);
            app(ItemRules::class)->validateDefinition($definition);
            $data = $definition->toArray();
            unset($data['id'], $data['campaign_id']);
            $item = (new LibraryItem)->forceFill(['user_id' => $user->id, 'definition' => $data]);
            $item->save();
            $consumer->receipt($entry, $user, 'library_item', $item->id);

            return ['definition' => [...$item->definition, 'id' => $item->id]];
        }, 3);
    }

    public function instantiate(User $user, string $id, Character|LootContainer $character): ItemDefinition
    {
        $item = LibraryItem::where('user_id', $user->id)->findOrFail($id);
        // Reuse an identical local snapshot so ordinary stacking/merging still works.
        // Changed templates and other characters receive independent definitions.
        $relation = $character instanceof Character ? $character->inventory() : $character->items();
        $existing = $relation->with('definition')->when($character instanceof Character, fn ($q) => $q->whereHas('definition', fn ($d) => $d->whereNull('campaign_id')))->get()
            ->pluck('definition')->first(fn ($d) => array_intersect_key($d->toArray(), $item->definition) == $item->definition);
        if ($existing) {
            return $existing;
        }
        $definition = new ItemDefinition($item->definition);
        if ($character instanceof LootContainer) {
            $definition->forceFill(['campaign_id' => $character->scene->campaign_id]);
        }
        $definition->save();

        return $definition;
    }
}
