<?php

namespace App\QA;

use App\Actions\CharacterActions;
use App\Actions\CombatActions;
use App\Actions\FogActions;
use App\Actions\InventoryActions;
use App\Actions\ObjectInteractionActions;
use App\Actions\PropActions;
use App\Actions\SceneActions;
use App\Actions\StoreImage;
use App\Actions\TokenActions;
use App\Combat\CombatStats;
use App\Compendium\CopyCompendiumEntry;
use App\Http\Controllers\CharacterHotbarController;
use App\Http\Controllers\SpellcastingController;
use App\Items\LootActions;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\Combat;
use App\Models\CompendiumEntry;
use App\Models\InventoryItem;
use App\Models\ItemDefinition;
use App\Models\LootContainer;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\SpellEffect;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Services\CharacterRules;
use App\Spells\SpellEffects;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Explicit local QA recipe. Never runs on boot, migrations or normal installs. */
class TownhouseScenario
{
    public const GRID = 49.3;

    public const NAME = 'Дом Флинна · полный игровой полигон';

    private array $manifest = [];

    private User $gm;

    private Campaign $campaign;

    private Scene $scene;

    private function command(callable $operation): mixed
    {
        app(CommandContext::class)->mutationId = (string) Str::uuid();

        return $operation();
    }

    private function request(array $data, ?User $user = null): Request
    {
        $r = Request::create('/', 'POST', $data + ['clientMutationId' => (string) Str::uuid()]);
        $r->setUserResolver(fn () => $user ?? $this->gm);

        return $r;
    }

    public function run(int $campaignId, int $sceneId, int $gmId, int $martialId, int $casterId, bool $install): array
    {
        abort_unless(app()->environment(['local', 'testing']), 403, 'QA recipe is local/testing only.');
        $this->campaign = Campaign::findOrFail($campaignId);
        $this->scene = $this->campaign->scenes()->findOrFail($sceneId);
        $this->gm = User::findOrFail($gmId);
        abort_unless($this->campaign->roleFor($this->gm) === 'gm', 403);
        $path = 'qa/townhouse-'.$campaignId.'-'.$sceneId.'.json';
        $disk = Storage::disk('campaigns');
        abort_unless($install || $disk->exists($path), 422, 'Use --install once to explicitly replace the prepared scene.');
        $this->manifest = $disk->exists($path) ? json_decode($disk->get($path), true, flags: JSON_THROW_ON_ERROR) : ['version' => 1, 'campaign' => $campaignId, 'scene' => $sceneId, 'definitions' => [], 'npcs' => [], 'props' => []];
        abort_unless($this->manifest['campaign'] === $campaignId && $this->manifest['scene'] === $sceneId, 422);
        auth()->setUser($this->gm);
        $martial = $this->campaign->characters()->findOrFail($martialId);
        $caster = $this->campaign->characters()->findOrFail($casterId);
        abort_unless($martial->owner_user_id && $caster->owner_user_id && $martial->owner_user_id !== $caster->owner_user_id, 422, 'Assign two existing different Players first.');
        $map = Asset::where('campaign_id', $campaignId)->where('kind', 'map')->where('original_name', 'flinns-townhouse.jpg')->latest('id')->first();
        if (! $map || ! $disk->exists($map->storage_path)) {
            $source = resource_path('qa/flinns-townhouse.jpg');
            abort_unless(is_file($source), 422, 'Project-owned QA battlemap is missing.');
            $map = app(StoreImage::class)->execute($this->gm, $this->campaign, new UploadedFile($source, 'flinns-townhouse.jpg', 'image/jpeg', null, true), 'map');
        }
        abort_unless($map->width === 1134 && $map->height === 1331, 422, 'Unexpected map dimensions.');
        DB::transaction(function () use ($martial, $caster, $map) {
            Campaign::whereKey($this->campaign->id)->lockForUpdate()->firstOrFail();
            $this->campaign->update(['name' => 'Постоянный полигон · Дом Флинна']);
            foreach (SpellEffect::where('scene_id', $this->scene->id)->whereNull('ended_at')->get() as $effect) {
                app(SpellEffects::class)->end($effect, 'qa_reset');
            }
            foreach (Combat::where('scene_id', $this->scene->id)->whereIn('status', ['preparing', 'active'])->get() as $combat) {
                $this->command(fn () => app(CombatActions::class)->execute($this->gm, $this->scene, 'end', ['combatId' => (string) $combat->id]));
            }
            // Reset only this explicitly owned scenario. Keep old assets and ended history as evidence.
            $ownedDefinitions = array_values($this->manifest['definitions']);
            InventoryItem::whereIn('item_definition_id', $ownedDefinitions)->delete();
            foreach ([$martial, $caster] as $hero) {
                foreach ($hero->inventory()->where('quantity', '>', 0)->get() as $item) {
                    $this->inventory($hero, ['action' => 'remove', 'itemId' => $item->id]);
                }
            }
            foreach (LootContainer::where('scene_id', $this->scene->id)->get() as $loot) {
                foreach ($loot->items()->where('quantity', '>', 0)->get() as $item) {
                    $this->loot(['action' => 'remove', 'containerId' => $loot->id, 'itemId' => $item->id]);
                }
                if ($loot->kind === 'drop') {
                    $prop = $loot->object();
                    $loot->delete();
                    $prop?->delete();
                }
            }
            foreach ($this->scene->tokens()->get() as $token) {
                $token->conditions()->delete();
            }
            $this->command(fn () => app(SceneActions::class)->update($this->gm, $this->scene, ['name' => self::NAME, 'width' => 1134, 'height' => 1331]));
            $this->command(fn () => app(SceneActions::class)->map($this->gm, $this->scene, ['assetId' => $map->id, 'x' => 0, 'y' => 0, 'width' => 1134, 'height' => 1331]));
            $this->command(fn () => app(SceneActions::class)->grid($this->gm, $this->scene, ['size' => self::GRID, 'offset' => ['x' => 0, 'y' => 0], 'visible' => true, 'snap' => true, 'distancePerCell' => 5, 'distanceUnit' => 'ft']));
            $this->command(fn () => app(FogActions::class)->reset($this->gm, $this->scene, 'clear'));
            if ($this->campaign->active_scene_id !== $this->scene->id) {
                app(SceneActions::class)->activate($this->gm, $this->campaign, $this->scene->id);
            }
            $this->scene->refresh();
            $this->prepareHero($martial, false);
            $this->prepareHero($caster, true);
            $this->placeHero($martial, 3.5, 17.5);
            $this->placeHero($caster, 2.5, 18.5);
            foreach ([$martial, $caster] as $hero) {
                app(CharacterActions::class)->select(User::findOrFail($hero->owner_user_id), $this->campaign, $hero->id);
            }
            foreach (['longsword', 'shortbow', 'shield', 'chain-mail', 'leather-armor', 'arrows', 'potion-of-healing', 'dagger'] as $key) {
                $this->definition($key);
            }
            foreach ([['longsword', 1], ['shortbow', 1], ['shield', 1], ['chain-mail', 1], ['arrows', 20], ['potion-of-healing', 3]] as [$key, $qty]) {
                $this->give($martial, $key, $qty);
            }
            foreach (['longsword' => 'main_hand', 'shield' => 'off_hand', 'chain-mail' => 'armor'] as $key => $slot) {
                $this->inventory($martial, ['action' => 'equip', 'itemId' => $this->item($martial, $key)->id, 'slot' => $slot]);
            }
            $spells = [];
            foreach (['fire-bolt', 'poison-spray', 'inflict-wounds', 'fireball', 'cure-wounds', 'healing-word', 'bless', 'shield-of-faith', 'shield', 'identify'] as $key) {
                $entry = $this->entry($key, 'spells');
                $copy = app(CopyCompendiumEntry::class)->copy($this->gm, $this->campaign, $entry, $caster->id);
                $a = $copy['ability'];
                $a['spell']['prepared'] = true;
                $a['spell']['manual_allowed'] = $key === 'identify';
                $spells[$key] = $a;
            }
            app(CharacterActions::class)->save($this->gm, $this->campaign, ['id' => $caster->id, 'abilities' => array_values($spells)]);
            $caster->refresh();
            $slots = [];
            for ($i = 1; $i <= 9; $i++) {
                $slots[$i] = ['max' => [1 => 4, 2 => 3, 3 => 2, 4 => 1][$i] ?? 0, 'current' => [1 => 4, 2 => 3, 3 => 2, 4 => 1][$i] ?? 0];
            }
            $this->command(fn () => app(SpellcastingController::class)->command($this->request(['characterId' => $caster->id, 'action' => 'configure', 'slots' => $slots, 'cantrip_tier' => 1, 'scroll_list' => ['fire-bolt', 'inflict-wounds'], 'scroll_max_level' => 4]), $this->campaign));
            $scroll = $this->definition('qa-scroll');
            $scroll->update(['name' => 'Свиток · Fire Bolt', 'icon' => 'item_scroll', 'category' => 'scroll', 'max_stack' => 20, 'equipment_slots' => [], 'gameplay' => ['use' => ['scroll' => true, 'consume' => true, 'ability' => $spells['fire-bolt']]]]);
            $this->give($caster, 'qa-scroll', 2);
            $this->give($caster, 'potion-of-healing', 3);
            $this->give($caster, 'dagger', 1);
            $this->deck($martial, [['inventory_item', $this->item($martial, 'longsword')->id], ['inventory_item', $this->item($martial, 'shortbow')->id], ['inventory_item', $this->item($martial, 'potion-of-healing')->id]]);
            $bindings = array_map(fn ($key) => ['ability', $spells[$key]['id']], ['fire-bolt', 'poison-spray', 'inflict-wounds', 'fireball', 'cure-wounds', 'bless', 'shield-of-faith', 'shield']);
            $bindings[] = ['inventory_item', $this->item($caster, 'qa-scroll')->id];
            $bindings[] = ['inventory_item', $this->item($caster, 'potion-of-healing')->id];
            $this->deck($caster, $bindings);
            $npcs = [
                $this->npc('guard', 'goblin-warrior', 'Гоблин · налётчик', 3.5, 15.5, 6),
                $this->npc('archer', 'goblin-warrior', 'Гоблин · лучник', 2.5, 12.5, 7),
                $this->npc('skeleton', 'skeleton', 'Скелет · часовой', 4.5, 8.5, 8),
                $this->npc('magmin', 'magmin', 'Магмин · у очага', 17.5, 10.5),
            ];
            $neutral = $this->scene->tokens()->find($this->manifest['neutral_token'] ?? 9);
            if (! $neutral) {
                $created = $this->command(fn () => app(TokenActions::class)->create($this->gm, $this->scene, ['name' => 'Ивар · хозяин дома', 'kind' => 'npc', 'disposition' => 'neutral', 'token_image_asset_id' => 4, 'x' => 13.5 * self::GRID, 'y' => 15.5 * self::GRID]));
                $neutral = $this->scene->tokens()->findOrFail($created['token']['id']);
            }
            $this->manifest['neutral_token'] = $neutral->id;
            $this->command(fn () => app(TokenActions::class)->update($this->gm, $neutral, ['name' => 'Ивар · хозяин дома', 'x' => 13.5 * self::GRID, 'y' => 15.5 * self::GRID, 'size' => self::GRID, 'hp' => 8, 'max_hp' => 8, 'is_hidden' => false, 'check_stats' => array_map(fn ($k) => ['key' => $k, 'label' => strtoupper($k), 'modifier' => 0], ['str', 'dex', 'con', 'int', 'wis', 'cha'])]));
            $chest = $this->prop('chest', 3, 8, 'Сундук Флинна', 6.5, 18.5);
            $trace = $this->prop('traces', 1, 6, 'Стол со следами', 1.5, 16.5);
            $door = $this->prop('door', 2, 7, 'Дверь дома', 10.5, 20.5);
            $cache = $this->prop('cache', null, 8, 'Складской ящик', 18.5, 13.5);
            $this->prop('obstacle', null, 6, 'Поваленный стол', 3.5, 13.5);
            foreach ([[$trace, 'Осмотреть следы', 'perception', 12], [$door, 'Изучить замок', 'investigation', 13], [$cache, 'Осмотреть припасы', 'investigation', 10]] as [$prop, $label, $stat, $dc]) {
                $this->interaction($prop, $label, $stat, $dc);
            }
            $chestLoot = $this->loot(['action' => 'configure', 'sceneId' => $this->scene->id, 'kind' => 'prop', 'objectId' => $chest->id, 'name' => $chest->name])['loot']['id'];
            foreach ([['longsword', 1], ['leather-armor', 1], ['potion-of-healing', 3], ['arrows', 20], ['qa-scroll', 1]] as [$key, $qty]) {
                $this->loot(['action' => 'give', 'containerId' => $chestLoot, 'definitionId' => $this->definition($key)->id, 'quantity' => $qty]);
            }
            $cacheLoot = $this->loot(['action' => 'configure', 'sceneId' => $this->scene->id, 'kind' => 'prop', 'objectId' => $cache->id, 'name' => $cache->name])['loot']['id'];
            $this->loot(['action' => 'give', 'containerId' => $cacheLoot, 'definitionId' => $this->definition('potion-of-healing')->id, 'quantity' => 1]);
            $corpseLoot = $this->loot(['action' => 'configure', 'sceneId' => $this->scene->id, 'kind' => 'token', 'objectId' => $npcs[0]->id, 'name' => 'Снаряжение налётчика'])['loot']['id'];
            foreach ([['dagger', 1], ['potion-of-healing', 1]] as [$key, $qty]) {
                $this->loot(['action' => 'give', 'containerId' => $corpseLoot, 'definitionId' => $this->definition($key)->id, 'quantity' => $qty]);
            }
            foreach ([$chestLoot, $cacheLoot, $corpseLoot] as $id) {
                $this->loot(['action' => 'close', 'containerId' => $id]);
            }
            $this->command(fn () => app(CombatActions::class)->execute($this->gm, $this->scene, 'prepare', []));
            $combat = Combat::where('scene_id', $this->scene->id)->where('status', 'preparing')->firstOrFail();
            $tokens = [...$this->scene->tokens()->whereIn('character_id', [$martial->id, $caster->id])->pluck('id')->map('strval')->all(), ...array_map(fn ($t) => (string) $t->id, $npcs)];
            $this->command(fn () => app(CombatActions::class)->execute($this->gm, $this->scene, 'add', ['combatId' => (string) $combat->id, 'tokenIds' => $tokens]));
            foreach ($combat->combatants()->get() as $i => $entry) {
                $this->command(fn () => app(CombatActions::class)->execute($this->gm, $this->scene, 'initiative', ['combatId' => (string) $combat->id, 'combatantId' => (string) $entry->id, 'initiative' => 20 - $i * 2]));
            }
            $this->manifest['map'] = $map->id;
            $this->manifest['combat'] = $combat->id;
            $this->manifest['heroes'] = [$martial->id, $caster->id];
        }, 3);
        $disk->put($path, json_encode($this->manifest, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

        return $this->manifest;
    }

    private function prepareHero(Character $hero, bool $caster): void
    {
        $rules = app(CharacterRules::class)->defaults();
        $rules['proficiency_bonus'] = 3;
        $rules['scores'] = $caster ? ['str' => 10, 'dex' => 14, 'con' => 14, 'int' => 16, 'wis' => 12, 'cha' => 18] : ['str' => 16, 'dex' => 14, 'con' => 16, 'int' => 10, 'wis' => 14, 'cha' => 10];
        foreach (['perception', 'investigation', 'athletics', 'arcana'] as $key) {
            if (isset($rules['skills'][$key])) {
                $rules['skills'][$key]['proficient'] = true;
            }
        }
        $rules['spellcasting_ability'] = $caster ? 'cha' : null;
        app(CharacterActions::class)->save($this->gm, $this->campaign, ['id' => $hero->id, 'rules' => $rules, 'hp' => $caster ? 40 : 48, 'max_hp' => $caster ? 40 : 48, 'ac' => $caster ? 12 : 10, 'speed' => 30, 'abilities' => [], 'resources' => []]);
        $hero->refresh()->update(['temporary_hp' => 0]);
    }

    private function placeHero(Character $hero, float $x, float $y): void
    {
        $token = $this->scene->tokens()->where('character_id', $hero->id)->first();
        if (! $token) {
            $this->command(fn () => app(TokenActions::class)->create($this->gm, $this->scene, ['character_id' => $hero->id, 'x' => $x * self::GRID, 'y' => $y * self::GRID]));
            $token = $this->scene->tokens()->where('character_id', $hero->id)->firstOrFail();
        }
        $this->command(fn () => app(TokenActions::class)->update($this->gm, $token, ['x' => $x * self::GRID, 'y' => $y * self::GRID, 'size' => self::GRID, 'scale' => 1, 'is_hidden' => false, 'is_locked' => false]));
    }

    private function entry(string $key, ?string $type = null): CompendiumEntry
    {
        return CompendiumEntry::where('external_key', $key)->when($type, fn ($q) => $q->where('entity_type', $type), fn ($q) => $q->whereIn('entity_type', ['items', 'weapons', 'armor']))->whereHas('source', fn ($q) => $q->where('key', 'srd-2024'))->firstOrFail();
    }

    private function definition(string $key): ItemDefinition
    {
        if (isset($this->manifest['definitions'][$key]) && ($d = ItemDefinition::where('campaign_id', $this->campaign->id)->find($this->manifest['definitions'][$key]))) {
            return $d;
        }
        $d = app(CopyCompendiumEntry::class)->copy($this->gm, $this->campaign, $this->entry($key === 'qa-scroll' ? 'potion-of-healing' : $key), null)['definition'];
        $this->manifest['definitions'][$key] = $d->id;

        return $d;
    }

    private function inventory(Character $hero, array $d): array
    {
        return $this->command(fn () => app(InventoryActions::class)->command($this->gm, $this->campaign, $hero, $d));
    }

    private function loot(array $d): array
    {
        return $this->command(fn () => app(LootActions::class)->command($this->gm, $this->campaign, $d));
    }

    private function give(Character $hero, string $key, int $quantity): void
    {
        $this->inventory($hero, ['action' => 'give', 'definitionId' => $this->definition($key)->id, 'quantity' => $quantity, 'weapon_proficient' => true]);
    }

    private function item(Character $hero, string $key): InventoryItem
    {
        return $hero->inventory()->where('item_definition_id', $this->definition($key)->id)->where('quantity', '>', 0)->firstOrFail();
    }

    private function deck(Character $hero, array $bindings): void
    {
        $slots = array_pad(array_map(fn ($b) => ['sourceType' => $b[0], 'sourceId' => $b[1]], $bindings), 32, null);
        app(CharacterHotbarController::class)->update($this->request(['version' => 2, 'slots' => $slots], User::findOrFail($hero->owner_user_id)), $this->campaign, $hero);
    }

    private function npc(string $key, string $source, string $name, float $x, float $y, ?int $reuse = null)
    {
        $entry = $this->entry($source, 'monsters');
        $character = isset($this->manifest['npcs'][$key]) ? $this->campaign->characters()->find($this->manifest['npcs'][$key]) : null;
        if (! $character) {
            $copy = app(CopyCompendiumEntry::class)->copy($this->gm, $this->campaign, $entry, null);
            $character = $this->campaign->characters()->findOrFail($copy['character']['id']);
            $this->manifest['npcs'][$key] = $character->id;
        }
        $n = $entry->normalized_data;
        $abilities = [];
        foreach ($n['actions'] as $action) {
            if (isset($action['attack_bonus'], $action['damage'][0]['damage_dice'])) {
                $range = $action['name'] === 'Shortbow' ? ['normal' => 80, 'long' => 320] : ['normal' => 5, 'long' => null];
                $abilities[] = ['id' => (string) Str::uuid(), 'name' => $action['name'], 'icon' => $action['name'] === 'Shortbow' ? 'bow' : 'sword', 'description' => mb_substr($action['desc'].' Дополнительные условные эффекты разрешает GM.', 0, 800), 'category' => 'attack', 'target' => 'token', 'activation' => 'action', 'attack_type' => $range['long'] ? 'ranged' : 'melee', 'check' => ['stat_key' => null, 'modifier' => $action['attack_bonus'], 'dc' => 0, 'dc_visible' => true, 'defense' => 'ac'], 'costs' => [], 'damage' => null, 'damage_components' => [['dice' => $action['damage'][0]['damage_dice'], 'type' => $action['damage'][0]['damage_type']['index']]], 'range' => $range, 'result' => ['type' => 'nothing', 'target' => null, 'amount' => 0], 'sort_order' => count($abilities), 'enabled' => true];
            }
        }
        app(CharacterActions::class)->save($this->gm, $this->campaign, ['id' => $character->id, 'name' => $name, 'hp' => $n['hp'], 'max_hp' => $n['hp'], 'abilities' => $abilities, 'combat_profile' => app(CombatStats::class)->fromMonster($n)]);
        $character->refresh()->update(['temporary_hp' => 0]);
        $token = $reuse ? $this->scene->tokens()->find($reuse) : $this->scene->tokens()->where('character_id', $character->id)->first();
        if (! $token) {
            $this->command(fn () => app(TokenActions::class)->create($this->gm, $this->scene, ['character_id' => $character->id, 'x' => $x * self::GRID, 'y' => $y * self::GRID]));
            $token = $this->scene->tokens()->where('character_id', $character->id)->firstOrFail();
        }
        $this->command(fn () => app(TokenActions::class)->update($this->gm, $token, ['character_id' => $character->id, 'x' => $x * self::GRID, 'y' => $y * self::GRID, 'size' => self::GRID, 'scale' => 1, 'is_hidden' => false, 'is_locked' => false]));

        return $token->fresh();
    }

    private function prop(string $key, ?int $reuse, int $asset, string $name, float $x, float $y): SceneProp
    {
        $id = $this->manifest['props'][$key] ?? $reuse;
        if (! $id || ! $this->scene->props()->whereKey($id)->exists()) {
            $result = $this->command(fn () => app(PropActions::class)->execute($this->gm, $this->scene, ['action' => 'create', 'assetId' => $asset, 'x' => $x * self::GRID, 'y' => $y * self::GRID]));
            $id = $result['props'][0]['id'];
        }
        $this->manifest['props'][$key] = (int) $id;
        $this->command(fn () => app(PropActions::class)->execute($this->gm, $this->scene, ['action' => 'update', 'id' => $id, 'patch' => ['name' => $name, 'x' => $x * self::GRID, 'y' => $y * self::GRID, 'scale_x' => 0.22, 'scale_y' => 0.22, 'is_hidden' => false, 'is_locked' => false]]));

        return SceneProp::findOrFail($id);
    }

    private function interaction(SceneProp $prop, string $label, string $stat, int $dc): void
    {
        $nothing = ['result_type' => 'nothing', 'result_target' => null];
        $this->command(fn () => app(ObjectInteractionActions::class)->save($this->gm, $this->scene, ['kind' => 'prop', 'id' => $prop->id, 'actions' => [['id' => (string) Str::uuid(), 'label' => $label, 'icon' => 'search', 'result_type' => 'nothing', 'result_target' => null, 'enabled' => true, 'check' => ['enabled' => true, 'label' => $label, 'stat_key' => $stat, 'dc' => $dc, 'dc_visible' => false, 'retry' => 'repeatable', 'success' => $nothing, 'failure' => $nothing]]]]));
    }
}
