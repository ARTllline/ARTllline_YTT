<?php

namespace App\Spells;

use App\Combat\CombatExecution;
use App\Combat\ConditionRules;
use App\Combat\ExhaustionRules;
use App\Models\Character;
use App\Models\Token;
use App\Services\CharacterRules;

class SpellScrolls
{
    public function configure(Character $c, array $a): array
    {
        $s = $a['spell'];
        $state = app(SpellCasting::class)->state($c);
        abort_unless(in_array($s['source_key'] ?? '', $state['scroll_list']), 403, 'GM не подтвердил принадлежность заклинания свитка вашему списку.');
        $level = $s['level'];
        $dc = [13, 13, 13, 15, 15, 17, 17, 18, 18, 19][$level];
        $bonus = [5, 5, 5, 7, 7, 9, 9, 10, 10, 11][$level];
        if (! empty($a['save'])) {
            $a['save'] = array_replace($a['save'], ['dc_source' => 'fixed', 'dc' => $dc]);
        }
        if (! empty($a['attack']) || $a['category'] === 'attack') {
            $a['_scrollAttack'] = ['source' => 'spell_scroll', 'statKey' => 'spell_attack', 'finalModifier' => $bonus + array_sum(array_column(app(ExhaustionRules::class)->parts($c), 'value')), 'breakdown' => [['source' => 'spell_scroll', 'label' => 'SRD Spell Scroll', 'value' => $bonus], ...app(ExhaustionRules::class)->parts($c)]];
        }
        $a['_scroll'] = true;

        return $a;
    }

    public function check(Character $c, array $a, ?Token $actor): ?array
    {
        if (! isset($a['_scroll']) || $a['spell']['level'] <= app(SpellCasting::class)->state($c)['scroll_max_level']) {
            return null;
        }
        $r = app(CharacterRules::class)->state($c);
        abort_unless($r && $r['spellcasting_ability'], 422, 'Для проверки свитка настройте характеристику заклинаний.');
        $stat = app(CharacterRules::class)->stat($c, $r['spellcasting_ability']);
        $p = ['finalModifier' => $stat['modifier'], 'breakdown' => $stat['breakdown']];

        return app(CombatExecution::class)->roll($p, 10 + $a['spell']['level'], app(ConditionRules::class)->context($actor, 'check'), false, $actor, 'check') + ['provenance' => $p];
    }
}
