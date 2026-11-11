<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Scene;
use App\Models\User;
use App\Services\TokenMovement;
use App\Services\TriggerEvents;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Support\SeedsCharacterCatalog;
use Tests\TestCase;

class PreparationSelectionTest extends TestCase
{
    use DatabaseMigrations, SeedsCharacterCatalog;

    private User $gm;

    private User $player;

    private Campaign $campaign;

    private Scene $scene;

    private array $token;

    private array $prop;

    private string $path;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCharacterCatalog();
        Storage::fake('campaigns');
        Event::fake([TabletopEvent::class]);
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Preparation']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Entities', 'width' => 2000, 'height' => 1400]);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->actingAs($this->gm);
        $this->path = '/api/scenes/'.$this->scene->id;
        $asset = $this->post('/api/campaigns/'.$this->campaign->id.'/assets', ['kind' => 'prop', 'file' => UploadedFile::fake()->image('chest.png', 80, 80)])->assertOk()->json('id');
        $character = $this->campaign->characters()->create(['name' => 'Guard', 'kind' => 'npc', 'hp' => 12, 'max_hp' => 20]);
        $this->token = $this->scene->tokens()->create(['character_id' => $character->id, 'name' => 'Guard', 'x' => 100, 'y' => 150, 'is_hidden' => true])->toArray();
        $this->prop = $this->postJson($this->path.'/props', ['action' => 'create', 'assetId' => $asset, 'purpose' => 'container', 'x' => 180, 'y' => 220])->assertOk()->json('props.0');
    }

    private function command(array $patch = []): array
    {
        return array_replace(['action' => 'translate', 'tokenIds' => [$this->token['id']], 'propIds' => [$this->prop['id']],
            'anchorKind' => 'token', 'anchorId' => $this->token['id'], 'x' => 600, 'y' => 450,
            'expected' => [['kind' => 'token', 'id' => $this->token['id'], 'x' => 100, 'y' => 150],
                ['kind' => 'prop', 'id' => $this->prop['id'], 'x' => 180, 'y' => 220]], 'clientMutationId' => (string) Str::uuid()], $patch);
    }

    public function test_mixed_authoring_translation_is_one_revision_retry_safe_and_preserves_runtime_links(): void
    {
        $this->mock(TokenMovement::class)->shouldNotReceive('resolve');
        $this->mock(TriggerEvents::class)->shouldNotReceive('movement');
        $command = $this->command();
        $before = $this->getJson($this->path.'/snapshot')->json();
        $result = $this->postJson($this->path.'/selection', $command)->assertOk()->assertJsonPath('revision', 2)->assertJsonPath('tokens.0.x', 600)->assertJsonPath('props.0.x', 680)->json();
        $this->postJson($this->path.'/selection', $command)->assertOk()->assertHeader('Idempotent-Replay', 'true')->assertJsonPath('revision', 2);
        $this->assertSame($before['tokens'][0]['characterId'], $result['tokens'][0]['characterId']);
        $this->assertSame($before['tokens'][0]['hp'], $result['tokens'][0]['hp']);
        $this->assertSame(Arr::except($before['tokens'][0], ['x', 'y']), Arr::except($result['tokens'][0], ['x', 'y']));
        $this->assertSame($before['props'][0]['loot'], $result['props'][0]['loot']);
        $this->assertArrayNotHasKey('tokenMovements', $result);
        $player = Event::dispatched(TabletopEvent::class)->pluck(0)->last(fn ($e) => str_contains($e->channel, '.user.'));
        $this->assertNotNull($player);
        $this->assertStringNotContainsString('Guard', json_encode($player->envelope));
    }

    public function test_interaction_prop_keeps_its_actions_through_translation(): void
    {
        $prop = $this->postJson($this->path.'/props', ['action' => 'create', 'assetId' => $this->prop['image']['id'], 'purpose' => 'interaction', 'x' => 300, 'y' => 400])->assertOk()->json('props.0');
        $command = $this->command(['tokenIds' => [], 'propIds' => [$prop['id']], 'anchorKind' => 'prop', 'anchorId' => $prop['id'], 'x' => 500, 'y' => 600,
            'expected' => [['kind' => 'prop', 'id' => $prop['id'], 'x' => 300, 'y' => 400]]]);
        $result = $this->postJson($this->path.'/selection', $command)->assertOk()->json('props.0');
        $this->assertSame($prop['interactions'], $result['interactions']);
        $this->assertSame($prop['id'], $result['id']);
    }

    public function test_stale_member_locked_member_and_out_of_range_reject_whole_group(): void
    {
        $revision = $this->scene->fresh()->revision;
        $command = $this->command();
        $command['expected'][1]['x']++;
        $this->postJson($this->path.'/selection', $command)->assertConflict();
        $this->scene->props()->whereKey($this->prop['id'])->update(['is_locked' => true]);
        $this->postJson($this->path.'/selection', $this->command())->assertConflict();
        $this->scene->props()->whereKey($this->prop['id'])->update(['is_locked' => false, 'x' => 999999]);
        $command = $this->command(['x' => 200]);
        $command['expected'][1]['x'] = 999999;
        $this->postJson($this->path.'/selection', $command)->assertUnprocessable();
        $this->assertSame($revision, $this->scene->fresh()->revision);
        $this->assertDatabaseHas('tokens', ['id' => $this->token['id'], 'x' => 100, 'y' => 150]);
        $this->assertDatabaseHas('scene_props', ['id' => $this->prop['id'], 'x' => 999999, 'y' => 220]);
    }

    public function test_exact_membership_anchor_cross_scene_and_player_boundaries(): void
    {
        $command = $this->command();
        array_pop($command['expected']);
        $this->postJson($this->path.'/selection', $command)->assertUnprocessable();
        $command = $this->command();
        $command['expected'][1] = $command['expected'][0];
        $this->postJson($this->path.'/selection', $command)->assertUnprocessable();
        $this->postJson($this->path.'/selection', $this->command(['anchorId' => 999999]))->assertUnprocessable();
        $other = $this->campaign->scenes()->create(['name' => 'Other'])->tokens()->create(['name' => 'Elsewhere', 'x' => 50, 'y' => 50]);
        $this->postJson($this->path.'/selection', $this->command(['tokenIds' => [$other->id]]))->assertUnprocessable();
        $this->actingAs($this->player)->postJson($this->path.'/selection', $this->command())->assertForbidden();
        $this->actingAs(User::factory()->create())->postJson($this->path.'/selection', $this->command())->assertForbidden();
    }

    public function test_one_history_command_restores_mixed_group_and_conflict_rolls_back_all_members(): void
    {
        $this->postJson($this->path.'/selection', $this->command())->assertOk();
        $changes = [
            ['kind' => 'token', 'id' => $this->token['id'], 'expected' => ['x' => 600, 'y' => 450], 'value' => ['x' => 100, 'y' => 150]],
            ['kind' => 'prop', 'id' => $this->prop['id'], 'expected' => ['x' => 680, 'y' => 520], 'value' => ['x' => 180, 'y' => 220]],
        ];
        $wrong = $changes;
        $wrong[1]['expected']['x']++;
        $this->postJson($this->path.'/edit-history', ['changes' => $wrong])->assertConflict();
        $this->assertDatabaseHas('tokens', ['id' => $this->token['id'], 'x' => 600]);
        $this->postJson($this->path.'/edit-history', ['changes' => $changes])->assertOk()->assertJsonPath('revision', 3);
        $redo = array_map(fn ($c) => array_replace($c, ['expected' => $c['value'], 'value' => $c['expected']]), $changes);
        $this->postJson($this->path.'/edit-history', ['changes' => $redo])->assertOk()->assertJsonPath('revision', 4);
        $this->assertDatabaseHas('scene_props', ['id' => $this->prop['id'], 'x' => 680]);
    }

    private function presenceInverse(array $result): array
    {
        $edit = $result['selectionEdit'];
        return ['kind' => 'selectionPresence', 'id' => (string) $this->scene->id,
            'expected' => $edit, 'value' => array_replace($edit, ['present' => ! $edit['present']])];
    }

    public function test_duplicate_preserves_layout_and_clones_npc_inventory_loot_and_internal_condition_links(): void
    {
        $token = \App\Models\Token::find($this->token['id']);
        $token->conditions()->create(['key' => 'poisoned', 'label' => 'Poisoned', 'normalized_label' => 'poisoned', 'visibility' => 'gm', 'created_by' => $this->gm->id, 'source_token_id' => $token->id]);
        $definition = (new \App\Models\ItemDefinition)->forceFill(['campaign_id' => $this->campaign->id, 'name' => 'Ring', 'icon' => 'ring', 'category' => 'other', 'rarity' => 'common', 'width' => 1, 'height' => 1, 'max_stack' => 10, 'equipment_slots' => [], 'modifiers' => []]);
        $definition->save();
        $loot = \App\Models\LootContainer::where('prop_id', $this->prop['id'])->firstOrFail();
        $loot->items()->create(['item_definition_id' => $definition->id, 'quantity' => 2]);
        $token->character->inventory()->create(['item_definition_id' => $definition->id, 'quantity' => 1]);
        $interaction = $this->postJson($this->path.'/props', ['action' => 'create', 'assetId' => $this->prop['image']['id'], 'purpose' => 'interaction', 'x' => 250, 'y' => 300])->assertOk()->json('props.0');
        $command = $this->command(['action' => 'duplicate', 'propIds' => [$this->prop['id'], $interaction['id']]]);
        $command['expected'][] = ['kind' => 'prop', 'id' => $interaction['id'], 'x' => 250, 'y' => 300];
        $before = $this->scene->fresh()->revision;
        $result = $this->postJson($this->path.'/selection', $command)->assertOk()->assertJsonPath('revision', $before + 1)->json();
        $copy = $result['tokens'][0];
        $this->assertNotSame((string) $token->character_id, $copy['characterId']);
        $this->assertSame(12, $copy['hp']);
        $this->assertSame($copy['id'], $copy['conditions'][0]['sourceTokenId']);
        $this->assertSame('gm', $copy['conditions'][0]['visibility']);
        $this->assertSame(680, $result['props'][0]['x']);
        $this->assertNotSame($this->prop['loot']['id'], $result['props'][0]['loot']['id']);
        $this->assertNotSame($interaction['interactions'][0]['id'], $result['props'][1]['interactions'][0]['id']);
        $this->assertSame($interaction['interactions'][0]['label'], $result['props'][1]['interactions'][0]['label']);
        $copyLoot = \App\Models\LootContainer::find($result['props'][0]['loot']['id']);
        $this->assertSame(2, $copyLoot->items()->first()->quantity);
        $this->assertNotSame($definition->id, $copyLoot->items()->first()->item_definition_id);
        $this->postJson($this->path.'/selection', $command)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $inverse = $this->presenceInverse($result);
        $this->postJson($this->path.'/edit-history', ['changes' => [$inverse]])->assertOk();
        $this->assertDatabaseMissing('tokens', ['id' => $copy['id']]);
        $redo = array_replace($inverse, ['expected' => $inverse['value'], 'value' => $inverse['expected']]);
        $this->postJson($this->path.'/edit-history', ['changes' => [$redo]])->assertOk()->assertJsonPath('tokens.0.characterId', $copy['characterId']);
        $copyLoot->items()->first()->update(['quantity' => 1]);
        $this->postJson($this->path.'/edit-history', ['changes' => [$inverse]])->assertConflict();
        $this->assertDatabaseHas('tokens', ['id' => $copy['id']]);
        $this->assertDatabaseHas('tokens', ['id' => $token->id, 'x' => 100]);
        Event::assertNotDispatched(TabletopEvent::class, fn ($e) => str_contains(json_encode($e->envelope), 'selectionEdit'));
    }

    public function test_delete_restores_scene_instances_and_rejects_invalid_or_conflicting_history_atomically(): void
    {
        $character = \App\Models\Token::find($this->token['id'])->character_id;
        $result = $this->postJson($this->path.'/selection', $this->command(['action' => 'delete']))->assertOk()->json();
        $this->assertDatabaseMissing('tokens', ['id' => $this->token['id']]);
        $this->assertDatabaseHas('characters', ['id' => $character]);
        $inverse = $this->presenceInverse($result);
        \App\Models\Character::find($character)->update(['hp' => 13]);
        $this->postJson($this->path.'/edit-history', ['changes' => [$inverse]])->assertConflict();
        \App\Models\Character::find($character)->update(['hp' => 12]);
        $tampered = $inverse; $tampered['value']['snapshot'] .= 'x';
        $this->postJson($this->path.'/edit-history', ['changes' => [$tampered]])->assertUnprocessable();
        $this->actingAs($this->player)->postJson($this->path.'/edit-history', ['changes' => [$inverse]])->assertForbidden();
        $this->actingAs($this->gm)->postJson($this->path.'/edit-history', ['changes' => [$inverse]])->assertOk()->assertJsonPath('props.0.loot.id', $this->prop['loot']['id']);
        $this->assertDatabaseHas('tokens', ['id' => $this->token['id'], 'character_id' => $character]);
        $this->postJson($this->path.'/edit-history', ['changes' => [$inverse]])->assertConflict();
    }

    public function test_locked_player_owned_and_foreign_members_reject_entire_operations(): void
    {
        foreach (['duplicate', 'delete', 'hide', 'show'] as $action) {
            $this->scene->props()->whereKey($this->prop['id'])->update(['is_locked' => true]);
            $this->postJson($this->path.'/selection', $this->command(['action' => $action]))->assertConflict();
            $this->actingAs($this->player)->postJson($this->path.'/selection', $this->command(['action' => $action]))->assertForbidden();
            $this->actingAs($this->gm);
        }
        $this->scene->props()->whereKey($this->prop['id'])->update(['is_locked' => false]);
        \App\Models\Token::find($this->token['id'])->character->update(['owner_user_id' => $this->player->id]);
        $this->postJson($this->path.'/selection', $this->command(['action' => 'duplicate']))->assertUnprocessable();
        $this->assertDatabaseCount('tokens', 1);
        $this->assertDatabaseCount('scene_props', 1);
        $this->assertDatabaseHas('tokens', ['id' => $this->token['id'], 'is_hidden' => true]);
    }

    public function test_mixed_visibility_undo_and_show_keep_server_player_projection_authoritative(): void
    {
        $hidden = $this->postJson($this->path.'/selection', $this->command(['action' => 'hide']))->assertOk()->assertJsonPath('tokens.0.isHidden', true)->assertJsonPath('props.0.isHidden', true)->json();
        $this->assertTrue($hidden['selectionVisibilityBefore']['tokens'][0]['isHidden']);
        $this->assertFalse($hidden['selectionVisibilityBefore']['props'][0]['isHidden']);
        $this->actingAs($this->player)->getJson($this->path.'/snapshot')->assertJsonCount(0, 'tokens')->assertJsonCount(0, 'props');
        $this->actingAs($this->gm);
        $this->postJson($this->path.'/edit-history', ['changes' => [['kind' => 'prop', 'id' => $this->prop['id'], 'expected' => ['isHidden' => true], 'value' => ['isHidden' => false]]]])->assertOk();
        $this->scene->update(['vision_enabled' => true]); // No owned observer: Show cannot grant vision.
        $this->postJson($this->path.'/selection', $this->command(['action' => 'show']))->assertOk()->assertJsonPath('tokens.0.isHidden', false)->assertJsonPath('props.0.isHidden', false);
        $this->actingAs($this->player)->getJson($this->path.'/snapshot')->assertJsonCount(0, 'tokens')->assertJsonCount(0, 'props');
        $this->actingAs($this->gm)->postJson($this->path.'/edit-history', ['changes' => [['kind' => 'token', 'id' => $this->token['id'], 'expected' => ['isHidden' => false], 'value' => ['isHidden' => true]]]])->assertOk()->assertJsonPath('tokens.0.isHidden', true);
        $playerEvents = Event::dispatched(TabletopEvent::class)->pluck(0)->filter(fn ($e) => str_contains($e->channel, '.user.'));
        foreach ($playerEvents as $event) $this->assertStringNotContainsString('selectionVisibilityBefore', json_encode($event->envelope));
    }

    public function test_unsupported_cue_and_external_condition_links_reject_without_partial_deletion_or_cloning(): void
    {
        $cue = $this->postJson($this->path.'/cues/save', ['name' => 'Reveal group', 'steps' => [['type' => 'objects.reveal', 'config' => ['tokenIds' => [$this->token['id']], 'propIds' => []]]]])->assertOk()->json('cue.id');
        foreach (['duplicate', 'delete'] as $action) $this->postJson($this->path.'/selection', $this->command(['action' => $action]))->assertUnprocessable()->assertJsonPath('message', 'В группе есть объекты, используемые событиями сцены. Сначала измените цели событий.');
        $this->postJson($this->path.'/cues/delete', ['cueId' => $cue])->assertOk();
        $outside = $this->scene->tokens()->create(['name' => 'External', 'x' => 10, 'y' => 20]);
        $outside->conditions()->create(['key' => 'poisoned', 'label' => 'Poisoned', 'normalized_label' => 'poisoned', 'visibility' => 'public', 'created_by' => $this->gm->id, 'source_token_id' => $this->token['id']]);
        foreach (['duplicate', 'delete'] as $action) $this->postJson($this->path.'/selection', $this->command(['action' => $action]))->assertUnprocessable();
        $this->assertDatabaseHas('tokens', ['id' => $this->token['id'], 'x' => 100]);
        $this->assertDatabaseHas('scene_props', ['id' => $this->prop['id']]);
        $this->assertDatabaseHas('token_conditions', ['token_id' => $outside->id, 'source_token_id' => $this->token['id']]);
    }
}
