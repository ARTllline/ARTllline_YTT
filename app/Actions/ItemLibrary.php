<?php

namespace App\Actions;

use App\Items\ItemRules;
use App\Models\Character;
use App\Models\ItemDefinition;
use App\Models\LibraryItem;
use App\Models\User;

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
        app(ItemRules::class)->validateDefinition($definition);
        $item->definition = $definition->toArray();
        $item->save();

        return ['definition' => [...$item->definition, 'id' => $item->id]];
    }

    public function instantiate(User $user, string $id, Character $character): ItemDefinition
    {
        $item = LibraryItem::where('user_id', $user->id)->findOrFail($id);
        // Reuse an identical local snapshot so ordinary stacking/merging still works.
        // Changed templates and other characters receive independent definitions.
        $existing = $character->inventory()->with('definition')->whereHas('definition', fn ($q) => $q->whereNull('campaign_id'))->get()
            ->pluck('definition')->first(fn ($d) => array_intersect_key($d->toArray(), $item->definition) == $item->definition);
        if ($existing) {
            return $existing;
        }
        $definition = new ItemDefinition($item->definition);
        $definition->save();

        return $definition;
    }
}
