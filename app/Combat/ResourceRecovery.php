<?php

namespace App\Combat;

use App\Models\Character;
use App\Spells\SpellCasting;

/** Current persistent resources only; no class progression or invented item charges. */
class ResourceRecovery
{
    public function recover(Character $c, string $rest): array
    {
        $changes = [];
        $resources = $c->resources ?? [];
        foreach ($resources as &$r) {
            $policy = $r['recovery'] ?? 'manual';
            if (($policy === $rest || ($rest === 'long_rest' && $policy === 'short_rest')) && $r['current'] !== $r['max']) {
                $changes[] = $r['label'].': '.$r['current'].' → '.$r['max'];
                $r['current'] = $r['max'];
            }
        }
        unset($r);
        $c->update(['resources' => $resources]);
        $casting = app(SpellCasting::class)->state($c);
        if ($rest === ($casting['recovery'] ?? 'long_rest')) {
            $changed = false;
            foreach ($casting['slots'] as &$slot) {
                $changed = $changed || $slot['current'] !== $slot['max'];
                $slot['current'] = $slot['max'];
            }
            unset($slot);
            $c->update(['spellcasting' => $casting]);
            if ($changed) {
                $changes[] = 'Spell Slots restored';
            }
        }

        return $changes;
    }
}
