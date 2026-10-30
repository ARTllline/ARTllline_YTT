<?php

namespace App\Spells;

use App\Combat\TurnBudget;
use App\Models\Character;
use App\Models\Scene;
use App\Services\CharacterRules;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;

class SpellCasting
{
    public function state(Character $c): array
    {
        $state = $c->spellcasting ?? [];
        $slots = [];
        for ($i = 1; $i <= 9; $i++) {
            $slots[$i] = $state['slots'][$i] ?? ['max' => 0, 'current' => 0];
        }

        return ['slots' => $slots, 'cantrip_tier' => $state['cantrip_tier'] ?? 1, 'scroll_list' => $state['scroll_list'] ?? [], 'scroll_max_level' => $state['scroll_max_level'] ?? 0, 'verbal_blocked' => $state['verbal_blocked'] ?? false];
    }

    public function validate(Character $c, array $a, ?int $level, bool $item = false, bool $completed = false): int
    {
        $s = $a['spell'];
        if (! $item) {
            abort_unless($s['known'] && $s['prepared'] && ($s['available'] ?? true), 403, 'Заклинание неизвестно, не подготовлено или доступ закрыт GM.');
        }
        abort_if(($s['coverage'] ?? '') === 'MANUAL' && ! ($s['manual_allowed'] ?? false), 422, 'Требуется разрешение GM на ручное разрешение заклинания.');
        $time = $s['casting_time'] ?? 'Action';
        abort_unless($completed || in_array(strtolower($time), ['action', '1 action', 'bonus action', '1 bonus action']) || str_starts_with(strtolower($time), 'reaction'), 422, 'Длительное сотворение: GM должен подтвердить завершение вне боя.');
        $state = $this->state($c);
        abort_if((! $item || isset($a['_scroll'])) && $state['verbal_blocked'] && in_array('V', $s['components'] ?? []), 422, 'Невозможно произнести вербальный компонент.');
        $base = $s['level'];
        $level ??= $base;
        abort_if($base === 0 ? $level !== 0 : ($level < $base || $level > 9), 422, 'Недопустимый круг сотворения.');
        if ($item) {
            abort_unless($level === $base, 422, 'Предмет задаёт фиксированный круг заклинания.');
        }
        if (! $item && $base > 0) {
            abort_unless(($state['slots'][$level]['current'] ?? 0) > 0, 422, 'Нет ячейки выбранного круга.');
        }
        if (! $item && ! empty($s['material_definition_id'])) {
            $qty = $c->inventory()->where('item_definition_id', $s['material_definition_id'])->where('quantity', '>', 0)->sum('quantity');
            abort_if($qty < ($s['material_quantity'] ?? 1), 422, 'Нет настроенного материального компонента.');
        }

        return $level;
    }

    public function prepare(Character $c, array $a, array $data, Scene $scene, bool $item): array
    {
        $level = $this->validate($c, $a, $data['castLevel'] ?? null, $item, $data['_gmCompleted'] ?? false);
        $s = $a['spell'];
        $a['_castLevel'] = $level;
        if (! $item && $level > 0 && ($combat = app(TurnBudget::class)->active($scene->id))) {
            abort_if(DB::table('spell_turn_slots')->where('combat_id', $combat->id)->where('character_id', $c->id)->where('turn_sequence', $combat->turn_sequence)->exists(), 422, 'На этом ходу уже потрачена ячейка заклинания (SRD 2024).');
        }
        $a = $this->scale($c, $a, $level);

        return $a;
    }

    public function scale(Character $c, array $a, int $level): array
    {
        $s = $a['spell'];
        $extra = max(0, $level - $s['level']);
        if ($s['level'] === 0 && ! empty($s['cantrip_dice']) && ! empty($a['damage_components'])) {
            $a['damage_components'][0]['dice'] = $this->formula($s['cantrip_dice'], $s['cantrip_dice'], ($s['cantrip_tier'] ?? $this->state($c)['cantrip_tier']) - 1);
        }
        foreach (['damage', 'healing'] as $field) {
            $config = $s['scaling'][$field] ?? [];
            $base = $field === 'damage' ? ($a['damage_components'][0]['dice'] ?? null) : ($a['result']['dice'] ?? null);
            if (! $base) {
                continue;
            }
            $formula = $this->formula($base, $config['per_level'] ?? null, $extra);
            if ($config['spellcasting'] ?? false) {
                $r = app(CharacterRules::class)->state($c);
                abort_unless($r && $r['spellcasting_ability'], 422, 'Настройте характеристику заклинаний.');
                $bonus = app(CharacterRules::class)->abilityModifier($r['scores'][$r['spellcasting_ability']]);
                $formula = $this->formula($formula, (string) $bonus, 1);
            }
            if ($field === 'damage') {
                $a['damage_components'][0]['dice'] = $formula;
            } else {
                $a['result']['dice'] = $formula;
            }
        }
        if (isset($s['scaling']['temporary_hp'])) {
            foreach ($a['spell']['effects'] as &$node) {
                if ($node['type'] === 'temporary_hp' && isset($node['dice'])) {
                    $node['dice'] = $this->formula($node['dice'], $s['scaling']['temporary_hp']['per_level'] ?? null, $extra);
                }
            }
        }

        return $a;
    }

    /** Combine a bounded same-die progression; never evaluate expressions or source prose. */
    public function formula(string $base, ?string $step, int $count): string
    {
        $parse = function ($v) {
            if (preg_match('/^(\d+)d(\d+)([+-]\d+)?$/', $v ?? '', $m)) {
                return [(int) $m[1], (int) $m[2], (int) ($m[3] ?? 0)];
            }

            return [0, 0, (int) $v];
        };
        [$n, $d, $flat] = $parse($base);
        [$sn, $sd, $sf] = $parse($step);
        abort_if($sn && $d !== $sd, 422, 'Прогрессия должна использовать тот же кубик.');
        $n += $sn * $count;
        $flat += $sf * $count;
        abort_if($n > 20, 422, 'Слишком много кубиков.');

        return $n ? $n.'d'.$d.($flat ? ($flat > 0 ? '+' : '').$flat : '') : (string) max(0, $flat);
    }

    public function spend(Character $c, array $a, Scene $scene, bool $item): void
    {
        $s = $a['spell'];
        $level = $a['_castLevel'];
        if (! $item && $level > 0) {
            $state = $this->state($c);
            $state['slots'][$level]['current']--;
            $c->update(['spellcasting' => $state]);
            if ($combat = app(TurnBudget::class)->active($scene->id)) {
                DB::table('spell_turn_slots')->insert(['combat_id' => $combat->id, 'character_id' => $c->id, 'turn_sequence' => $combat->turn_sequence]);
            }
        }
        if (! $item && ($s['consume_material'] ?? false) && ! empty($s['material_definition_id'])) {
            $left = $s['material_quantity'] ?? 1;
            foreach ($c->inventory()->where('item_definition_id', $s['material_definition_id'])->where('quantity', '>', 0)->orderBy('id')->get() as $i) {
                $q = min($left, $i->quantity);
                $i->quantity -= $q;
                $left -= $q;
                if (! $i->quantity) {
                    $i->equipped_slot = null;
                    $i->x = $i->y = null;
                }
                $i->save();
                if (! $left) {
                    break;
                }
            }
        }
    }

    public function availability(Character $c, array $a): array
    {
        if ($c->exists && $a['spell']['level'] > 0 && ($scene = Scene::find($c->campaign->active_scene_id)) && ($combat = app(TurnBudget::class)->active($scene->id))) {
            if (DB::table('spell_turn_slots')->where('combat_id', $combat->id)->where('character_id', $c->id)->where('turn_sequence', $combat->turn_sequence)->exists()) {
                return ['available' => false, 'reason' => 'На этом ходу уже потрачена ячейка заклинания (SRD 2024).', 'levels' => []];
            }
        }
        $levels = [];
        $reason = '';
        for ($i = $a['spell']['level']; $i <= ($a['spell']['level'] ? 9 : 0); $i++) {
            try {
                $this->validate($c, $a, $i);
                $scaled = $this->scale($c, $a, $i);
                $levels[] = ['level' => $i, 'current' => $i ? $this->state($c)['slots'][$i]['current'] : null, 'damage' => $scaled['damage_components'][0]['dice'] ?? null, 'healing' => $scaled['result']['dice'] ?? null];
            } catch (HttpException $e) {
                $reason = $reason ?: $e->getMessage();
            }
        }

        return ['available' => (bool) $levels, 'reason' => $levels ? '' : $reason, 'levels' => $levels];
    }
}
