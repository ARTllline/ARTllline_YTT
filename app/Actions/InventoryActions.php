<?php

namespace App\Actions;

use App\Models\AbilityExecution;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\InventoryItem;
use App\Models\ItemDefinition;
use App\Models\Scene;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Services\CharacterGameplay;
use App\Services\InventoryGrid;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class InventoryActions
{
    public const SLOTS = ['head' => 'Голова', 'armor' => 'Доспех', 'cloak' => 'Плащ', 'gloves' => 'Перчатки', 'boots' => 'Сапоги', 'amulet' => 'Амулет', 'ring_1' => 'Кольцо I', 'ring_2' => 'Кольцо II', 'main_hand' => 'Основная рука', 'off_hand' => 'Вторая рука', 'ranged' => 'Дальний бой'];

    public function snapshot(Character $c): array
    {
        $c = $c->fresh();

        return ['items' => $c->inventory()->with('definition')->orderBy('id')->get()->toArray(),
            'useAbilities' => app(CharacterGameplay::class)->abilities($c, false, true),
            'width' => InventoryGrid::WIDTH, 'height' => InventoryGrid::HEIGHT, 'slots' => self::SLOTS,
            'character' => app(CharacterActions::class)->projection($c, false),
            'base' => ['ac' => $c->getRawOriginal('ac'), 'speed' => $c->getRawOriginal('speed')]];
    }

    private function replay(User $user, Character $c, array $data): ?array
    {
        $record = DB::table('inventory_commands')->where('user_id', $user->id)->where('mutation_id', app(CommandContext::class)->id())->first();
        if (! $record) {
            return null;
        }
        abort_unless((int) $record->character_id === (int) $c->id && hash_equals($record->fingerprint, hash('sha256', json_encode($data))), 409, 'UUID уже использован для другого действия.');

        return json_decode($record->result, true);
    }

    private function record(User $user, Character $c, array $data, array $result): array
    {
        DB::table('inventory_commands')->insert(['user_id' => $user->id, 'character_id' => $c->id, 'mutation_id' => app(CommandContext::class)->id(), 'fingerprint' => hash('sha256', json_encode($data)), 'result' => json_encode($result), 'created_at' => now()]);

        return $result;
    }

    public function command(User $user, Campaign $campaign, Character $character, array $data): array
    {
        return DB::transaction(function () use ($user, $campaign, $character, $data) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            $c = app(AbilityActions::class)->authorize($user, $campaign, $character->id);
            if ($r = $this->replay($user, $c, $data)) {
                return $r;
            }
            $op = $data['action'];
            if (in_array($op, ['give', 'remove'])) {
                Gate::forUser($user)->authorize('update', $campaign);
            }
            $grid = app(InventoryGrid::class);
            $items = fn () => $c->inventory()->with('definition')->get()->toArray();
            if ($op === 'give') {
                $def = ItemDefinition::where('campaign_id', $campaign->id)->findOrFail($data['definitionId']);
                $remaining = $data['quantity'];
                foreach ($c->inventory()->where('item_definition_id', $def->id)->whereNull('equipped_slot')->where('quantity', '>', 0)->get() as $stack) {
                    $amount = min($remaining, $def->max_stack - $stack->quantity);
                    $stack->increment('quantity', $amount);
                    $remaining -= $amount;
                }
                while ($remaining > 0) {
                    $position = $grid->free($items(), $def->toArray());
                    abort_unless($position, 422, 'В рюкзаке нет места.');
                    $amount = min($remaining, $def->max_stack);
                    $c->inventory()->create(['item_definition_id' => $def->id, 'quantity' => $amount, ...$position]);
                    $remaining -= $amount;
                }
            } elseif ($op === 'arrange') {
                $bag = collect($items())->filter(fn ($i) => $i['quantity'] > 0 && ! $i['equipped_slot'])->sortBy(fn ($i) => $i['definition']['category'].'|'.$i['definition']['name'].'|'.$i['id']);
                $placed = [];
                foreach ($bag as $i) {
                    $p = $grid->free($placed, $i['definition']);
                    abort_unless($p, 422, 'Не удалось разместить все предметы.');
                    $placed[] = array_merge($i, $p);
                }
                foreach ($placed as $i) {
                    InventoryItem::whereKey($i['id'])->update(['x' => $i['x'], 'y' => $i['y']]);
                }
            } else {
                $item = $c->inventory()->with('definition')->where('quantity', '>', 0)->findOrFail($data['itemId']);
                $all = $items();
                if ($op === 'remove') {
                    $item->update(['quantity' => 0, 'equipped_slot' => null, 'x' => null, 'y' => null]);
                } elseif ($op === 'move') {
                    $x = $data['x'];
                    $y = $data['y'];
                    abort_unless($grid->fits([], $item->definition->toArray(), $x, $y), 422, 'Предмет выходит за границы рюкзака.');
                    $hits = collect($all)->filter(fn ($i) => $i['id'] !== $item->id && $i['quantity'] > 0 && ! $i['equipped_slot'] && $x === $i['x'] && $y === $i['y'])->values();
                    if ($hits->count() === 1 && ! $item->equipped_slot && $hits[0]['item_definition_id'] === $item->item_definition_id && $item->definition->max_stack > 1) {
                        $target = InventoryItem::findOrFail($hits[0]['id']);
                        $amount = min($item->quantity, $item->definition->max_stack - $target->quantity);
                        abort_if($amount < 1, 422, 'Стопка уже полна.');
                        $target->increment('quantity', $amount);
                        $item->decrement('quantity', $amount);
                    } else {
                        $ignore = [$item->id];
                        if ($hits->count() === 1 && ! $item->equipped_slot) {
                            $target = $hits[0];
                            $ignore[] = $target['id'];
                            abort_unless($grid->fits($all, $target['definition'], $item->x, $item->y, $ignore), 422, 'Для обмена не хватает места.');
                            abort_if($x === $item->x && $y === $item->y, 422, 'Предметы пересекаются при обмене.');
                            InventoryItem::whereKey($target['id'])->update(['x' => $item->x, 'y' => $item->y]);
                        }
                        abort_unless($hits->count() <= 1 && $grid->fits($all, $item->definition->toArray(), $x, $y, $ignore), 422, 'Предмет не помещается здесь.');
                        $item->update(['x' => $x, 'y' => $y, 'equipped_slot' => null]);
                    }
                } elseif ($op === 'equip') {
                    $slot = $data['slot'];
                    abort_unless(in_array($slot, $item->definition->equipment_slots, true) && $item->quantity === 1, 422, 'Этот предмет не подходит слоту. Отделите один предмет от стопки.');
                    $other = $c->inventory()->with('definition')->where('equipped_slot', $slot)->where('id', '!=', $item->id)->first();
                    $old = $item->equipped_slot;
                    $item->update(['equipped_slot' => null]);
                    if ($other) {
                        if ($old && in_array($old, $other->definition->equipment_slots, true)) {
                            $other->update(['equipped_slot' => $old]);
                        } else {
                            $p = ! $old && $grid->fits($all, $other->definition->toArray(), $item->x, $item->y, [$item->id, $other->id]) ? ['x' => $item->x, 'y' => $item->y] : $grid->free($all, $other->definition->toArray(), [$item->id, $other->id]);
                            abort_unless($p, 422, 'В рюкзаке нет места для снятого предмета.');
                            $other->update([...$p, 'equipped_slot' => null]);
                        }
                    }
                    $item->update(['equipped_slot' => $slot, 'x' => null, 'y' => null]);
                } elseif ($op === 'unequip') {
                    abort_unless($item->equipped_slot, 422);
                    $p = $grid->free($all, $item->definition->toArray(), [$item->id]);
                    abort_unless($p, 422, 'В рюкзаке нет места.');
                    $item->update([...$p, 'equipped_slot' => null]);
                } elseif ($op === 'split') {
                    abort_unless(! $item->equipped_slot && $data['quantity'] < $item->quantity, 422, 'Нельзя отделить столько предметов.');
                    $p = $grid->free($all, $item->definition->toArray());
                    abort_unless($p, 422, 'В рюкзаке нет места.');
                    $item->decrement('quantity', $data['quantity']);
                    $c->inventory()->create(['item_definition_id' => $item->item_definition_id, 'quantity' => $data['quantity'], ...$p]);
                }
            }
            app(CharacterActions::class)->publish($user, $c->fresh());

            return $this->record($user, $c, $data, $this->snapshot($c));
        }, 3);
    }

    public function useItem(User $user, Scene $scene, array $data): array
    {
        return DB::transaction(function () use ($user, $scene, $data) {
            $campaign = Campaign::whereKey($scene->campaign_id)->lockForUpdate()->firstOrFail();
            $c = app(AbilityActions::class)->authorize($user, $campaign, $data['characterId']);
            if ($r = $this->replay($user, $c, $data)) {
                return $r;
            }
            abort_if(AbilityExecution::where('user_id', $user->id)->where('mutation_id', app(CommandContext::class)->id())->exists(), 409);
            $item = $c->inventory()->with('definition')->where('quantity', '>', 0)->findOrFail($data['inventoryItemId']);
            abort_unless($item->definition->use_ability_id, 422, 'Предмет нельзя использовать.');
            $response = app(AbilityActions::class)->execute($user, $scene, [...$data, 'abilityId' => $item->definition->use_ability_id], true);
            $item->decrement('quantity');
            app(CharacterActions::class)->publish($user, $c->fresh());

            return $this->record($user, $c, $data, $response);
        }, 3);
    }
}
