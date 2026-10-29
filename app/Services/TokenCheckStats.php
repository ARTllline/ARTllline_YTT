<?php

namespace App\Services;

use App\Models\Character;
use App\Models\Token;
use Illuminate\Validation\ValidationException;

/** Small, system-agnostic named modifiers. No derived attributes or rules engine. */
class TokenCheckStats
{
    public static function rules(): array
    {
        return [
            'check_stats' => 'sometimes|present|array|list|max:30',
            'check_stats.*' => 'required|array:key,label,modifier',
            'check_stats.*.key' => 'required|string|max:48|regex:/^[a-z][a-z0-9_]*$/|distinct',
            'check_stats.*.label' => 'required|string|max:80',
            'check_stats.*.modifier' => 'required|integer|between:-100,100',
        ];
    }

    public function resolve(Token|Character|null $token, array $config): array
    {
        $key = $config['stat_key'] ?? null;
        if ($key) {
            $stat = collect($token?->check_stats ?? [])->firstWhere('key', $key);
            if (! $stat) {
                throw ValidationException::withMessages(['actorTokenId' => 'У персонажа не настроена эта проверка. Попросите GM добавить модификатор.']);
            }

            $characterId = $token instanceof Character ? $token->id : $token->character_id;

            return ['source' => $characterId ? 'character_stat' : 'token_stat',
                ...($characterId ? ['characterId' => (string) $characterId, 'characterName' => $token->name] : []),
                'tokenId' => $token instanceof Token ? (string) $token->id : null, 'tokenName' => $token->name,
                'statKey' => $key, 'statLabel' => $stat['label'], 'baseModifier' => (int) $stat['modifier'],
                'otherModifiers' => [], 'finalModifier' => (int) $stat['modifier']];
        }

        // Task 16B configurations remain fixed until a GM explicitly converts them.
        $modifier = (int) ($config['modifier'] ?? 0);

        return ['source' => 'legacy_interaction', 'tokenId' => $token instanceof Token ? (string) $token->id : null,
            'tokenName' => $token?->name, 'statKey' => $config['ability_key'] ?? null,
            'statLabel' => $config['label'], 'baseModifier' => $modifier,
            'otherModifiers' => [], 'finalModifier' => $modifier];
    }
}
