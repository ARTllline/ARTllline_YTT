<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\AbilityExecution;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\Cue;
use App\Models\Handout;
use App\Models\SceneProp;
use App\Models\Token;
use App\Models\User;
use App\Services\AbilityGeometry;
use App\Services\D20Roller;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

class CharacterGameplayTest extends TestCase
{
    use DatabaseMigrations;

    private User $gm;

    private User $player;

    private User $other;

    private Campaign $campaign;

    private $scene;

    private Character $hero;

    private Token $actor;

    private Token $enemy;

    private array $ability;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        [$this->gm, $this->player, $this->other] = User::factory()->count(3)->create()->all();
        $this->campaign = Campaign::create(['name' => 'Gameplay']);
        foreach ([[$this->gm, 'gm'], [$this->player, 'player'], [$this->other, 'player']] as [$user, $role]) {
            $this->campaign->members()->attach($user, ['role' => $role]);
        }
        $this->scene = $this->campaign->scenes()->create(['name' => 'Arena']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->ability = ['id' => (string) Str::uuid(), 'name' => 'Огненный импульс', 'icon' => 'flame', 'description' => 'Короткая вспышка',
            'category' => 'attack', 'target' => 'token', 'check' => ['stat_key' => 'magic', 'modifier' => 99, 'dc' => 12, 'dc_visible' => false, 'defense' => 'ac'],
            'costs' => [['key' => 'mana', 'amount' => 2]], 'damage' => '2d6', 'result' => ['type' => 'nothing', 'target' => null, 'amount' => 0], 'sort_order' => 0, 'enabled' => true];
        $this->hero = $this->campaign->characters()->create(['name' => 'Керн', 'owner_user_id' => $this->player->id,
            'hp' => 34, 'max_hp' => 41, 'ac' => 17, 'speed' => 30, 'check_stats' => [['key' => 'magic', 'label' => 'Магия', 'modifier' => 4]],
            'resources' => [$this->resource()], 'abilities' => [$this->ability]]);
        $this->actor = $this->scene->tokens()->create(['character_id' => $this->hero->id, 'name' => 'Керн', 'x' => 100, 'y' => 200]);
        $this->enemy = $this->scene->tokens()->create(['name' => 'Враг', 'ac' => 17, 'hp' => 30, 'max_hp' => 30, 'x' => 400, 'y' => 200]);
        DB::table('campaign_members')->where('campaign_id', $this->campaign->id)->where('user_id', $this->player->id)->update(['active_character_id' => $this->hero->id]);
    }

    private function resource(): array
    {
        return ['key' => 'mana', 'label' => 'Мана', 'current' => 6, 'max' => 10, 'icon' => 'spark', 'accent' => 'violet', 'sort_order' => 0, 'player_adjustable' => true];
    }

    private function command(): array
    {
        return ['characterId' => $this->hero->id, 'abilityId' => $this->ability['id'], 'epoch' => 0, 'target' => ['kind' => 'token', 'id' => $this->enemy->id], 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()];
    }

    private function runAbility(array $data)
    {
        return $this->actingAs($this->player)->postJson('/api/scenes/'.$this->scene->id.'/abilities/execute', $data);
    }

    private function roll(int $value): void
    {
        $this->mock(D20Roller::class, fn ($mock) => $mock->shouldReceive('roll')->andReturn($value));
    }

    public function test_attack_damage_cost_and_both_receipt_and_durable_retries_are_exactly_once(): void
    {
        $this->roll(16);
        $command = $this->command();
        $first = $this->runAbility($command)->assertOk()->assertJsonPath('execution.roll.total', 20)->assertJsonPath('execution.success', true)->assertJsonMissingPath('execution.roll.dc')->json('execution');
        $this->assertSame(4, $this->hero->fresh()->resources[0]['current']);
        $this->assertSame(30 - $first['damage']['total'], (int) $this->enemy->fresh()->hp);
        $this->runAbility($command)->assertOk()->assertHeader('Idempotent-Replay', 'true')->assertJsonPath('execution', $first);
        DB::table('scene_mutation_receipts')->delete();
        $this->runAbility($command)->assertOk()->assertJsonPath('execution', $first);
        $this->assertSame(4, $this->hero->fresh()->resources[0]['current']);
        $this->assertSame(30 - $first['damage']['total'], (int) $this->enemy->fresh()->hp);
        $this->assertDatabaseCount('ability_executions', 1);
        $this->assertSame(17, AbilityExecution::sole()->result['roll']['dc']);
        $command['target']['id'] = $this->actor->id;
        $this->runAbility($command)->assertConflict();
    }

    public function test_natural_one_and_twenty_have_no_implicit_critical_rules(): void
    {
        $this->roll(20);
        $this->enemy->update(['ac' => 100]);
        $this->runAbility($this->command())->assertOk()->assertJsonPath('execution.success', false)->assertJsonPath('execution.damage', null);
        $this->assertSame(30, (int) $this->enemy->fresh()->hp);
    }

    public function test_missing_defense_or_resource_rolls_back_everything(): void
    {
        $this->roll(20);
        $this->enemy->update(['ac' => null]);
        $this->runAbility($this->command())->assertUnprocessable();
        $this->assertSame(6, $this->hero->fresh()->resources[0]['current']);
        $this->enemy->update(['ac' => 17]);
        $r = $this->resource();
        $r['current'] = 1;
        $this->hero->update(['resources' => [$r]]);
        $this->runAbility($this->command())->assertUnprocessable();
        $this->assertSame(1, $this->hero->fresh()->resources[0]['current']);
        $this->assertDatabaseCount('ability_executions', 0);
        $this->assertDatabaseCount('scene_mutation_receipts', 0);
    }

    public function test_target_visibility_campaign_and_active_actor_are_authoritative(): void
    {
        $this->enemy->update(['is_hidden' => true]);
        $this->runAbility($this->command())->assertForbidden();
        $this->enemy->update(['is_hidden' => false]);
        $foreign = Campaign::create(['name' => 'Other']);
        $scene = $foreign->scenes()->create(['name' => 'Other']);
        $token = $scene->tokens()->create(['name' => 'Other', 'x' => 0, 'y' => 0]);
        $command = $this->command();
        $command['target']['id'] = $token->id;
        $this->runAbility($command)->assertNotFound();
        $command = $this->command();
        $command['target']['kind'] = 'prop';
        $this->runAbility($command)->assertUnprocessable();
        $this->actor->update(['is_hidden' => true]);
        $this->runAbility($this->command())->assertUnprocessable();
        $this->assertSame(6, $this->hero->fresh()->resources[0]['current']);
    }

    public function test_other_owner_and_revoked_owner_cannot_execute_or_replay(): void
    {
        $this->roll(16);
        $command = $this->command();
        $this->actingAs($this->other)->postJson('/api/scenes/'.$this->scene->id.'/abilities/execute', $command)->assertForbidden();
        $this->runAbility($command)->assertOk();
        $this->hero->update(['owner_user_id' => $this->other->id]);
        $this->runAbility($command)->assertForbidden();
    }

    public function test_manual_resources_are_bounded_owned_permitted_and_idempotent(): void
    {
        $url = '/api/campaigns/'.$this->campaign->id.'/resources/adjust';
        $data = ['characterId' => $this->hero->id, 'key' => 'mana', 'delta' => 9999, 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($this->player)->postJson($url, $data)->assertOk();
        $this->postJson($url, $data)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertSame(10, $this->hero->fresh()->resources[0]['current']);
        $r = $this->resource();
        $r['player_adjustable'] = false;
        $this->hero->update(['resources' => [$r]]);
        $data['clientMutationId'] = (string) Str::uuid();
        $this->postJson($url, $data)->assertForbidden();
        $this->actingAs($this->other)->postJson($url, $data)->assertForbidden();
    }

    public function test_self_healing_and_checks_work_without_scene_representation(): void
    {
        $ability = $this->ability;
        $ability['category'] = 'effect';
        $ability['target'] = 'self';
        $ability['check'] = null;
        $ability['damage'] = null;
        $ability['result'] = ['type' => 'heal', 'target' => null, 'amount' => 6];
        $this->hero->update(['abilities' => [$ability]]);
        $this->actor->delete();
        $command = $this->command();
        $command['target'] = null;
        $this->runAbility($command)->assertOk()->assertJsonPath('execution.healing', 6);
        $this->assertSame(40, $this->hero->fresh()->hp);
        $this->assertSame(4, $this->hero->fresh()->resources[0]['current']);
        $ability['category'] = 'check';
        $ability['check'] = $this->ability['check'];
        $ability['result']['type'] = 'nothing';
        $this->hero->update(['abilities' => [$ability]]);
        $this->roll(15);
        $command['clientMutationId'] = (string) Str::uuid();
        $command['rollMode'] = 'advantage';
        $this->runAbility($command)->assertOk()->assertJsonPath('execution.roll.rawDice', [15, 15])->assertJsonPath('execution.roll.modifier', 4);
    }

    public function test_private_configuration_is_absent_from_other_players_snapshots_and_broadcasts(): void
    {
        $snapshot = '/api/scenes/'.$this->scene->id.'/snapshot';
        $this->actingAs($this->player)->getJson($snapshot)->assertJsonPath('characters.0.abilities.0.name', 'Огненный импульс')
            ->assertJsonMissingPath('characters.0.abilities.0.check.dc')->assertJsonMissingPath('characters.0.abilities.0.check.modifier')
            ->assertJsonMissingPath('characters.0.abilities.0.result');
        $this->actingAs($this->other)->getJson($snapshot)->assertJsonCount(0, 'characters')->assertJsonMissingPath('tokens.0.hp');
        $this->roll(16);
        $this->runAbility($this->command())->assertOk();
        Event::assertDispatched(TabletopEvent::class, function ($event) {
            if (! str_ends_with($event->channel, '.user.'.$this->other->id) || ($event->envelope['type'] ?? '') !== 'ability.resolved') {
                return false;
            }
            $payload = $event->envelope['payload'];

            return ! isset($payload['token']['hp']) && $payload['scene']['characters'] === [] && isset($payload['gameplayFeedback']);
        });
    }

    public function test_gm_authoring_validates_resource_and_ability_references(): void
    {
        $url = '/api/campaigns/'.$this->campaign->id.'/characters';
        $body = ['id' => $this->hero->id, 'name' => 'Керн', 'resources' => [$this->resource()], 'abilities' => [$this->ability]];
        $this->actingAs($this->gm)->postJson($url, $body)->assertOk();
        $body['resources'][0]['current'] = 11;
        $this->postJson($url, $body)->assertUnprocessable();
        $body['resources'][0]['current'] = 6;
        $body['abilities'][0]['damage'] = '1000d999';
        $this->postJson($url, $body)->assertUnprocessable();
        $body['abilities'][0]['damage'] = '1d8+3';
        $body['abilities'][0]['costs'][] = ['key' => 'mana', 'amount' => 1];
        $this->postJson($url, $body)->assertUnprocessable();
        $body['abilities'][0]['costs'] = [];
        $body['abilities'][0]['result'] = ['type' => 'handout', 'target' => 999999, 'amount' => 0];
        $this->postJson($url, $body)->assertUnprocessable();
    }

    public function test_linked_ac_and_speed_use_character_while_standalone_vitals_stay_local(): void
    {
        $second = $this->campaign->scenes()->create(['name' => 'Second']);
        $token = $second->tokens()->create(['character_id' => $this->hero->id, 'name' => 'Kern', 'ac' => 1, 'speed' => 2, 'x' => 0, 'y' => 0]);
        $this->actingAs($this->gm)->patchJson('/api/tokens/'.$this->actor->id, ['ac' => 19, 'speed' => 40])->assertOk();
        $this->assertSame(19, $token->fresh()->ac);
        $this->assertSame(40, $token->fresh()->speed);
        $this->assertEquals(17, $this->enemy->fresh()->ac);
    }

    public function test_prop_and_world_point_targets_are_visible_and_bounded(): void
    {
        $ability = $this->ability;
        $ability['category'] = 'utility';
        $ability['target'] = 'point';
        $ability['check'] = null;
        $ability['damage'] = null;
        $this->hero->update(['abilities' => [$ability]]);
        $command = $this->command();
        $command['target'] = ['kind' => 'point', 'x' => 100, 'y' => 100];
        $this->runAbility($command)->assertOk();
        $command['clientMutationId'] = (string) Str::uuid();
        $command['target']['x'] = -1;
        $this->runAbility($command)->assertUnprocessable();
        $command['target']['x'] = 999999;
        $this->runAbility($command)->assertUnprocessable();
        $asset = Asset::create(['campaign_id' => $this->campaign->id, 'uploaded_by' => $this->gm->id, 'kind' => 'prop', 'name' => 'Door', 'original_name' => 'door.png', 'storage_path' => 'door.png', 'mime_type' => 'image/png', 'file_size' => 10, 'width' => 100, 'height' => 100]);
        $prop = SceneProp::create(['scene_id' => $this->scene->id, 'asset_id' => $asset->id, 'x' => 100, 'y' => 100, 'is_hidden' => true]);
        $ability['target'] = 'prop';
        $this->hero->update(['abilities' => [$ability]]);
        $command['target'] = ['kind' => 'prop', 'id' => $prop->id];
        $this->runAbility($command)->assertForbidden();
        $prop->update(['is_hidden' => false]);
        $this->runAbility($command)->assertOk();
    }

    public function test_result_failure_is_atomic_and_cue_retry_does_not_enqueue_twice(): void
    {
        Queue::fake();
        $cue = Cue::create(['scene_id' => $this->scene->id, 'name' => 'Signal']);
        $cue->steps()->create(['position' => 0, 'type' => 'message', 'config' => ['text' => 'Ready', 'duration' => 1000]]);
        $ability = $this->ability;
        $ability['category'] = 'utility';
        $ability['target'] = 'none';
        $ability['check'] = null;
        $ability['damage'] = null;
        $ability['result'] = ['type' => 'cue', 'target' => $cue->id, 'amount' => 0];
        $this->hero->update(['abilities' => [$ability]]);
        $command = $this->command();
        $command['target'] = null;
        $this->runAbility($command)->assertOk();
        $this->runAbility($command)->assertOk();
        DB::table('scene_mutation_receipts')->delete();
        $this->runAbility($command)->assertOk();
        $this->assertDatabaseCount('cue_runs', 1);
        $this->assertSame(4, $this->hero->fresh()->resources[0]['current']);
        $cue->delete();
        $command['clientMutationId'] = (string) Str::uuid();
        $this->runAbility($command)->assertNotFound();
        $this->assertSame(4, $this->hero->fresh()->resources[0]['current']);
        $this->assertDatabaseCount('ability_executions', 1);
    }

    public function test_handout_result_is_selective_and_private_target_never_leaks(): void
    {
        $asset = Asset::create(['campaign_id' => $this->campaign->id, 'uploaded_by' => $this->gm->id, 'kind' => 'handout', 'name' => 'Letter', 'original_name' => 'letter.png', 'storage_path' => 'secret/letter.png', 'mime_type' => 'image/png', 'file_size' => 10, 'width' => 100, 'height' => 100]);
        $handout = Handout::create(['campaign_id' => $this->campaign->id, 'asset_id' => $asset->id, 'title' => 'Letter', 'created_by' => $this->gm->id]);
        $ability = $this->ability;
        $ability['category'] = 'utility';
        $ability['target'] = 'none';
        $ability['check'] = null;
        $ability['damage'] = null;
        $ability['result'] = ['type' => 'handout', 'target' => $handout->id, 'amount' => 0];
        $this->hero->update(['abilities' => [$ability]]);
        $command = $this->command();
        $command['target'] = null;
        $this->runAbility($command)->assertOk()->assertJsonMissingPath('execution.result');
        $this->assertTrue($handout->reveals()->where('user_id', $this->player->id)->exists());
        $this->assertFalse($handout->reveals()->where('user_id', $this->other->id)->exists());
    }

    public function test_stale_epoch_inactive_character_and_client_forgery_cannot_change_resolution(): void
    {
        $this->roll(1);
        $command = $this->command();
        $command['epoch'] = 999;
        $this->runAbility($command)->assertConflict();
        $command['epoch'] = 0;
        DB::table('campaign_members')->where('campaign_id', $this->campaign->id)->where('user_id', $this->player->id)->update(['active_character_id' => null]);
        $this->runAbility($command)->assertConflict();
        DB::table('campaign_members')->where('campaign_id', $this->campaign->id)->where('user_id', $this->player->id)->update(['active_character_id' => $this->hero->id]);
        $command += ['damage' => '20d20+99', 'modifier' => 999, 'dc' => 0, 'costs' => []];
        $this->runAbility($command)->assertOk()->assertJsonPath('execution.roll.total', 5)->assertJsonPath('execution.success', false)->assertJsonPath('execution.damage', null);
        $this->assertSame(4, $this->hero->fresh()->resources[0]['current']);
        $this->assertEquals(30, $this->enemy->fresh()->hp);
    }

    public function test_durable_accepted_result_can_be_recovered_after_scene_switch_without_new_execution(): void
    {
        $this->roll(16);
        $command = $this->command();
        $result = $this->runAbility($command)->assertOk()->json('execution');
        DB::table('scene_mutation_receipts')->delete();
        $second = $this->campaign->scenes()->create(['name' => 'Next']);
        $this->campaign->forceFill(['active_scene_id' => $second->id, 'live_revision' => 1])->save();
        $this->runAbility($command)->assertOk()->assertJsonPath('execution', $result);
        $this->assertDatabaseCount('ability_executions', 1);
        $this->assertSame(4, $this->hero->fresh()->resources[0]['current']);
        $command['clientMutationId'] = (string) Str::uuid();
        $this->runAbility($command)->assertForbidden();
    }

    public function test_hotbar_is_owned_persistent_sparse_and_scoped_to_player_and_character(): void
    {
        $url = '/api/campaigns/'.$this->campaign->id.'/characters/'.$this->hero->id.'/hotbar';
        $this->actingAs($this->player)->getJson($url)->assertOk()->assertJsonPath('slots.0.sourceId', $this->ability['id'])->assertJsonCount(32, 'slots');
        $slots = array_fill(0, 12, null);
        $slots[5] = $this->ability['id'];
        $this->putJson($url, ['slots' => $slots])->assertOk()->assertJsonPath('slots.0', null)->assertJsonPath('slots.5.sourceId', $this->ability['id']);
        $this->getJson($url)->assertOk()->assertJsonPath('version', 2)->assertJsonPath('slots.5.sourceType', 'ability')->assertJsonPath('slots.5.sourceId', $this->ability['id'])->assertJsonPath('slots.12', null);
        $this->actingAs($this->other)->getJson($url)->assertForbidden();
        $this->putJson($url, ['slots' => $slots])->assertForbidden();
        $this->actingAs($this->gm)->getJson($url)->assertOk()->assertJsonPath('slots.0.sourceId', $this->ability['id']);
        $slots[0] = (string) Str::uuid();
        $this->putJson($url, ['slots' => $slots])->assertUnprocessable();
        $slots[0] = $this->ability['id'];
        $this->putJson($url, ['slots' => $slots])->assertUnprocessable();
    }

    public function test_action_deck_reads_legacy_layout_and_validates_typed_cross_page_bindings(): void
    {
        $url = '/api/campaigns/'.$this->campaign->id.'/characters/'.$this->hero->id.'/hotbar';
        $legacy = array_fill(0, 12, null);
        $legacy[11] = $this->ability['id'];
        DB::table('character_hotbars')->insert(['user_id' => $this->player->id, 'character_id' => $this->hero->id, 'slots' => json_encode($legacy), 'created_at' => now(), 'updated_at' => now()]);
        $this->actingAs($this->player)->getJson($url)->assertOk()->assertJsonPath('slots.11.sourceId', $this->ability['id'])->assertJsonPath('slots.0', null)->assertJsonCount(32, 'slots');
        $slots = array_fill(0, 32, null);
        $slots[31] = ['sourceType' => 'ability', 'sourceId' => $this->ability['id']];
        $this->putJson($url, ['version' => 2, 'slots' => $slots])->assertOk()->assertJsonPath('slots', $slots);
        $this->getJson($url)->assertOk()->assertJsonPath('slots', $slots);
        $this->putJson($url, ['slots' => array_fill(0, 12, null)])->assertOk()->assertJsonPath('slots.31.sourceId', $this->ability['id']);
        $this->actingAs($this->other)->putJson($url, ['version' => 2, 'slots' => $slots])->assertForbidden();
        $this->actingAs($this->player);
        $slots[0] = $slots[31];
        $this->putJson($url, ['version' => 2, 'slots' => $slots])->assertUnprocessable();
        $slots[0] = null;
        foreach ([['sourceType' => 'item', 'sourceId' => $this->ability['id']], ['sourceType' => 'ability', 'sourceId' => (string) Str::uuid()], ['sourceType' => 'ability'], ['sourceId' => $this->ability['id']]] as $invalid) {
            $slots[31] = $invalid;
            $this->putJson($url, ['version' => 2, 'slots' => $slots])->assertUnprocessable();
        }
        $this->getJson($url)->assertOk()->assertJsonPath('slots.31.sourceId', $this->ability['id']);
        $ability = $this->ability;
        $ability['enabled'] = false;
        $this->hero->update(['abilities' => [$ability]]);
        $this->getJson($url)->assertOk()->assertJsonPath('slots.31', null);
    }

    public function test_scene_range_is_authoritative_and_rejected_attacks_never_spend_or_roll(): void
    {
        $this->scene->update(['grid_size' => 60, 'distance_per_cell' => 5]);
        $a = $this->ability;
        $a['range'] = ['normal' => 5, 'long' => null];
        $this->hero->update(['abilities' => [$a]]);
        $this->runAbility($this->command())->assertUnprocessable();
        $this->assertSame(6, $this->hero->fresh()->resources[0]['current']);
        $this->assertDatabaseCount('ability_executions', 0);
        $a['range'] = ['normal' => 10, 'long' => 30];
        $this->hero->update(['abilities' => [$a]]);
        $this->roll(16);
        $this->runAbility($this->command() + ['range' => 99999])->assertOk();
        $this->enemy->update(['is_hidden' => true]);
        $this->runAbility($this->command())->assertForbidden();
    }

    public function test_area_derives_visible_victims_and_one_cost_damage_roll_survives_retry(): void
    {
        $this->scene->update(['grid_size' => 60, 'distance_per_cell' => 5]);
        $a = $this->ability;
        $a['category'] = 'effect';
        $a['target'] = 'point';
        $a['check'] = null;
        $a['range'] = ['normal' => 60, 'long' => null];
        $a['area'] = ['shape' => 'circle', 'size' => 20, 'width' => 20];
        $this->hero->update(['abilities' => [$a]]);
        $inside = $this->scene->tokens()->create(['name' => 'Inside', 'x' => 580, 'y' => 200, 'hp' => 30, 'max_hp' => 30]);
        $hidden = $this->scene->tokens()->create(['name' => 'Secret', 'x' => 450, 'y' => 200, 'hp' => 30, 'max_hp' => 30, 'is_hidden' => true]);
        $outside = $this->scene->tokens()->create(['name' => 'Outside', 'x' => 800, 'y' => 200, 'hp' => 30, 'max_hp' => 30]);
        $command = $this->command();
        $command['target'] = ['kind' => 'point', 'x' => 400, 'y' => 200];
        $result = $this->runAbility($command)->assertOk()->assertJsonCount(2, 'execution.outcomes')->json('execution');
        $this->assertEquals(30 - $result['damage']['total'], $inside->fresh()->hp);
        $this->assertEquals(30, $hidden->fresh()->hp);
        $this->assertEquals(30, $outside->fresh()->hp);
        DB::table('scene_mutation_receipts')->delete();
        $this->runAbility($command)->assertOk()->assertJsonPath('execution', $result);
        $this->assertSame(4, $this->hero->fresh()->resources[0]['current']);
        $this->assertEquals(30 - $result['damage']['total'], $inside->fresh()->hp);
        $command['clientMutationId'] = (string) Str::uuid();
        $command['target']['x'] = 1000;
        $a['range']['normal'] = 5;
        $this->hero->update(['abilities' => [$a]]);
        $this->runAbility($command)->assertUnprocessable();
        $this->assertSame(4, $this->hero->fresh()->resources[0]['current']);
    }

    public function test_cone_line_rectangle_geometry_and_authoring_are_bounded(): void
    {
        $geometry = app(AbilityGeometry::class);
        $origin = ['x' => 0, 'y' => 0];
        $aim = ['x' => 15, 'y' => 0];
        foreach (['cone', 'line', 'rectangle'] as $shape) {
            $a = ['shape' => $shape, 'size' => 15, 'width' => 5];
            $this->assertTrue($geometry->contains($a, $origin, $aim, ['x' => 10, 'y' => 1], 1));
            $this->assertFalse($geometry->contains($a, $origin, $aim, ['x' => 10, 'y' => 10], 1));
        }
        $url = '/api/campaigns/'.$this->campaign->id.'/characters';
        $a = $this->ability;
        $a['range'] = ['normal' => 60, 'long' => 30];
        $this->actingAs($this->gm)->postJson($url, ['id' => $this->hero->id, 'name' => 'Керн', 'abilities' => [$a]])->assertUnprocessable();
        $a['range'] = ['normal' => 15, 'long' => null];
        $a['area'] = ['shape' => 'cone', 'size' => 15, 'width' => 5];
        $this->postJson($url, ['id' => $this->hero->id, 'name' => 'Керн', 'abilities' => [$a]])->assertUnprocessable();
        $a['category'] = 'effect';
        $a['target'] = 'point';
        $a['check'] = null;
        $this->postJson($url, ['id' => $this->hero->id, 'name' => 'Керн', 'abilities' => [$a]])->assertOk();
        $command = $this->command();
        $command['target'] = ['kind' => 'point', 'x' => $this->actor->x, 'y' => $this->actor->y];
        $this->runAbility($command)->assertUnprocessable();
    }
}
