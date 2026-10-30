<?php

namespace App\Items;

use App\Models\Character;
use App\Models\InventoryItem;
use App\Models\ItemDefinition;
use App\Models\LootContainer;
use App\Services\InventoryGrid;

/** All callers hold the campaign writer lock; ownership changes preserve instances when possible. */
class ItemTransfers
{
    public function add(Character|LootContainer $target, ItemDefinition $d, int $quantity, ?InventoryItem $source = null): array
    {
        $remaining = $quantity;
        $result = [];
        $relation = $target instanceof Character ? $target->inventory() : $target->items();
        foreach ($relation->where('item_definition_id', $d->id)->whereNull('equipped_slot')->where('quantity', '>', 0)->orderBy('id')->lockForUpdate()->get() as $stack) {
            if ($source && $stack->id === $source->id) {
                continue;
            }$amount = min($remaining, max(0, $d->max_stack - $stack->quantity));
            if ($amount) {
                $stack->increment('quantity', $amount);
                $remaining -= $amount;
                $result[] = ['itemId' => $stack->id, 'quantity' => $amount];
            }if (! $remaining) {
                break;
            }
        }
        while ($remaining > 0) {
            $position = $target instanceof Character ? app(InventoryGrid::class)->free($target->inventory()->get()->toArray(), $d->toArray()) : ['x' => null, 'y' => null];
            abort_unless($position, 422, 'В рюкзаке получателя нет места. Передача отменена целиком.');
            $amount = min($remaining, $d->max_stack);
            $owner = $target instanceof Character ? ['character_id' => $target->id, 'loot_container_id' => null] : ['character_id' => null, 'loot_container_id' => $target->id];
            if ($source && $remaining <= $d->max_stack && $remaining === $source->quantity && $remaining === $quantity) {
                $source->update($owner + $position + ['equipped_slot' => null, 'grip' => 'one', 'weapon_proficient' => false]);
                $result[] = ['itemId' => $source->id, 'quantity' => $remaining];
                $remaining = 0;
                $source = null;
                break;
            }
            $new = InventoryItem::create($owner + $position + ['item_definition_id' => $d->id, 'quantity' => $amount, 'grip' => 'one', 'weapon_proficient' => false, 'attack_ability' => $source?->attack_ability ?? 'auto']);
            $remaining -= $amount;
            $result[] = ['itemId' => $new->id, 'quantity' => $amount];
        }
        if ($source) {
            $source->quantity -= $quantity;
            if ($source->quantity === 0) {
                $source->equipped_slot = null;
                $source->x = $source->y = null;
            }$source->save();
        }

        return $result;
    }
}
