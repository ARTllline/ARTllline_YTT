<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\Character;
use App\Models\Cue;
use App\Models\Handout;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Bounded data, never executable expressions or a game-system rules catalogue. */
class CharacterGameplay
{
    public static function rules(): array
    {
        return [
            'ac' => 'sometimes|nullable|integer|between:0,99', 'speed' => 'sometimes|nullable|integer|between:0,999',
            'resources' => 'sometimes|present|array|list|max:12',
            'resources.*' => 'required|array:key,label,current,max,icon,accent,sort_order,player_adjustable',
            'resources.*.key' => 'required|string|max:48|regex:/^[a-z][a-z0-9_]*$/|distinct',
            'resources.*.label' => 'required|string|max:40',
            'resources.*.current' => 'required|integer|between:0,9999', 'resources.*.max' => 'required|integer|between:1,9999',
            'resources.*.icon' => 'required|in:spark,focus,flame,heart,shield,bolt,sword,eye,potion,footprints,bow',
            'resources.*.accent' => 'required|in:violet,blue,amber,green,red',
            'resources.*.sort_order' => 'required|integer|between:0,100', 'resources.*.player_adjustable' => 'required|boolean',
            'abilities' => 'sometimes|present|array|list|max:24',
            'abilities.*' => 'required|array:id,name,icon,description,category,target,check,costs,damage,result,sort_order,enabled,attack_type,range,area',
            'abilities.*.id' => 'required|uuid|distinct', 'abilities.*.name' => 'required|string|max:60',
            'abilities.*.icon' => 'required|in:spark,focus,flame,heart,shield,bolt,sword,eye,potion,footprints,bow',
            'abilities.*.description' => 'present|nullable|string|max:800',
            'abilities.*.category' => 'required|in:utility,check,attack,effect',
            'abilities.*.attack_type' => 'sometimes|in:melee,ranged,spell,check,utility',
            'abilities.*.range' => 'sometimes|nullable|array:normal,long',
            'abilities.*.range.normal' => 'required_with:abilities.*.range|numeric|between:0,10000',
            'abilities.*.range.long' => 'sometimes|nullable|numeric|between:0,10000',
            'abilities.*.area' => 'sometimes|nullable|array:shape,size,width',
            'abilities.*.area.shape' => 'required_with:abilities.*.area|in:none,circle,cone,line,rectangle',
            'abilities.*.area.size' => 'required_with:abilities.*.area|numeric|between:0.1,10000',
            'abilities.*.area.width' => 'required_with:abilities.*.area|numeric|between:0.1,10000',
            'abilities.*.target' => 'required|in:self,token,prop,point,none',
            'abilities.*.check' => 'present|nullable|array:stat_key,modifier,dc,dc_visible,defense',
            'abilities.*.costs' => 'present|array|list|max:12',
            'abilities.*.costs.*' => 'required|array:key,amount',
            'abilities.*.costs.*.key' => 'required|string|max:48',
            'abilities.*.costs.*.amount' => 'required|integer|between:1,9999',
            'abilities.*.damage' => ['present', 'nullable', 'string', 'max:12', 'regex:'.DamageRoller::PATTERN],
            'abilities.*.result' => 'required|array:type,target,amount',
            'abilities.*.result.type' => 'required|in:nothing,heal,cue,handout',
            'abilities.*.result.target' => 'present|nullable|integer|min:1',
            'abilities.*.result.amount' => 'required|integer|between:0,9999',
            'abilities.*.sort_order' => 'required|integer|between:0,100', 'abilities.*.enabled' => 'required|boolean',
        ];
    }

    public function validate(Campaign $campaign, array &$data, ?Character $character): void
    {
        $resources = $data['resources'] ?? $character?->resources ?? [];
        $abilities = $data['abilities'] ?? $character?->abilities ?? [];
        foreach ($resources as $resource) {
            if ($resource['current'] > $resource['max']) {
                $this->invalid('Ресурс не может превышать максимум.');
            }
        }
        foreach ($abilities as &$ability) {
            $check = $ability['check'];
            if ($check !== null) {
                $ability['check'] = Validator::make($check, [
                    'stat_key' => 'present|nullable|string|max:48|regex:/^[a-z][a-z0-9_]*$/',
                    'modifier' => 'required|integer|between:-100,100', 'dc' => 'required|integer|between:0,999',
                    'dc_visible' => 'required|boolean', 'defense' => ['required', Rule::in(['ac', 'fixed'])],
                ])->validate();
            }
            if (in_array($ability['category'], ['check', 'attack']) && ! $check) {
                $this->invalid('Для проверки или атаки настройте бросок.');
            }
            if ($ability['category'] === 'attack' && $ability['target'] !== 'token') {
                $this->invalid('Атака должна выбирать токен.');
            }
            $area = $ability['area'] ?? null;
            if ($area && $area['shape'] !== 'none' && ($ability['target'] !== 'point' || $ability['category'] === 'attack')) {
                $this->invalid('Для области выберите точку мира и тип «Эффект» или «Проверка».');
            }
            $range = $ability['range'] ?? null;
            if ($range && ($range['long'] ?? $range['normal']) < $range['normal']) {
                $this->invalid('Дальняя дистанция не может быть меньше обычной.');
            }
            if ($area && in_array($area['shape'], ['cone', 'line']) && (! $range || $area['size'] > ($range['long'] ?? $range['normal']))) {
                $this->invalid('Дальность должна вмещать длину области.');
            }
            if ($ability['damage'] && $ability['category'] !== 'attack' && ! ($area && $area['shape'] !== 'none')) {
                $this->invalid('Урон доступен у атаки.');
            }
            $keys = [];
            foreach ($ability['costs'] as $cost) {
                if (in_array($cost['key'], $keys) || ! collect($resources)->contains('key', $cost['key'])) {
                    $this->invalid('Стоимость должна ссылаться на уникальный ресурс персонажа.');
                }
                $keys[] = $cost['key'];
            }
            $result = $ability['result'];
            $valid = match ($result['type']) {
                'nothing' => true,
                'heal' => in_array($ability['target'], ['self', 'token']) && $result['amount'] > 0,
                'handout' => Handout::where('campaign_id', $campaign->id)->whereKey($result['target'])->exists(),
                'cue' => Cue::whereHas('scene', fn ($q) => $q->where('campaign_id', $campaign->id))->whereKey($result['target'])->exists(),
            };
            if (! $valid) {
                $this->invalid('Выберите доступный результат этой кампании.');
            }
        }
        if (array_key_exists('abilities', $data)) {
            $data['abilities'] = $abilities;
        }
    }

    private function invalid(string $message): never
    {
        throw ValidationException::withMessages(['gameplay' => $message]);
    }

    public function abilities(Character $character, bool $gm): array
    {
        $abilities = collect($character->abilities ?? [])->sortBy('sort_order');
        if ($gm) {
            return $abilities->values()->all();
        }

        return $abilities->where('enabled', true)->map(function ($a) {
            $safe = array_intersect_key($a, array_flip(['id', 'name', 'icon', 'description', 'category', 'target', 'costs', 'sort_order', 'enabled', 'attack_type', 'range', 'area']));
            $safe['check'] = $a['check'] ? ['stat_key' => $a['check']['stat_key']] : null;

            return $safe;
        })->values()->all();
    }
}
