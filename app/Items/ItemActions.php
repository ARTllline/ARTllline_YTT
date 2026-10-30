<?php

namespace App\Items;

use App\Models\Character;
use App\Models\InventoryItem;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Services\AbilityGeometry;
use App\Services\CharacterGameplay;
use App\Services\CharacterRules;
use App\Spells\SpellScrolls;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

class ItemActions
{
    public static function potionAbility(): array
    {
        return ['id' => (string) Str::uuid(), 'name' => 'Potion of Healing', 'description' => '2d4 + 2 HP · Bonus Action · 5 ft', 'icon' => 'potion', 'category' => 'utility', 'target' => 'token', 'check' => null, 'costs' => [], 'damage' => null, 'result' => ['type' => 'heal', 'target' => null, 'amount' => 0, 'dice' => '2d4+2'], 'activation' => 'bonus_action', 'range' => ['normal' => 5, 'long' => null], 'sort_order' => 0, 'enabled' => true];
    }

    public function key(string $id, string $mode = 'use'): string
    {
        $hex = hash('sha256', 'ytt:item:'.$id.':'.$mode);

        return substr($hex, 0, 8).'-'.substr($hex, 8, 4).'-5'.substr($hex, 13, 3).'-a'.substr($hex, 17, 3).'-'.substr($hex, 20, 12);
    }

    public function ammunition(Character $c, string $key)
    {
        return $c->inventory()->with('definition')->where('quantity', '>', 0)->whereNull('equipped_slot')->orderBy('id')->get()->filter(fn ($i) => ($i->definition->gameplay['ammunition'] ?? null) === $key);
    }

    public function resolve(Character $c, InventoryItem $item, string $mode = 'use'): array
    {
        $d = $item->definition;
        $g = $d->gameplay ?? [];
        $w = $g['weapon'] ?? null;
        if (! $w) {
            abort_unless($mode === 'use', 422, 'Это не метательное оружие.');
            $a = $g['use']['ability'] ?? collect($c->abilities ?? [])->firstWhere('id', $d->use_ability_id);
            abort_unless($a && $a['enabled'], 422, 'Предмет нельзя использовать.');
            if (($g['use']['scroll'] ?? false) && isset($a['spell'])) {
                $a = app(SpellScrolls::class)->configure($c, $a);
            }
            if (isset($a['spell'])) {
                $a['spell'] = array_replace($a['spell'], ['known' => true, 'prepared' => true, 'available' => true]);
            }
            $a['id'] = $this->key($item->id);
            $a['name'] = $d->name;

            return $a;
        }
        abort_unless($item->equipped_slot === 'main_hand', 422, 'Сначала возьмите оружие в основную руку.');
        app(ItemRules::class)->validateEquipment($c);
        $throw = $mode === 'throw' || ($w['kind'] === 'ranged' && in_array('thrown', $w['properties']) && ! in_array('ammunition', $w['properties']));
        abort_unless(in_array($mode, ['use', 'throw']), 422);
        abort_if($throw && ! in_array('thrown', $w['properties']), 422, 'Оружие нельзя метать.');
        $r = app(CharacterRules::class);
        $state = $r->state($c);
        $finesse = in_array('finesse', $w['properties']);
        $ability = $w['kind'] === 'ranged' ? 'dex' : 'str';
        if ($finesse) {
            $str = $state ? $r->abilityModifier($state['scores']['str']) : ($r->stat($c, 'str')['modifier'] ?? 0);
            $dex = $state ? $r->abilityModifier($state['scores']['dex']) : ($r->stat($c, 'dex')['modifier'] ?? 0);
            $ability = $item->attack_ability !== 'auto' ? $item->attack_ability : ($dex > $str ? 'dex' : 'str');
        }
        $p = $r->weaponStat($c, $ability, $item->weapon_proficient, $w['attack_bonus'] ?? 0);
        $damage = $r->weaponStat($c, $ability, false, $w['damage_bonus'] ?? 0, true);
        $dice = ! $throw && $item->grip === 'two' && ! empty($w['versatile_dice']) ? $w['versatile_dice'] : $w['dice'];
        $ranged = $throw || $w['kind'] === 'ranged';
        $range = $throw ? ($w['throw_range'] ?? ($w['kind'] === 'ranged' ? ($w['range'] ?? null) : null)) : ($w['range'] ?? ['normal' => 5, 'long' => null]);
        if (! $ranged && in_array('reach', $w['properties'])) {
            $range = ['normal' => max(10, $range['normal']), 'long' => null];
        }
        abort_if(! $range, 422, 'Настройте дальность оружия.');
        $ammo = $w['ammunition'] ?? null;
        if ($ranged && in_array('ammunition', $w['properties'])) {
            abort_unless($ammo && $this->ammunition($c, $ammo)->isNotEmpty(), 422, 'Нет боеприпасов: '.($ammo ?? 'не настроен тип').'.');
            if (! in_array('two_handed', $w['properties'])) {
                abort_if($c->inventory()->whereNotNull('equipped_slot')->whereIn('equipped_slot', ['off_hand'])->where('quantity', '>', 0)->exists(), 422, 'Для заряжания нужна свободная вторая рука.');
            }
        }

        return ['id' => $this->key($item->id, $mode), 'name' => $d->name.($throw ? ' · Бросок' : ' · Атака'), 'description' => $d->description, 'icon' => $ranged ? 'bow' : 'sword', 'category' => 'attack', 'target' => 'token', 'check' => null, 'attack' => ['ability' => $ability, 'proficient' => $item->weapon_proficient, 'bonus' => $w['attack_bonus'] ?? 0], 'activation' => 'action', 'attack_type' => $ranged ? 'ranged' : 'melee', 'range' => $range, 'damage' => null, 'damage_components' => [['dice' => $dice, 'type' => $w['damage_type'], 'flat_bonus' => $damage['modifier']]], 'costs' => [], 'result' => ['type' => 'nothing', 'target' => null, 'amount' => 0], 'enabled' => true, 'sort_order' => 0,
            '_weapon' => ['itemId' => $item->id, 'definitionId' => $d->id, 'mode' => $mode, 'properties' => $w['properties'], 'kind' => $w['kind'], 'provenance' => ['source' => 'character_rules', 'characterId' => (string) $c->id, 'statKey' => $ability, 'statLabel' => $p['label'], 'breakdown' => $p['breakdown'], 'finalModifier' => $p['modifier'], 'itemId' => $item->id, 'definitionId' => $d->id, 'damageBreakdown' => $damage['breakdown']]]];
    }

    public function describe(Character $c, InventoryItem $i): array
    {
        $g = $i->definition->gameplay ?? [];
        $w = $g['weapon'] ?? null;
        if (! $w && ! isset($g['use']) && ! $i->definition->use_ability_id) {
            return ['ability' => null, 'available' => false, 'reason' => 'У предмета нет действия.'];
        }
        $available = $i->quantity > 0;
        $reason = $available ? '' : 'Предмет закончился.';
        $a = null;
        $secondary = null;
        try {
            $a = $this->resolve($c, $i);
            if ($w && in_array('thrown', $w['properties'])) {
                $secondary = $this->resolve($c, $i, 'throw');
            }
        } catch (HttpException $e) {
            $available = false;
            if ($i->quantity > 0) {
                $reason = $e->getMessage();
            }
        }
        // Preserve a safe descriptor even while unequipped/out of ammo, so deck bindings remain stable.
        if (! $a) {
            $a = ['id' => $this->key($i->id), 'name' => $i->definition->name, 'icon' => $w ? 'sword' : 'potion', 'description' => $i->definition->description, 'category' => $w ? 'attack' : 'utility', 'target' => $w ? 'token' : 'self', 'check' => null, 'activation' => $w ? 'action' : ($g['use']['ability']['activation'] ?? 'action'), 'costs' => [], 'enabled' => true, 'sort_order' => 0, 'damage' => null];
        }
        $safe = function ($a) {
            unset($a['_weapon']);
            foreach ($a['damage_components'] ?? [] as $n => $d) {
                $bonus = $d['flat_bonus'] ?? 0;
                $a['damage_components'][$n] = ['dice' => $d['dice'].($bonus ? ($bonus > 0 ? '+' : '').$bonus : ''), 'type' => $d['type']];
            }$draft = new Character;
            $draft->abilities = [$a];

            return app(CharacterGameplay::class)->abilities($draft, false, true)[0] ?? null;
        };

        return ['ability' => $safe($a), 'secondary' => $secondary ? $safe($secondary) : null, 'available' => $available, 'reason' => $reason, 'ammunition' => ! empty($w['ammunition']) ? $this->ammunition($c, $w['ammunition'])->sum('quantity') : null];
    }

    public function reasons(Character $c, array $a, Scene $scene, ?Token $actor, ?Token $target): array
    {
        $w = $a['_weapon'];
        $r = app(CharacterRules::class)->state($c);
        $dis = [];
        if (in_array('heavy', $w['properties']) && $r && $r['scores'][$w['kind'] === 'ranged' ? 'dex' : 'str'] < 13) {
            $dis[] = ['label' => 'Тяжёлое оружие: характеристика ниже 13', 'visibility' => 'public'];
        }
        if ($actor && $target && $a['attack_type'] === 'ranged' && app(AbilityGeometry::class)->distance($scene, $actor, $target) > $a['range']['normal']) {
            $dis[] = ['label' => 'Дальняя дистанция оружия', 'visibility' => 'public'];
        }

        return $dis;
    }

    public function consume(User $user, Character $c, InventoryItem $i, string $mode, Scene $scene, ?array $target): void
    {
        $g = $i->definition->gameplay ?? [];
        $w = $g['weapon'] ?? null;
        if ($w) {
            if ($mode === 'throw' || ($w['kind'] === 'ranged' && in_array('thrown', $w['properties']) && ! in_array('ammunition', $w['properties']))) {
                $landing = $scene->tokens()->findOrFail($target['id'] ?? 0);
                app(LootActions::class)->drop($user, $scene->campaign, $c, $i, 1, $landing);
            } elseif (! empty($w['ammunition'])) {
                $this->spendStack($this->ammunition($c, $w['ammunition'])->firstOrFail());
            }
        } elseif (($g['use']['scroll'] ?? false) || ($g['use']['consume'] ?? true)) {
            $this->spendStack($i);
        }
    }

    private function spendStack(InventoryItem $i): void
    {
        abort_if($i->quantity < 1, 422, 'Предмет закончился.');
        $i->quantity--;
        if ($i->quantity === 0) {
            $i->equipped_slot = null;
            $i->x = $i->y = null;
        }$i->save();
    }
}
