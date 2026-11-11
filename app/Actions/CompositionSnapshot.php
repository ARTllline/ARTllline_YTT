<?php

namespace App\Actions;

use App\Models\Character;
use App\Models\InventoryItem;
use App\Models\ItemDefinition;
use App\Models\LootContainer;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\Token;
use App\Models\User;
use App\Services\CharacterGameplay;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/** Explicit portable authoring schema. No scene IDs, ownership, history or runtime state. */
class CompositionSnapshot
{
    private function portableAbilities(array $abilities): void
    {
        foreach ($abilities as $ability) {
            abort_if(in_array($ability['result']['type'] ?? null, ['handout', 'cue']), 422,
                'Способность с раздаткой или событием кампании нельзя сохранить в глобальный пресет.');
            abort_if(! empty($ability['spell']['material_definition_id']), 422,
                'Заклинание со ссылкой на материальный компонент кампании нельзя сохранить в глобальный пресет.');
        }
    }

    private function ready(array $value): array
    {
        foreach ($value as $key => &$child) {
            if ($key === 'current' && isset($value['max'])) {
                $child = $value['max'];
            } elseif (is_array($child)) {
                $child = $this->ready($child);
            }
        }

        return $value;
    }

    private function items($items): array
    {
        $definitions = [];

        return $items->where('quantity', '>', 0)->values()->map(function ($item) use (&$definitions) {
            $definitions[$item->item_definition_id] ??= count($definitions);
            abort_if($item->definition->use_ability_id, 422, 'Предмет с привязкой к способности NPC нельзя сохранить в глобальный пресет.');
            $definition = $item->definition->only(['name', 'icon', 'description', 'category', 'rarity', 'width', 'height', 'max_stack', 'equipment_slots', 'modifiers', 'gameplay']);
            $ability = $definition['gameplay']['use']['ability'] ?? null;
            if ($ability) {
                $this->portableAbilities([$ability]);
                $data = ['abilities' => [$ability], 'resources' => []];
                app(CharacterGameplay::class)->validate(null, $data, null);
            }

            return ['definitionKey' => $definitions[$item->item_definition_id], 'data' => $item->only(['quantity', 'x', 'y', 'equipped_slot', 'grip', 'attack_ability', 'weapon_proficient']), 'definition' => $definition];
        })->all();
    }

    public function capture(Scene $scene, Collection $tokens, Collection $props): array
    {
        app(PreparationSelection::class)->validate($scene, $tokens, $props, true);
        $anchor = $tokens->first() ?? $props->first();
        $members = [];
        foreach ($tokens->concat($props) as $object) {
            $token = $object instanceof Token;
            abort_if($token && $object->kind !== 'npc', 422, 'В глобальный пресет можно сохранять только NPC и объекты.');
            $data = $object->only($token
                ? ['name', 'x', 'y', 'rotation', 'size', 'scale', 'is_hidden', 'is_locked', 'vision_range', 'kind', 'disposition', 'token_image_asset_id', 'max_hp', 'ac', 'speed', 'check_stats', 'combat_profile', 'resources', 'abilities']
                : ['name', 'asset_id', 'x', 'y', 'rotation', 'scale_x', 'scale_y', 'z_index', 'is_hidden', 'is_locked', 'preset_snapshot']);
            $data['x'] = round($object->x - $anchor->x, 3);
            $data['y'] = round($object->y - $anchor->y, 3);
            $data['name'] ??= 'Объект';
            if (isset($data['preset_snapshot'])) {
                unset($data['preset_snapshot']['presetId']);
            }
            $data['interactions'] = array_map(function ($action) {
                foreach ([$action, $action['check']['success'] ?? [], $action['check']['failure'] ?? []] as $result) {
                    abort_if(isset($result['result_type']) && $result['result_type'] !== 'nothing', 422,
                        'Действия с событиями или раздатками кампании нельзя переносить. Выберите результат «Ничего» перед сохранением.');
                }
                unset($action['id'], $action['author_id']);

                return $action;
            }, $object->interactions ?? []);
            $member = ['kind' => $token ? 'token' : 'prop', 'data' => $data];
            if ($token) {
                $member['data']['hp'] = $object->max_hp;
                $member['data']['resources'] = $this->ready($data['resources'] ?? []);
                $validation = $member['data'];
                $this->portableAbilities($validation['abilities'] ?? []);
                app(CharacterGameplay::class)->validate(null, $validation, null);
                if ($object->character_id) {
                    $character = $object->character;
                    // Read stored bases: accessors already include equipment/effects and would double them.
                    $member['character'] = Arr::only($character->attributesToArray(), ['name', 'portrait_asset_id', 'kind', 'disposition', 'max_hp', 'ac', 'speed', 'check_stats', 'rules', 'combat_profile', 'abilities', 'npc_loot_backpack']);
                    $member['character'] += ['hp' => $character->max_hp, 'resources' => $this->ready($character->resources ?? []), 'spellcasting' => $this->ready($character->spellcasting ?? [])];
                    $member['character']['hit_point_dice'] = $this->ready($character->hit_point_dice ?? []);
                    $member['character']['spellcasting']['verbal_blocked'] = false;
                    $member['inventory'] = $this->items($character->inventory()->with('definition')->get());
                }
            }
            $loot = LootContainer::where($token ? 'token_id' : 'prop_id', $object->id)->first();
            if ($loot) {
                $member['loot'] = ['data' => $loot->only(['name', 'kind', 'is_open']), 'items' => $this->items($loot->items()->with('definition')->get())];
            }
            $members[] = $member;
        }
        $snapshot = ['version' => 1, 'members' => $members];
        $this->limit($snapshot);

        return $snapshot;
    }

    public function limit(array $snapshot): void
    {
        abort_if(strlen(json_encode($snapshot, JSON_THROW_ON_ERROR)) > 524288, 422, 'Пресет превышает 512 КиБ. Выберите меньшую группу.');
    }

    private function createItems(array $items, Scene $scene, array $parent): void
    {
        $definitions = [];
        foreach ($items as $item) {
            $key = $item['definitionKey'];
            if (! isset($definitions[$key])) {
                $definition = (new ItemDefinition)->forceFill($item['definition'] + ['campaign_id' => $scene->campaign_id]);
                // Embedded item abilities are snapshots, with fresh local identity too.
                $gameplay = $definition->gameplay;
                if (isset($gameplay['use']['ability']['key'])) {
                    $gameplay['use']['ability']['key'] = (string) Str::uuid();
                    $definition->gameplay = $gameplay;
                }
                $definition->save();
                $definitions[$key] = $definition->id;
            }
            InventoryItem::create($parent + $item['data'] + ['item_definition_id' => $definitions[$key]]);
        }
    }

    public function instantiate(array $snapshot, Scene $scene, User $user, float $x, float $y): array
    {
        abort_unless(($snapshot['version'] ?? null) === 1, 422, 'Версия пресета не поддерживается.');
        foreach ($snapshot['members'] as $member) {
            abort_if(abs($x + $member['data']['x']) > 1000000 || abs($y + $member['data']['y']) > 1000000, 422, 'Группа выходит за допустимые границы координат.');
        }
        $tokens = new \Illuminate\Database\Eloquent\Collection;
        $props = new \Illuminate\Database\Eloquent\Collection;
        foreach ($snapshot['members'] as $member) {
            $data = $member['data'];
            $data['x'] += $x;
            $data['y'] += $y;
            $data['interactions'] = array_map(fn ($a) => $a + ['id' => (string) Str::uuid(), 'author_id' => $user->id], $data['interactions']);
            if (isset($member['character'])) {
                $character = (new Character)->forceFill($member['character'] + ['campaign_id' => $scene->campaign_id]);
                $character->save();
                $this->createItems($member['inventory'], $scene, ['character_id' => $character->id]);
                $data['character_id'] = $character->id;
            }
            $object = $member['kind'] === 'token' ? new Token : new SceneProp;
            $object->forceFill($data + ['scene_id' => $scene->id])->save();
            ($object instanceof Token ? $tokens : $props)->push($object);
            if (isset($member['loot'])) {
                $loot = LootContainer::create($member['loot']['data'] + ['scene_id' => $scene->id, 'created_by' => $user->id,
                    $object instanceof Token ? 'token_id' : 'prop_id' => $object->id]);
                $this->createItems($member['loot']['items'], $scene, ['loot_container_id' => $loot->id]);
            }
        }

        return [$tokens, $props];
    }
}
