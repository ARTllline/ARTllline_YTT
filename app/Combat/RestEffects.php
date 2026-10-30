<?php

namespace App\Combat;

use App\Models\Token;
use App\Spells\SpellEffects;
use Illuminate\Support\Collection;

/** Advance known finite durations by a GM-confirmed rest period, never by a fake world clock. */
class RestEffects
{
    public function elapsed(Collection $characters, int $seconds): array
    {
        $character = $characters->first();
        $tokens = Token::whereIn('character_id', $characters->pluck('id'))->get();
        $tokenIds = $tokens->pluck('id')->map(strval(...))->all();
        $changes = [];
        foreach (app(SpellEffects::class)->active()->whereIn('scene_id', $character->campaign->scenes()->select('id'))->get() as $effect) {
            if (! $characters->contains('id', $effect->character_id) && ! array_intersect($tokenIds, $effect->targets)) {
                continue;
            }
            $remaining = $effect->remaining_rounds !== null ? $effect->remaining_rounds * 6 : ($effect->expires_at ? max(0, now()->diffInSeconds($effect->expires_at, false)) : null);
            if ($remaining === null) {
                continue;
            } // until-dispelled/manual effects have no inferred duration.
            if ($remaining <= $seconds) {
                app(SpellEffects::class)->end($effect, 'rest_elapsed');
                foreach ($characters as $c) {
                    if ($effect->character_id === $c->id || $tokens->contains(fn ($t) => $t->character_id === $c->id && in_array((string) $t->id, $effect->targets))) {
                        $changes[$c->id][] = 'Effect ended: '.$effect->name;
                    }
                }
            } else {
                $effect->update($effect->remaining_rounds !== null ? ['remaining_rounds' => (int) ceil(($remaining - $seconds) / 6)] : ['expires_at' => now()->addSeconds($remaining - $seconds)]);
            }
        }

        return $changes;
    }
}
