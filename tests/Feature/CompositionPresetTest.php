<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\CompositionPreset;
use App\Models\ItemDefinition;
use App\Models\LootContainer;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class CompositionPresetTest extends TestCase
{
    use RefreshDatabase;

    private User $gm;

    private User $player;

    private Scene $source;

    private Scene $destination;

    private Token $npc;

    private array $chest;

    private ItemDefinition $definition;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('campaigns');
        Event::fake([TabletopEvent::class]);
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        foreach (['source', 'destination'] as $key) {
            $campaign = Campaign::create(['name' => $key]);
            $campaign->members()->attach($this->gm, ['role' => 'gm']);
            $campaign->members()->attach($this->player, ['role' => 'player']);
            $this->$key = $campaign->scenes()->create(['name' => $key, 'width' => 2000, 'height' => 1400]);
            $campaign->forceFill(['active_scene_id' => $this->$key->id])->save();
        }
        $this->actingAs($this->gm);
        $asset = $this->post('/api/campaigns/'.$this->source->campaign_id.'/assets', ['kind' => 'prop', 'file' => UploadedFile::fake()->image('chest.png', 80, 120)])->assertOk()->json('id');
        $character = $this->source->campaign->characters()->create(['name' => 'Sentry', 'kind' => 'npc', 'hp' => 2, 'max_hp' => 20,
            'temporary_hp' => 5, 'exhaustion' => 2, 'lifecycle' => ['state' => 'dead'], 'resources' => [['key' => 'stamina', 'name' => 'Stamina', 'current' => 1, 'max' => 5]],
            'spellcasting' => ['slots' => [1 => ['current' => 0, 'max' => 2]]]]);
        $this->npc = $this->source->tokens()->create(['character_id' => $character->id, 'name' => 'Sentry', 'x' => 100, 'y' => 150, 'rotation' => 35, 'is_hidden' => true]);
        $this->chest = $this->postJson('/api/scenes/'.$this->source->id.'/props', ['action' => 'create', 'assetId' => $asset, 'purpose' => 'container', 'x' => 180, 'y' => 220])->assertOk()->json('props.0');
        $this->source->props()->whereKey($this->chest['id'])->update(['rotation' => 45, 'scale_x' => .7, 'scale_y' => 1.2]);
        $this->definition = (new ItemDefinition)->forceFill(['campaign_id' => $this->source->campaign_id, 'name' => 'Ruby', 'icon' => 'ring', 'description' => 'Prepared gem',
            'category' => 'other', 'rarity' => 'common', 'width' => 1, 'height' => 1, 'max_stack' => 10, 'equipment_slots' => [], 'modifiers' => []]);
        $this->definition->save();
        LootContainer::find($this->chest['loot']['id'])->items()->create(['item_definition_id' => $this->definition->id, 'quantity' => 3]);
        $character->inventory()->create(['item_definition_id' => $this->definition->id, 'quantity' => 1]);
    }

    private function saveData(array $patch = []): array
    {
        return array_replace(['name' => 'Sentry camp', 'description' => 'Guard and supplies', 'tokenIds' => [$this->npc->id], 'propIds' => [$this->chest['id']],
            'expectedRevision' => $this->source->fresh()->revision, 'clientMutationId' => (string) Str::uuid()], $patch);
    }

    private function save(array $patch = []): array
    {
        return $this->postJson('/api/scenes/'.$this->source->id.'/composition-presets', $this->saveData($patch))->assertOk()->json('preset');
    }

    private function place(array $preset, array $patch = [])
    {
        return $this->postJson('/api/scenes/'.$this->destination->id.'/composition-placement', array_replace(['presetId' => $preset['id'], 'expectedRevision' => $preset['revision'],
            'x' => 600, 'y' => 450, 'clientMutationId' => (string) Str::uuid()], $patch));
    }

    public function test_cross_campaign_snapshot_is_independent_portable_atomic_and_undoable(): void
    {
        $command = $this->saveData();
        $preset = $this->postJson('/api/scenes/'.$this->source->id.'/composition-presets', $command)->assertOk()->assertJsonPath('preset.count', 2)->json('preset');
        $this->postJson('/api/scenes/'.$this->source->id.'/composition-presets', $command)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertDatabaseCount('composition_presets', 1);
        $this->assertSame(1, $this->source->fresh()->revision);
        $this->npc->character->update(['name' => 'Edited original']);
        $this->definition->update(['name' => 'Edited original item']);
        $result = $this->place($preset)->assertOk()->assertJsonPath('revision', 1)->assertJsonPath('tokens.0.x', 600)->assertJsonPath('props.0.x', 680)
            ->assertJsonPath('props.0.y', 520)->assertJsonPath('props.0.rotation', 45)->assertJsonPath('tokens.0.hp', 20)->json();
        $copy = Token::find($result['tokens'][0]['id']);
        $this->assertNotSame($copy->character_id, $this->npc->character_id);
        $this->assertSame('Sentry', $copy->character->name);
        $this->assertNull($copy->owner_user_id);
        $this->assertNull($copy->character->lifecycle);
        $this->assertSame(0, $copy->character->temporary_hp);
        $this->assertSame(0, $copy->character->exhaustion);
        $this->assertSame(5, $copy->character->resources[0]['current']);
        $this->assertSame(2, $copy->character->spellcasting['slots'][1]['current']);
        $loot = LootContainer::find($result['props'][0]['loot']['id']);
        $this->assertNotSame($this->chest['loot']['id'], (string) $loot->id);
        $this->assertSame('Ruby', $loot->items()->first()->definition->name);
        $this->assertSame($this->destination->campaign_id, $loot->items()->first()->definition->campaign_id);
        $this->assertNotSame($this->definition->id, $loot->items()->first()->item_definition_id);
        $this->assertNotSame($copy->character->inventory()->first()->item_definition_id, $loot->items()->first()->item_definition_id);
        $inverse = ['kind' => 'selectionPresence', 'id' => (string) $this->destination->id, 'expected' => $result['selectionEdit'], 'value' => array_replace($result['selectionEdit'], ['present' => false])];
        $path = '/api/scenes/'.$this->destination->id.'/edit-history';
        $this->postJson($path, ['changes' => [$inverse]])->assertOk()->assertJsonCount(1, 'deletedIds')->assertJsonCount(1, 'deletedPropIds');
        $this->assertDatabaseMissing('loot_containers', ['id' => $loot->id]);
        $this->postJson($path, ['changes' => [array_replace($inverse, ['expected' => $inverse['value'], 'value' => $inverse['expected']])]])->assertOk()->assertJsonPath('props.0.loot.id', (string) $loot->id);
        $next = $this->place($preset)->assertOk()->json();
        $this->assertNotSame($result['tokens'][0]['id'], $next['tokens'][0]['id']);
        $this->assertNotSame($result['tokens'][0]['characterId'], $next['tokens'][0]['characterId']);
        $loot->items()->first()->update(['quantity' => 1]);
        $this->assertSame(3, LootContainer::find($next['props'][0]['loot']['id'])->items()->first()->quantity);
        $this->getJson('/api/scenes/'.$this->destination->id.'/snapshot')->assertOk()->assertJsonCount(2, 'tokens')->assertJsonCount(2, 'props');
        $this->postJson($path, ['changes' => [$inverse]])->assertConflict();
        Event::assertNotDispatched(TabletopEvent::class, fn ($e) => str_contains(json_encode($e->envelope), 'selectionEdit'));
        $this->source->tokens()->delete();
        $this->source->props()->delete();
        $this->npc->character->delete();
        $this->definition->delete();
        $this->source->campaign->delete();
        $this->place($preset)->assertOk();
    }

    public function test_placement_receipt_replay_and_privacy_and_role_loss(): void
    {
        $preset = $this->save();
        $id = (string) Str::uuid();
        $result = $this->place($preset, ['clientMutationId' => $id])->assertOk()->json();
        $this->place($preset, ['clientMutationId' => $id])->assertOk()->assertHeader('Idempotent-Replay', 'true')->assertJsonPath('tokens.0.id', $result['tokens'][0]['id']);
        $this->assertSame(1, $this->destination->fresh()->revision);
        $this->assertSame(1, $this->destination->tokens()->count());
        foreach (Event::dispatched(TabletopEvent::class)->pluck(0)->filter(fn ($e) => str_contains($e->channel, '.user.')) as $event) {
            $json = json_encode($event->envelope);
            $this->assertStringNotContainsString('Sentry', $json);
            $this->assertStringNotContainsString('Guard and supplies', $json);
        }
        $this->actingAs($this->player)->getJson('/api/library/compositions')->assertJsonCount(0, 'presets');
        $this->place($preset)->assertForbidden();
        $this->postJson('/api/scenes/'.$this->source->id.'/composition-presets', $this->saveData())->assertForbidden();
        $this->actingAs($this->gm);
        $this->destination->campaign->members()->updateExistingPivot($this->gm, ['role' => 'player']);
        $this->place($preset, ['clientMutationId' => $id])->assertForbidden();
    }

    public function test_library_commands_have_revisions_owner_scope_and_independent_copies(): void
    {
        $preset = $this->save();
        $path = '/api/library/compositions/'.$preset['id'].'/command';
        $this->postJson($path, ['action' => 'rename', 'name' => 'Edited', 'expectedRevision' => 1])->assertOk()->assertJsonPath('preset.revision', 2);
        $this->postJson($path, ['action' => 'delete', 'expectedRevision' => 1])->assertConflict();
        $this->place($preset)->assertConflict();
        $copy = $this->postJson($path, ['action' => 'duplicate', 'expectedRevision' => 2])->assertOk()->json('preset');
        $this->assertNotSame($copy['id'], $preset['id']);
        $this->actingAs($this->player)->postJson($path, ['action' => 'delete', 'expectedRevision' => 2])->assertNotFound();
        $this->actingAs($this->gm)->postJson($path, ['action' => 'delete', 'expectedRevision' => 2])->assertOk();
        $this->place($copy)->assertOk();
        $this->getJson('/api/library/compositions?search=Edited')->assertOk()->assertJsonCount(1, 'presets');
    }

    public function test_assets_are_portable_and_protected_and_placement_survives_preset_removal(): void
    {
        $preset = $this->save();
        $image = $preset['members'][1]['image'];
        $asset = Asset::find($image['id']);
        $this->assertNull($asset->campaign_id);
        $this->assertSame($this->gm->id, $asset->library_user_id);
        $this->assertNotSame($this->chest['image']['id'], $image['id']);
        $this->deleteJson('/api/assets/'.$asset->id)->assertConflict();
        $result = $this->place($preset)->assertOk()->json();
        $this->postJson('/api/library/compositions/'.$preset['id'].'/command', ['action' => 'delete', 'expectedRevision' => 1])->assertOk();
        $this->assertDatabaseHas('scene_props', ['id' => $result['props'][0]['id']]);
        $this->deleteJson('/api/assets/'.$asset->id)->assertConflict();
        $this->actingAs($this->player)->get($image['url'])->assertOk();
    }

    public function test_invalid_and_stale_saves_and_bounds_do_not_partially_write(): void
    {
        $path = '/api/scenes/'.$this->source->id.'/composition-presets';
        $this->postJson($path, $this->saveData(['expectedRevision' => 0]))->assertConflict();
        $this->postJson($path, $this->saveData(['propIds' => ['999999']]))->assertUnprocessable();
        $this->postJson($path, $this->saveData(['name' => '   ']))->assertUnprocessable();
        $this->assertDatabaseCount('composition_presets', 0);
        $preset = $this->save();
        $this->place($preset, ['x' => 999999])->assertUnprocessable();
        $this->assertSame(0, $this->destination->tokens()->count());
        $this->assertSame(0, $this->destination->props()->count());
        $this->assertSame(0, $this->destination->fresh()->revision);
    }

    public function test_external_interactions_fail_whole_save_and_safe_interactions_get_fresh_identity(): void
    {
        $action = ['id' => (string) Str::uuid(), 'author_id' => $this->gm->id, 'label' => 'Inspect', 'icon' => 'eye', 'enabled' => true, 'result_type' => 'handout', 'result_target' => 123];
        $prop = $this->source->props()->find($this->chest['id']);
        $prop->update(['interactions' => [$action]]);
        $this->postJson('/api/scenes/'.$this->source->id.'/composition-presets', $this->saveData())->assertUnprocessable()->assertJsonPath('message', 'Действия с событиями или раздатками кампании нельзя переносить. Выберите результат «Ничего» перед сохранением.');
        $this->assertDatabaseCount('composition_presets', 0);
        $action['result_type'] = 'nothing';
        $action['result_target'] = null;
        $prop->update(['interactions' => [$action]]);
        $preset = $this->save();
        $a = $this->place($preset)->assertOk()->json('props.0.interactions.0.id');
        $b = $this->place($preset)->assertOk()->json('props.0.interactions.0.id');
        $this->assertNotSame($action['id'], $a);
        $this->assertNotSame($a, $b);
        $this->assertSame($action['id'], $prop->fresh()->interactions[0]['id']);
    }

    public function test_item_definition_links_icons_and_equipment_bases_are_copied_without_runtime_modifiers(): void
    {
        $this->npc->character->update(['ac' => 10, 'speed' => 30, 'hit_point_dice' => [['die' => 'd8', 'max' => 3, 'current' => 1]],
            'spellcasting' => ['verbal_blocked' => true]]);
        $this->definition->update(['modifiers' => ['ac' => 2], 'icon' => 'asset:'.$this->chest['image']['id']]);
        $this->npc->character->inventory()->first()->update(['equipped_slot' => 'ring_1']);
        $loot = LootContainer::find($this->chest['loot']['id']);
        $loot->items()->create(['item_definition_id' => $this->definition->id, 'quantity' => 2]);
        $loot->items()->create(['item_definition_id' => $this->definition->id, 'quantity' => 0]);
        $preset = $this->save();
        $result = $this->place($preset)->assertOk()->json();
        $copy = Token::find($result['tokens'][0]['id'])->character;
        $this->assertSame(10, $copy->getRawOriginal('ac'));
        $this->assertSame(12, $copy->ac);
        $this->assertSame(3, $copy->hit_point_dice[0]['current']);
        $this->assertFalse($copy->spellcasting['verbal_blocked']);
        $items = LootContainer::find($result['props'][0]['loot']['id'])->items()->with('definition')->get();
        $this->assertCount(2, $items);
        $this->assertCount(1, $items->pluck('item_definition_id')->unique());
        $this->assertSame('asset:'.$preset['members'][1]['image']['id'], $items[0]->definition->icon);
        $this->assertSame(1, CompositionPreset::find($preset['id'])->assets()->count());
        $this->post('/api/library/assets/'.$preset['members'][1]['image']['id'].'/replace', ['file' => UploadedFile::fake()->image('replacement.png')])->assertConflict();
    }

    public function test_unsafe_player_locked_and_oversized_selections_fail_without_a_partial_preset(): void
    {
        $path = '/api/scenes/'.$this->source->id.'/composition-presets';
        $this->npc->character->update(['owner_user_id' => $this->player->id]);
        $this->postJson($path, $this->saveData())->assertUnprocessable();
        $this->npc->character->update(['owner_user_id' => null]);
        $this->npc->update(['is_locked' => true]);
        $this->postJson($path, $this->saveData())->assertConflict();
        $this->npc->update(['is_locked' => false]);
        $this->npc->character->update(['abilities' => [['result' => ['type' => 'cue', 'target' => 123]]]]);
        $this->postJson($path, $this->saveData())->assertUnprocessable()->assertJsonPath('message', 'Способность с раздаткой или событием кампании нельзя сохранить в глобальный пресет.');
        $this->npc->character->update(['abilities' => []]);
        $this->definition->update(['description' => str_repeat('x', 524288)]);
        $assets = Asset::count();
        $this->postJson($path, $this->saveData())->assertUnprocessable();
        $this->assertDatabaseCount('composition_presets', 0);
        $this->assertDatabaseCount('assets', $assets);
    }

    public function test_portable_loot_icon_is_available_to_destination_gms_and_only_authorized_players(): void
    {
        $icon = $this->post('/api/campaigns/'.$this->source->campaign_id.'/assets', ['kind' => 'token', 'file' => UploadedFile::fake()->image('ruby.png')])->assertOk()->json('id');
        $this->definition->update(['icon' => 'asset:'.$icon]);
        // Keep this dependency exclusive to loot so NPC inventory cannot grant access.
        $this->npc->character->inventory()->delete();
        $preset = $this->save();
        $result = $this->place($preset)->assertOk()->json();
        $loot = LootContainer::find($result['props'][0]['loot']['id']);
        $iconId = substr($loot->items()->first()->definition->icon, 6);
        $this->assertNotSame((string) $icon, $iconId);
        $this->destination->campaign->members()->updateExistingPivot($this->player, ['role' => 'gm']);
        $this->actingAs($this->player)->get('/api/assets/'.$iconId)->assertOk();
        $this->destination->campaign->members()->updateExistingPivot($this->player, ['role' => 'player']);
        $this->get('/api/assets/'.$iconId)->assertForbidden();
        $loot->update(['is_open' => true]);
        $this->get('/api/assets/'.$iconId)->assertOk();
        $this->destination->props()->whereKey($result['props'][0]['id'])->update(['is_hidden' => true]);
        $this->get('/api/assets/'.$iconId)->assertForbidden();
        $this->destination->props()->whereKey($result['props'][0]['id'])->update(['is_hidden' => false]);
        $this->destination->update(['vision_enabled' => true]);
        $this->get('/api/assets/'.$iconId)->assertForbidden();
    }
}
