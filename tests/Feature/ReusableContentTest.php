<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class ReusableContentTest extends TestCase
{
    use DatabaseMigrations;

    private User $gm;

    private User $player;

    private Campaign $campaign;

    private Scene $scene;

    private string $base;

    private string $asset;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('campaigns');
        Event::fake([TabletopEvent::class]);
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Reusable QA']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Table']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->base = '/api/scenes/'.$this->scene->id;
        $this->actingAs($this->gm);
        $this->asset = $this->post('/api/campaigns/'.$this->campaign->id.'/assets', ['kind' => 'prop', 'file' => UploadedFile::fake()->image('Table.png', 400, 200)], ['Accept' => 'application/json'])->assertOk()->json('id');
    }

    private function prop(int $x = 100, int $y = 200): array
    {
        return $this->postJson($this->base.'/props', ['action' => 'create', 'assetId' => $this->asset, 'x' => $x, 'y' => $y])->assertOk()->json('props.0');
    }

    private function template(string $kind, array $tokens, array $props): array
    {
        return $this->postJson('/api/campaigns/'.$this->campaign->id.'/templates', ['kind' => $kind, 'name' => 'Reusable group', 'sceneId' => (string) $this->scene->id, 'tokenIds' => $tokens, 'propIds' => $props])->assertOk()->json('template');
    }

    public function test_props_persist_and_hidden_transitions_filter_events_and_media(): void
    {
        $prop = $this->prop();
        $this->assertArrayNotHasKey('hp', $prop);
        $this->actingAs($this->player)->getJson($this->base.'/snapshot')->assertJsonCount(1, 'props')->assertJsonMissingPath('props.0.isHidden');
        $this->get('/api/assets/'.$this->asset)->assertOk();
        $this->postJson($this->base.'/props', ['action' => 'create', 'assetId' => $this->asset, 'x' => 0, 'y' => 0])->assertForbidden();
        Event::fake([TabletopEvent::class]);
        $this->actingAs($this->gm)->postJson($this->base.'/props', ['action' => 'update', 'id' => $prop['id'], 'patch' => ['name' => 'SECRET PROP', 'rotation' => 45, 'scale_x' => 1.25, 'scale_y' => .75, 'is_hidden' => true]])->assertOk()->assertJsonPath('revision', 2);
        $playerEvent = Event::dispatched(TabletopEvent::class)->pluck(0)->first(fn ($e) => str_contains($e->channel, '.user.'));
        $this->assertSame([$prop['id']], $playerEvent->envelope['payload']['deletedPropIds']);
        $this->assertStringNotContainsString('SECRET PROP', json_encode($playerEvent->envelope));
        $this->actingAs($this->player)->getJson($this->base.'/snapshot')->assertJsonCount(0, 'props');
        $this->get('/api/assets/'.$this->asset)->assertForbidden();
        $this->get('/api/assets/'.$this->asset.'/thumbnail')->assertForbidden();
        $this->actingAs($this->gm)->getJson($this->base.'/snapshot')->assertJsonPath('props.0.rotation', 45)->assertJsonPath('props.0.scaleX', 1.25);
        $this->postJson($this->base.'/props', ['action' => 'update', 'id' => $prop['id'], 'patch' => ['is_hidden' => false], 'order' => 'front'])->assertOk();
        $this->actingAs($this->player)->getJson($this->base.'/snapshot')->assertJsonCount(1, 'props');
    }

    public function test_mixed_group_move_duplicate_and_delete_are_atomic_and_retry_safe(): void
    {
        $p = $this->prop();
        $token = $this->scene->tokens()->create(['name' => 'Guard', 'x' => 150, 'y' => 250]);
        $selection = ['tokenIds' => [(string) $token->id], 'propIds' => [$p['id']]];
        $move = $selection + ['action' => 'move', 'anchorKind' => 'prop', 'anchorId' => $p['id'], 'x' => 400, 'y' => 500, 'clientMutationId' => (string) Str::uuid()];
        $this->postJson($this->base.'/selection', $move)->assertOk()->assertJsonPath('revision', 2)->assertJsonPath('tokens.0.x', 450)->assertJsonPath('props.0.y', 500);
        $this->postJson($this->base.'/selection', $move)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $duplicate = $selection + ['action' => 'duplicate', 'clientMutationId' => (string) Str::uuid()];
        $copy = $this->postJson($this->base.'/selection', $duplicate)->assertOk()->assertJsonPath('revision', 3)->json();
        $this->postJson($this->base.'/selection', $duplicate)->assertOk()->assertJsonPath('revision', 3);
        $this->assertDatabaseCount('scene_props', 2);
        $this->assertDatabaseCount('tokens', 2);
        $this->postJson($this->base.'/selection', $selection + ['action' => 'delete'])->assertOk()->assertJsonPath('revision', 4);
        $this->assertDatabaseHas('scene_props', ['id' => $copy['props'][0]['id']]);
        $this->postJson($this->base.'/selection', $selection + ['action' => 'move', 'anchorKind' => 'prop', 'anchorId' => $p['id'], 'x' => 0, 'y' => 0])->assertUnprocessable();
        $this->assertSame(4, $this->scene->fresh()->revision);
    }

    public function test_prefab_relative_transforms_spawn_in_another_scene_and_protect_assets(): void
    {
        $a = $this->prop(100, 200);
        $b = $this->prop(180, 260);
        $this->postJson($this->base.'/props', ['action' => 'update', 'id' => $b['id'], 'patch' => ['rotation' => 90, 'scale_x' => .8, 'scale_y' => .3]])->assertOk();
        $template = $this->template('prefab', [], [$a['id'], $b['id']]);
        $this->assertSame(3, $this->scene->fresh()->revision);
        $this->assertEquals(80, $template['items'][1]['data']['x']);
        $this->assertEquals(60, $template['items'][1]['data']['y']);
        $this->postJson($this->base.'/selection', ['action' => 'delete', 'tokenIds' => [], 'propIds' => [$a['id'], $b['id']]])->assertOk();
        $this->deleteJson('/api/assets/'.$this->asset)->assertConflict();
        $other = $this->campaign->scenes()->create(['name' => 'Other']);
        $spawn = ['templateId' => $template['id'], 'x' => 600, 'y' => 700, 'clientMutationId' => (string) Str::uuid()];
        $this->postJson('/api/scenes/'.$other->id.'/spawn', $spawn)->assertOk()->assertJsonPath('revision', 1)->assertJsonPath('props.1.x', 680)->assertJsonPath('props.1.y', 760)->assertJsonPath('props.1.rotation', 90);
        $this->postJson('/api/scenes/'.$other->id.'/spawn', $spawn)->assertOk()->assertJsonPath('revision', 1);
        $this->assertDatabaseCount('scene_props', 2);
        $this->postJson('/api/campaigns/'.$this->campaign->id.'/templates/delete', ['templateId' => $template['id']])->assertOk();
        $this->assertDatabaseCount('scene_props', 2);
    }

    public function test_encounter_starts_fresh_and_uses_existing_combat_actions(): void
    {
        $tokens = collect();
        for ($i = 0; $i < 4; $i++) {
            $token = $this->scene->tokens()->create(['name' => $i === 3 ? 'Archer' : 'Goblin', 'x' => $i * 60, 'y' => 100, 'hp' => 2, 'max_hp' => 20, 'ac' => 14, 'speed' => 30, 'owner_user_id' => $this->player->id, 'is_hidden' => $i === 3]);
            $tokens->push((string) $token->id);
            $this->postJson('/api/tokens/'.$token->id.'/condition-add', ['key' => 'poisoned', 'visibility' => 'public'])->assertOk();
        }
        $template = $this->template('encounter', $tokens->all(), []);
        $this->postJson($this->base.'/selection', ['action' => 'delete', 'tokenIds' => $tokens->all(), 'propIds' => []])->assertOk();
        $spawn = ['templateId' => $template['id'], 'x' => 400, 'y' => 300, 'clientMutationId' => (string) Str::uuid()];
        $result = $this->postJson($this->base.'/spawn', $spawn)->assertOk()->assertJsonCount(4, 'tokens')->assertJsonPath('tokens.0.hp', 20)->assertJsonPath('tokens.0.ownerUserId', null)->assertJsonPath('tokens.0.conditions', [])->json();
        $this->postJson($this->base.'/spawn', $spawn)->assertOk()->assertJsonPath('revision', $result['revision']);
        $this->assertDatabaseCount('tokens', 4);
        $combat = $this->postJson($this->base.'/combat/prepare')->assertOk()->json('combat.id');
        $this->postJson($this->base.'/combat/add', ['combatId' => $combat, 'tokenIds' => array_column($result['tokens'], 'id')])->assertOk()->assertJsonCount(4, 'combat.combatants');
        $this->postJson($this->base.'/combat/begin', ['combatId' => $combat])->assertOk()->assertJsonPath('combat.round', 1);
        $this->actingAs($this->player)->getJson($this->base.'/snapshot')->assertJsonCount(3, 'tokens')->assertJsonCount(3, 'combat.combatants');
        $this->getJson('/api/campaigns/'.$this->campaign->id.'/templates?kind=encounter')->assertForbidden();
    }

    public function test_foreign_ids_and_locked_group_roll_back_without_partial_writes(): void
    {
        $p = $this->prop();
        $foreign = Campaign::create(['name' => 'Foreign']);
        $foreign->members()->attach($this->gm, ['role' => 'gm']);
        $scene = $foreign->scenes()->create(['name' => 'Foreign']);
        $token = $scene->tokens()->create(['name' => 'Secret', 'x' => 1, 'y' => 1]);
        $this->postJson($this->base.'/selection', ['action' => 'delete', 'tokenIds' => [(string) $token->id], 'propIds' => [$p['id']]])->assertUnprocessable();
        $this->assertDatabaseCount('scene_props', 1);
        $template = $this->template('prefab', [], [$p['id']]);
        $this->postJson('/api/scenes/'.$scene->id.'/spawn', ['templateId' => $template['id'], 'x' => 0, 'y' => 0])->assertNotFound();
        $this->postJson('/api/scenes/'.$scene->id.'/props', ['action' => 'create', 'assetId' => $this->asset, 'x' => 0, 'y' => 0])->assertNotFound();
        SceneProp::find($p['id'])->update(['is_locked' => true]);
        $this->postJson($this->base.'/selection', ['action' => 'move', 'tokenIds' => [], 'propIds' => [$p['id']], 'anchorKind' => 'prop', 'anchorId' => $p['id'], 'x' => 900, 'y' => 900])->assertConflict();
        $this->assertSame(1, $this->scene->fresh()->revision);
        $this->actingAs($this->player)->postJson($this->base.'/spawn', ['templateId' => $template['id'], 'x' => 0, 'y' => 0])->assertForbidden();
    }

    public function test_stack_order_is_one_coherent_patch_even_with_gaps_and_hidden_neighbours(): void
    {
        $a = $this->prop();
        $b = $this->prop();
        $c = $this->prop();
        SceneProp::find($b['id'])->update(['z_index' => 50, 'is_hidden' => true, 'name' => 'SECRET TABLE']);
        SceneProp::find($c['id'])->update(['z_index' => 50]);
        Event::fake([TabletopEvent::class]);
        $result = $this->postJson($this->base.'/props', ['action' => 'update', 'id' => $c['id'], 'order' => 'backward'])->assertOk()->assertJsonPath('revision', 4);
        $this->assertSame([$a['id'], $c['id'], $b['id']], SceneProp::orderBy('z_index')->pluck('id')->map(strval(...))->all());
        $this->assertCount(2, $result->json('props'));
        $player = Event::dispatched(TabletopEvent::class)->pluck(0)->first(fn ($e) => str_contains($e->channel, '.user.'));
        $this->assertSame([$c['id']], array_column($player->envelope['payload']['props'], 'id'));
        $this->assertStringNotContainsString('SECRET TABLE', json_encode($player->envelope));
        $this->postJson($this->base.'/props', ['action' => 'update', 'id' => $a['id'], 'order' => 'front'])->assertOk();
        $this->assertSame([$c['id'], $b['id'], $a['id']], SceneProp::orderBy('z_index')->pluck('id')->map(strval(...))->all());
    }

    public function test_hidden_only_batches_and_inactive_preparation_do_not_leak_to_players(): void
    {
        $p = $this->prop();
        SceneProp::find($p['id'])->update(['is_hidden' => true, 'name' => 'SECRET SHRINE']);
        $template = $this->template('prefab', [], [$p['id']]);
        Event::fake([TabletopEvent::class]);
        $this->postJson($this->base.'/spawn', ['templateId' => $template['id'], 'x' => 10, 'y' => 10])->assertOk();
        $player = Event::dispatched(TabletopEvent::class)->pluck(0)->first(fn ($e) => str_contains($e->channel, '.user.'));
        $this->assertSame('scene.revision', $player->envelope['type']);
        $this->assertSame([], $player->envelope['payload']);
        $inactive = $this->campaign->scenes()->create(['name' => 'Preparation']);
        Event::fake([TabletopEvent::class]);
        $this->postJson('/api/scenes/'.$inactive->id.'/spawn', ['templateId' => $template['id'], 'x' => 10, 'y' => 10])->assertOk();
        $this->assertCount(1, Event::dispatched(TabletopEvent::class));
        $this->assertStringEndsWith('.gm', Event::dispatched(TabletopEvent::class)[0][0]->channel);
    }
}
