<?php

namespace App\Actions;

use App\Models\Cue;
use App\Models\CueStep;
use App\Models\LootContainer;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Services\SceneSelection;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Reversible scene-instance graphs. Gameplay records are never replayed by editor history. */
class PreparationSelection
{
    public function validate(Scene $scene, Collection $tokens, Collection $props, bool $duplicate = false): void
    {
        abort_if($tokens->contains('is_locked', true) || $props->contains('is_locked', true), 409, 'Сначала разблокируйте все выбранные объекты.');
        $ids = $tokens->modelKeys();
        $propIds = $props->modelKeys();
        abort_if(DB::table('combatants')->whereIn('token_id', $ids)->exists(), 422, 'Сначала уберите выбранные токены из боя.');
        abort_if(DB::table('ability_executions')->whereIn('token_id', $ids)->exists()
            || DB::table('spell_effects')->whereIn('source_token_id', $ids)->exists(), 422, 'Токены связаны с историей игровых действий. Групповая операция недоступна.');
        foreach (CueStep::whereIn('cue_id', Cue::where('scene_id', $scene->id)->select('id'))->get() as $step) {
            $config = $step->config;
            $linked = array_intersect($config['tokenIds'] ?? [], $ids) || array_intersect($config['propIds'] ?? [], $propIds)
                || (($config['kind'] ?? '') === 'token' && in_array($config['id'] ?? null, $ids))
                || (($config['kind'] ?? '') === 'prop' && in_array($config['id'] ?? null, $propIds));
            abort_if($linked, 422, 'В группе есть объекты, используемые событиями сцены. Сначала измените цели событий.');
        }
        abort_if(DB::table('scene_triggers')->where(fn ($q) => $q->whereIn('token_id', $ids)->orWhereIn('prop_id', $propIds)->orWhereIn('actor_token_id', $ids))->exists(), 422, 'В группе есть объекты, связанные с автоматизацией.');
        abort_if(DB::table('object_checks')->where('scene_id', $scene->id)->where(fn ($q) => $q->where(fn ($q) => $q->where('object_kind', 'token')->whereIn('object_id', $ids))->orWhere(fn ($q) => $q->where('object_kind', 'prop')->whereIn('object_id', $propIds)))->exists(), 422, 'В группе есть объекты с результатами игровых проверок.');
        abort_if(DB::table('token_conditions')->whereIn('source_token_id', $ids)->whereNotIn('token_id', $ids)->exists(), 422, 'Состояния других токенов ссылаются на выбранную группу.');
        foreach ($tokens as $token) {
            abort_if($duplicate && ($token->owner_user_id || ($token->character_id && $token->kind !== 'npc')), 422, 'Player Characters нельзя дублировать. Уберите их из выделения.');
            foreach ($token->conditions as $condition) {
                abort_if($condition->combat_id || $condition->source_ability_id || ($condition->source_token_id && ! in_array($condition->source_token_id, $ids)), 422, 'В группе есть состояния с внешними игровыми связями.');
            }
        }
        foreach (DB::table('spell_effects')->where('scene_id', $scene->id)->whereNull('ended_at')->get() as $effect) {
            $targets = json_decode($effect->targets, true) ?? [];
            abort_if(in_array($effect->source_token_id, $ids) || array_intersect(array_map('strval', $ids), array_map('strval', $targets)), 422, 'Сначала завершите связанные с группой эффекты заклинаний.');
        }
        foreach ($scene->lighting['sources'] ?? [] as $light) {
            abort_if(in_array($light['tokenId'] ?? null, $ids), 422, 'Сначала отвяжите источники света от выбранных токенов.');
        }
    }

    private function rows(string $table, string $key, array $ids): array
    {
        return DB::table($table)->whereIn($key, $ids)->orderBy('id')->get()->map(function ($row) {
            return array_diff_key((array) $row, ['direct_control' => true]);
        })->all();
    }

    private function comparable(array $data): array
    {
        $result = [];
        foreach ($data as $key => $value) {
            if (in_array($key, ['created_at', 'updated_at'], true)) {
                continue;
            }
            $result[$key] = is_array($value) ? $this->comparable($value) : $value;
        }

        return $result;
    }

    private function graph(Collection $tokens, Collection $props): array
    {
        $loot = $this->rows('loot_containers', 'token_id', $tokens->modelKeys());
        $loot = [...$loot, ...$this->rows('loot_containers', 'prop_id', $props->modelKeys())];
        usort($loot, fn ($a, $b) => $a['id'] <=> $b['id']);

        return ['tokens' => $this->rows('tokens', 'id', $tokens->modelKeys()),
            'scene_encounter_members' => $this->rows('scene_encounter_members', 'token_id', $tokens->modelKeys()),
            'scene_props' => $this->rows('scene_props', 'id', $props->modelKeys()),
            'token_conditions' => $this->rows('token_conditions', 'token_id', $tokens->modelKeys()),
            'loot_containers' => $loot,
            'inventory_items' => $this->rows('inventory_items', 'loot_container_id', array_column($loot, 'id'))];
    }

    private function dependencies(array $graph): string
    {
        $characters = $this->rows('characters', 'id', array_filter(array_column($graph['tokens'], 'character_id')));
        $items = $this->rows('inventory_items', 'character_id', array_column($characters, 'id'));

        $dependencies = ['encounters' => $this->rows('scene_encounters', 'id', array_column($graph['scene_encounter_members'] ?? [], 'encounter_id')), 'characters' => $characters, 'inventory' => $items,
            'definitions' => $this->rows('item_definitions', 'id', array_column([...$items, ...$graph['inventory_items']], 'item_definition_id'))];

        // These records are retained on scene removal; an inverse only needs their fingerprint.
        return hash('sha256', json_encode($this->comparable($dependencies), JSON_THROW_ON_ERROR));
    }

    public function edit(Scene $scene, Collection $tokens, Collection $props, bool $present): array
    {
        $graph = $this->graph($tokens, $props);
        $json = json_encode(['scene' => $scene->id, 'graph' => $graph, 'dependencies' => $this->dependencies($graph)], JSON_THROW_ON_ERROR);
        abort_if(strlen($json) > 524288, 422, 'Слишком много связанных данных. Выберите меньшую группу.');

        return ['present' => $present, 'snapshot' => Crypt::encryptString($json)];
    }

    private function remove(Collection $tokens, Collection $props): array
    {
        $result = ['deletedIds' => array_map(strval(...), $tokens->modelKeys()), 'deletedPropIds' => array_map(strval(...), $props->modelKeys()),
            '_previousVisibility' => app(SceneSelection::class)->visible($tokens, $props)];
        $encounterIds = \App\Models\SceneEncounter::forTokens($tokens->modelKeys());
        $scene = $tokens->first()?->scene;
        // Internal condition source links may null on delete; captured graph restores them together.
        foreach ($tokens->concat($props) as $object) {
            $object->delete();
        }

        if ($scene) $result['encounters'] = \App\Models\SceneEncounter::projections($scene, $encounterIds);
        return $result;
    }

    public function execute(Scene $scene, User $user, Collection $tokens, Collection $props, array $data): array
    {
        $duplicate = $data['action'] === 'duplicate';
        $this->validate($scene, $tokens, $props, $duplicate);
        if (! $duplicate) {
            $edit = $this->edit($scene, $tokens, $props, false);
            $legacy = $tokens->isEmpty() ? $props->map(fn ($p) => app(PropEditHistory::class)->capture($p, false))->all() : [];

            return $this->remove($tokens, $props) + ['selectionEdit' => $edit, 'propEdits' => in_array(null, $legacy, true) ? [] : $legacy];
        }
        $anchor = ($data['anchorKind'] === 'token' ? $tokens : $props)->firstWhere('id', $data['anchorId']);
        abort_unless($anchor, 422, 'Опорный объект должен входить в выделение.');
        $dx = $data['x'] - $anchor->x;
        $dy = $data['y'] - $anchor->y;
        foreach ($tokens->concat($props) as $object) {
            abort_if(abs($object->x + $dx) > 1000000 || abs($object->y + $dy) > 1000000, 422, 'Группа выходит за допустимые границы координат.');
        }
        $tokenMap = [];
        $copy = function ($object) use ($scene, $user, $dx, $dy, &$tokenMap) {
            $next = $object->replicate();
            $next->x = round($object->x + $dx, 3);
            $next->y = round($object->y + $dy, 3);
            if ($object instanceof Token) {
                $next->direct_control = null;
                if ($object->character_id) {
                    $character = app(NpcLibrary::class)->clone($object->character, $scene->campaign, $user);
                    $character->forceFill($object->character->only(['lifecycle', 'rest_state', 'recovery_baseline']))->save();
                    $next->character_id = $character->id;
                }
            }
            $next->interactions = array_map(function ($action) {
                $action['id'] = (string) Str::uuid();

                return $action;
            }, $object->interactions ?? []);
            $next->save();
            if ($object instanceof Token) {
                $tokenMap[$object->id] = $next->id;
            }
            $loot = LootContainer::where($object instanceof Token ? 'token_id' : 'prop_id', $object->id)->first();
            if ($loot) {
                $newLoot = $loot->replicate();
                $newLoot->fill([$object instanceof Token ? 'token_id' : 'prop_id' => $next->id, 'version' => 0])->save();
                $definitions = [];
                foreach ($loot->items()->with('definition')->get() as $item) {
                    if (! isset($definitions[$item->item_definition_id])) {
                        $definition = $item->definition->replicate();
                        $definition->save();
                        $definitions[$item->item_definition_id] = $definition->id;
                    }
                    $instance = $item->replicate();
                    $instance->fill(['loot_container_id' => $newLoot->id, 'item_definition_id' => $definitions[$item->item_definition_id]])->save();
                }
            }

            return $next;
        };
        $nextTokens = $tokens->map($copy);
        $nextProps = $props->map($copy);
        foreach ($tokens as $token) {
            foreach ($token->conditions as $condition) {
                $next = $condition->replicate();
                $next->token_id = $tokenMap[$token->id];
                $next->source_token_id = $condition->source_token_id ? $tokenMap[$condition->source_token_id] : null;
                $next->save();
            }
        }
        $legacy = $nextTokens->isEmpty() ? $nextProps->map(fn ($p) => app(PropEditHistory::class)->capture($p, true))->all() : [];
        $roster = $nextTokens->contains(fn ($token) => (bool) $token->character_id)
            ? ['charactersChanged' => true, 'scene' => app(CharacterActions::class)->roster($scene->campaign, $user)] : [];

        return app(SceneSelection::class)->result($nextTokens, $nextProps, $user) + $roster
            + ['selectionEdit' => $this->edit($scene, $nextTokens, $nextProps, true), 'propEdits' => in_array(null, $legacy, true) ? [] : $legacy];
    }

    public function history(Scene $scene, User $user, array $change): array
    {
        $expected = $change['expected'];
        $value = $change['value'];
        abort_unless(is_bool($expected['present'] ?? null) && is_bool($value['present'] ?? null) && $expected['present'] !== $value['present']
            && ($expected['snapshot'] ?? '') === ($value['snapshot'] ?? ''), 422);
        try {
            $snapshot = json_decode(Crypt::decryptString($value['snapshot']), true, 64, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            abort(422, 'Недействительный снимок группы.');
        }
        abort_unless($snapshot['scene'] === $scene->id, 422);
        $graph = $snapshot['graph'];
        abort_unless($snapshot['dependencies'] === $this->dependencies($graph), 409, 'Связанные персонажи или предметы изменились. Отмена недоступна.');
        $tokens = $scene->tokens()->with('conditions')->whereIn('id', array_column($graph['tokens'], 'id'))->get();
        $props = $scene->props()->whereIn('id', array_column($graph['scene_props'], 'id'))->get();
        if ($expected['present']) {
            $this->validate($scene, $tokens, $props);
            abort_unless($this->comparable($this->graph($tokens, $props)) == $this->comparable($graph), 409, 'Группа изменилась. Отмена недоступна.');

            return $this->remove($tokens, $props);
        }
        foreach ($graph as $table => $rows) {
            foreach ($rows as $row) {
                abort_if(DB::table($table)->where('id', $row['id'])->exists(), 409, 'Экземпляр группы уже существует.');
            }
        }
        foreach ($graph['tokens'] as $row) {
            abort_if($row['character_id'] && $scene->tokens()->where('character_id', $row['character_id'])->exists(), 409, 'Персонаж уже размещён в этой сцене.');
        }
        foreach ([...array_column($graph['tokens'], 'token_image_asset_id'), ...array_column($graph['scene_props'], 'asset_id')] as $id) {
            abort_if($id && ! DB::table('assets')->where('id', $id)->exists(), 409, 'Изображение группы удалено.');
        }
        // Insert parents first, then conditions (including forward internal source links).
        foreach (['tokens', 'scene_props', 'token_conditions', 'loot_containers', 'inventory_items', 'scene_encounter_members'] as $table) {
            foreach ($graph[$table] as $row) {
                DB::table($table)->insert($row);
            }
        }

        return ['encounters' => \App\Models\SceneEncounter::projections($scene, array_column($graph['scene_encounter_members'] ?? [], 'encounter_id'))] + app(SceneSelection::class)->result($scene->tokens()->whereIn('id', array_column($graph['tokens'], 'id'))->get(),
            $scene->props()->whereIn('id', array_column($graph['scene_props'], 'id'))->get(), $user);
    }
}
