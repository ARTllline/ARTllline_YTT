<?php

namespace Tests\Feature;

use App\Actions\CueRunner;
use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Cue;
use App\Models\CueRun;
use App\Models\Handout;
use App\Models\ObjectCheck;
use App\Models\SceneProp;
use App\Models\User;
use App\Services\D20Roller;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

class ObjectCheckTest extends TestCase
{
    use DatabaseMigrations;

    private $gm;

    private $player;

    private $other;

    private $scene;

    private $prop;

    private $cue;

    private $handout;

    private $token;

    private array $action;

    private string $base;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        Queue::fake();
        [$this->gm, $this->player, $this->other] = User::factory()->count(3)->create()->all();
        $campaign = Campaign::create(['name' => 'Checks']);
        foreach ([[$this->gm, 'gm'], [$this->player, 'player'], [$this->other, 'player']] as [$user, $role]) {
            $campaign->members()->attach($user, ['role' => $role]);
        }
        $this->scene = $campaign->scenes()->create(['name' => 'Study']);
        $campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->token = $this->scene->tokens()->create(['name' => 'Investigator', 'x' => 10, 'y' => 10, 'owner_user_id' => $this->player->id]);
        $asset = Asset::create(['campaign_id' => $campaign->id, 'uploaded_by' => $this->gm->id, 'kind' => 'handout', 'name' => 'Letter', 'original_name' => 'letter.png', 'storage_path' => 'secret/letter.png', 'mime_type' => 'image/png', 'file_size' => 10, 'width' => 100, 'height' => 100]);
        $this->prop = SceneProp::create(['scene_id' => $this->scene->id, 'asset_id' => $asset->id, 'name' => 'Desk', 'x' => 400, 'y' => 400]);
        $this->cue = Cue::create(['scene_id' => $this->scene->id, 'name' => 'SECRET CACHE']);
        $this->cue->steps()->create(['position' => 0, 'type' => 'message', 'config' => ['text' => 'Found it!', 'duration' => 1000]]);
        $this->handout = Handout::create(['campaign_id' => $campaign->id, 'asset_id' => $asset->id, 'title' => 'SECRET LETTER', 'created_by' => $this->gm->id]);
        $this->action = ['id' => (string) Str::uuid(), 'label' => 'Осмотреть', 'icon' => 'search', 'enabled' => true,
            'result_type' => 'nothing', 'check' => ['enabled' => true, 'label' => 'Внимательность', 'ability_key' => 'perception',
                'dc' => 15, 'modifier' => 3, 'retry' => 'once_per_player',
                'success' => ['result_type' => 'cue', 'result_target' => (string) $this->cue->id],
                'failure' => ['result_type' => 'nothing']]];
        $this->base = '/api/scenes/'.$this->scene->id;
        $this->save();
    }

    private function save(): void
    {
        $this->actingAs($this->gm)->postJson($this->base.'/object-actions', ['kind' => 'prop', 'id' => $this->prop->id,
            'actions' => [$this->action], 'clientMutationId' => (string) Str::uuid()])->assertOk();
    }

    private function command(): array
    {
        return ['kind' => 'prop', 'id' => $this->prop->id, 'actionId' => $this->action['id'], 'epoch' => 0, 'clientMutationId' => (string) Str::uuid()];
    }

    private function roll(int $value, int $times = 1): void
    {
        $this->mock(D20Roller::class)->shouldReceive('roll')->times($times)->andReturn($value);
    }

    public function test_server_roll_is_recorded_and_starts_existing_cue_executor_once(): void
    {
        $this->roll(14);
        $data = $this->command();
        $response = $this->actingAs($this->player)->postJson($this->base.'/interact', $data)->assertOk()
            ->assertJsonPath('check.natural', 14)->assertJsonPath('check.total', 17)->assertJsonPath('check.success', true)
            ->assertJsonPath('check.tokenId', (string) $this->token->id)->assertJsonMissingPath('check.dc');
        $this->assertSame($this->player->id, ObjectCheck::sole()->user_id);
        $this->assertSame(15, ObjectCheck::sole()->dc);
        $this->assertNotNull(ObjectCheck::sole()->created_at);
        $this->assertEquals($this->gm->id, CueRun::sole()->created_by);
        $this->postJson($this->base.'/interact', $data)->assertOk()->assertExactJson($response->json())->assertHeader('Idempotent-Replay', 'true');
        // Reconnect/resubmit with a new UUID is still once per player.
        $this->postJson($this->base.'/interact', $this->command())->assertOk()->assertJsonPath('check.id', $response->json('check.id'));
        $this->assertDatabaseCount('object_checks', 1);
        $this->assertDatabaseCount('cue_runs', 1);
        $run = CueRun::sole();
        app(CueRunner::class)->advance($this->scene->campaign_id, $run->id, 0);
        app(CueRunner::class)->advance($this->scene->campaign_id, $run->id, 0);
        $this->assertSame('completed', $run->steps()->first()->status);
    }

    public function test_failed_check_uses_selective_handout_and_never_starts_success_cue(): void
    {
        $this->action['check']['failure'] = ['result_type' => 'handout', 'result_target' => (string) $this->handout->id];
        $this->save();
        $this->roll(7);
        $this->actingAs($this->player)->postJson($this->base.'/interact', $this->command())->assertOk()->assertJsonPath('check.total', 10)->assertJsonPath('check.success', false);
        $this->assertDatabaseCount('cue_runs', 0);
        $this->assertDatabaseHas('handout_reveals', ['user_id' => $this->player->id, 'handout_id' => $this->handout->id]);
        $this->assertDatabaseCount('handout_reveals', 1);
        $this->actingAs($this->other)->getJson('/api/campaigns/'.$this->scene->campaign_id.'/handouts/'.$this->handout->id)->assertForbidden();
    }

    public function test_failure_can_run_cue_and_success_can_show_handout(): void
    {
        $this->action['check']['dc'] = 100;
        $this->action['check']['failure'] = $this->action['check']['success'];
        $this->action['check']['success'] = ['result_type' => 'handout', 'result_target' => (string) $this->handout->id];
        $this->save();
        $this->roll(20, 2);
        $this->actingAs($this->player)->postJson($this->base.'/interact', $this->command())->assertOk()->assertJsonPath('check.success', false);
        $this->assertDatabaseCount('cue_runs', 1);
        $this->action['check']['dc'] = 1;
        $this->save();
        $this->actingAs($this->other)->postJson($this->base.'/interact', $this->command())->assertOk()->assertJsonPath('check.success', true);
        $this->assertDatabaseHas('handout_reveals', ['user_id' => $this->other->id]);
    }

    public function test_once_per_player_is_independent_and_repeatable_requires_new_uuid(): void
    {
        $this->roll(1, 4);
        foreach ([$this->player, $this->other] as $user) {
            $this->actingAs($user)->postJson($this->base.'/interact', $this->command())->assertOk()->assertJsonPath('check.success', false);
        }
        $this->assertDatabaseCount('object_checks', 2);
        $this->action['check']['retry'] = 'repeatable';
        $this->save();
        $data = $this->command();
        $first = $this->actingAs($this->player)->postJson($this->base.'/interact', $data)->assertOk()->json('check.id');
        $this->postJson($this->base.'/interact', $data)->assertOk()->assertJsonPath('check.id', $first);
        $next = $this->postJson($this->base.'/interact', $this->command())->assertOk()->json('check.id');
        $this->assertNotSame($first, $next);
    }

    public function test_once_is_shared_but_does_not_disclose_the_first_players_roll(): void
    {
        $this->action['check']['retry'] = 'once';
        $this->save();
        $this->roll(7);
        $this->actingAs($this->player)->postJson($this->base.'/interact', $this->command())->assertOk();
        $this->actingAs($this->other)->postJson($this->base.'/interact', $this->command())->assertConflict()->assertJsonMissingPath('check');
    }

    public function test_secret_configuration_is_absent_from_snapshot_http_and_realtime_and_history_is_gm_only(): void
    {
        $this->roll(7);
        $safe = ['id' => $this->action['id'], 'label' => 'Осмотреть', 'icon' => 'search', 'check' => ['enabled' => true, 'label' => 'Внимательность']];
        $this->actingAs($this->player)->getJson($this->base.'/snapshot')->assertOk()->assertJsonPath('props.0.interactions.0', $safe);
        $response = $this->postJson($this->base.'/interact', $this->command())->assertOk();
        foreach (['dc', 'branch', 'success.result_target', 'failure', 'ability_key', 'retry'] as $key) {
            $response->assertJsonMissingPath('check.'.$key);
        }
        $history = $this->base.'/object-checks?kind=prop&id='.$this->prop->id;
        $this->getJson($history)->assertForbidden();
        $this->actingAs($this->other)->getJson($history)->assertForbidden();
        $this->actingAs($this->gm)->getJson($history)->assertOk()->assertJsonPath('checks.0.dc', 15)->assertJsonPath('checks.0.actor.id', (string) $this->player->id);
        Event::assertDispatched(TabletopEvent::class, fn ($e) => $e->envelope['type'] === 'check.resolved'
            && $e->channel === 'campaign.'.$this->scene->campaign_id.'.scene.'.$this->scene->id.'.gm'
            && $e->additionalChannels === [] && ! isset($e->envelope['check']['dc']) && ! isset($e->envelope['check']['branch']));
        $playerChanges = Event::dispatched(TabletopEvent::class)->filter(fn ($args) => str_contains($args[0]->channel, '.user.'));
        foreach ($playerChanges as [$event]) {
            $json = json_encode($event->envelope);
            $this->assertStringNotContainsString('"modifier"', $json);
            $this->assertStringNotContainsString('"dc"', $json);
            $this->assertStringNotContainsString('result_target', $json);
        }
    }

    public function test_visible_dc_and_natural_one_have_no_automatic_critical_rules(): void
    {
        $this->action['check']['dc_visible'] = true;
        $this->action['check']['dc'] = 1;
        $this->action['check']['success'] = ['result_type' => 'nothing'];
        $this->save();
        $this->roll(1);
        $this->actingAs($this->player)->getJson($this->base.'/snapshot')->assertJsonPath('props.0.interactions.0.check.dc', 1);
        $this->postJson($this->base.'/interact', $this->command())->assertOk()->assertJsonPath('check.natural', 1)->assertJsonPath('check.success', true)->assertJsonPath('check.dc', 1);
    }

    public function test_forged_config_is_rejected_and_hidden_object_and_foreign_actor_token_are_inaccessible(): void
    {
        $this->mock(D20Roller::class)->shouldNotReceive('roll');
        foreach (['dc' => 1, 'modifier' => 99, 'result_target' => 99, 'check' => ['dc' => 1], 'success' => ['result_type' => 'cue']] as $key => $value) {
            $this->actingAs($this->player)->postJson($this->base.'/interact', $this->command() + [$key => $value])->assertUnprocessable();
        }
        $foreignToken = $this->scene->tokens()->create(['name' => 'Other', 'x' => 10, 'y' => 10, 'owner_user_id' => $this->other->id]);
        $this->postJson($this->base.'/interact', $this->command() + ['actorTokenId' => $foreignToken->id])->assertForbidden();
        $this->prop->update(['is_hidden' => true]);
        $this->postJson($this->base.'/interact', $this->command())->assertForbidden();
        $this->assertDatabaseCount('object_checks', 0);
    }

    public function test_cross_campaign_objects_targets_and_membership_are_checked(): void
    {
        $foreign = Campaign::create(['name' => 'Elsewhere']);
        $foreign->members()->attach($this->gm, ['role' => 'gm']);
        $scene = $foreign->scenes()->create(['name' => 'Foreign']);
        $cue = Cue::create(['scene_id' => $scene->id, 'name' => 'Foreign cue']);
        $this->action['check']['success']['result_target'] = (string) $cue->id;
        $this->actingAs($this->gm)->postJson($this->base.'/object-actions', ['kind' => 'prop', 'id' => $this->prop->id, 'actions' => [$this->action], 'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
        $outsider = User::factory()->create();
        $this->actingAs($outsider)->postJson($this->base.'/interact', $this->command())->assertForbidden();
        $data = $this->command();
        $this->actingAs($this->player)->postJson('/api/scenes/'.$scene->id.'/interact', $data)->assertForbidden();
        $this->assertDatabaseCount('object_checks', 0);
    }

    public function test_roll_identity_outlives_transport_receipt_and_rejects_changed_uuid_payload(): void
    {
        $this->action['check']['retry'] = 'repeatable';
        $this->save();
        $this->roll(7);
        $data = $this->command();
        $first = $this->actingAs($this->player)->postJson($this->base.'/interact', $data)->assertOk()->json('check');
        DB::table('scene_mutation_receipts')->where('client_mutation_id', $data['clientMutationId'])->delete();
        $this->postJson($this->base.'/interact', $data)->assertOk()->assertJsonPath('check', $first);
        $data['id'] = $this->prop->id + 1;
        $this->postJson($this->base.'/interact', $data)->assertConflict();
    }

    private function useTokenStats(): void
    {
        unset($this->action['check']['modifier'], $this->action['check']['ability_key']);
        $this->action['check']['stat_key'] = 'perception';
        $this->action['check']['retry'] = 'repeatable';
        $this->action['check']['success'] = ['result_type' => 'nothing'];
        $this->save();
        $this->token->update(['check_stats' => [['key' => 'perception', 'label' => 'Внимательность', 'modifier' => 3]]]);
    }

    public function test_check_resolves_each_actor_stats_and_snapshots_immutable_provenance(): void
    {
        $this->useTokenStats();
        $second = $this->scene->tokens()->create(['name' => 'Mage', 'x' => 0, 'y' => 0, 'owner_user_id' => $this->player->id,
            'is_locked' => true, 'check_stats' => [['key' => 'perception', 'label' => 'Внимательность мага', 'modifier' => 7]]]);
        $this->roll(10, 2);
        $command = $this->command() + ['actorTokenId' => $this->token->id];
        $first = $this->actingAs($this->player)->postJson($this->base.'/interact', $command)->assertOk()
            ->assertJsonPath('check.total', 13)->assertJsonPath('check.modifier', 3)
            ->assertJsonPath('check.provenance.source', 'token_stat')->assertJsonPath('check.provenance.statKey', 'perception')
            ->assertJsonPath('check.provenance.baseModifier', 3)->assertJsonPath('check.provenance.otherModifiers', [])
            ->assertJsonPath('check.provenance.finalModifier', 3)->assertJsonMissingPath('check.dc');
        $this->postJson($this->base.'/interact', $this->command() + ['actorTokenId' => $second->id])->assertOk()
            ->assertJsonPath('check.total', 17)->assertJsonPath('check.provenance.tokenName', 'Mage');
        $this->token->update(['name' => 'Renamed', 'check_stats' => []]);
        $this->postJson($this->base.'/interact', $command)->assertOk()->assertExactJson($first->json());
        DB::table('scene_mutation_receipts')->where('client_mutation_id', $command['clientMutationId'])->delete();
        $this->postJson($this->base.'/interact', $command)->assertOk()->assertJsonPath('check', $first->json('check'));
        DB::table('scene_mutation_receipts')->where('client_mutation_id', $command['clientMutationId'])->delete();
        $command['actorTokenId'] = $second->id;
        $this->postJson($this->base.'/interact', $command)->assertConflict();
    }

    public function test_advantage_and_disadvantage_store_both_dice_and_replay_identically(): void
    {
        $this->useTokenStats();
        $this->mock(D20Roller::class)->shouldReceive('roll')->times(4)->andReturn(4, 18, 16, 2);
        foreach ([['advantage', [4, 18], 18, 21, 1], ['disadvantage', [16, 2], 2, 5, 1]] as [$mode, $dice, $natural, $total, $selected]) {
            $command = $this->command() + ['actorTokenId' => $this->token->id, 'rollMode' => $mode];
            $first = $this->actingAs($this->player)->postJson($this->base.'/interact', $command)->assertOk()
                ->assertJsonPath('check.rollMode', $mode)->assertJsonPath('check.rawDice', $dice)
                ->assertJsonPath('check.selectedDie', $selected)->assertJsonPath('check.natural', $natural)->assertJsonPath('check.total', $total);
            $this->postJson($this->base.'/interact', $command)->assertOk()->assertExactJson($first->json());
            $record = ObjectCheck::findOrFail($first->json('check.id'));
            $this->assertSame($dice, $record->raw_dice);
            $this->assertSame($mode, $record->roll_mode);
            $command['rollMode'] = 'normal';
            $this->postJson($this->base.'/interact', $command)->assertConflict();
        }
    }

    public function test_actor_is_required_for_new_checks_and_forged_hidden_or_cross_scene_actors_cannot_roll(): void
    {
        $this->useTokenStats();
        $this->mock(D20Roller::class)->shouldNotReceive('roll');
        $this->actingAs($this->player)->postJson($this->base.'/interact', $this->command())->assertUnprocessable();
        $this->token->update(['owner_user_id' => $this->other->id]);
        $this->postJson($this->base.'/interact', $this->command() + ['actorTokenId' => $this->token->id])->assertForbidden();
        $this->token->update(['owner_user_id' => $this->player->id, 'is_hidden' => true]);
        $this->postJson($this->base.'/interact', $this->command() + ['actorTokenId' => $this->token->id])->assertForbidden();
        $this->token->update(['is_hidden' => false, 'check_stats' => []]);
        $this->postJson($this->base.'/interact', $this->command() + ['actorTokenId' => $this->token->id])->assertUnprocessable();
        $scene = $this->scene->campaign->scenes()->create(['name' => 'Other scene']);
        $foreign = $scene->tokens()->create(['name' => 'Foreign', 'x' => 0, 'y' => 0, 'owner_user_id' => $this->player->id]);
        $this->postJson($this->base.'/interact', $this->command() + ['actorTokenId' => $foreign->id])->assertNotFound();
        $this->postJson($this->base.'/interact', $this->command() + ['actorTokenId' => $this->token->id, 'rollMode' => 'critical'])->assertUnprocessable();
        $this->assertDatabaseCount('object_checks', 0);
    }

    public function test_replaying_receipt_revalidates_actor_ownership_before_returning_saved_roll(): void
    {
        $this->useTokenStats();
        $this->roll(8);
        $command = $this->command() + ['actorTokenId' => $this->token->id];
        $this->actingAs($this->player)->postJson($this->base.'/interact', $command)->assertOk();
        $this->token->update(['owner_user_id' => $this->other->id]);
        $this->postJson($this->base.'/interact', $command)->assertForbidden();
        $this->assertDatabaseCount('object_checks', 1);
    }

    public function test_only_gm_edits_stats_and_only_controller_receives_them_in_snapshots_and_events(): void
    {
        $stats = [['key' => 'perception', 'label' => 'Внимательность', 'modifier' => 3], ['key' => 'magic', 'label' => 'Магия', 'modifier' => -2]];
        $url = '/api/tokens/'.$this->token->id;
        $this->actingAs($this->player)->patchJson($url, ['check_stats' => $stats])->assertForbidden();
        $this->actingAs($this->gm)->patchJson($url, ['check_stats' => $stats])->assertOk()->assertJsonPath('token.checkStats', $stats);
        $this->token->refresh();
        $this->assertSame($stats, $this->token->check_stats);
        $this->actingAs($this->player)->getJson($this->base.'/snapshot')->assertJsonPath('tokens.0.checkStats', $stats);
        $this->actingAs($this->other)->getJson($this->base.'/snapshot')->assertJsonMissingPath('tokens.0.checkStats');
        foreach ([[$stats[0], $stats[0]], [['key' => 'invalid key', 'label' => 'Сила', 'modifier' => 3]], [['key' => 'test', 'label' => 'Сила', 'modifier' => 101]]] as $invalid) {
            $this->actingAs($this->gm)->patchJson($url, ['check_stats' => $invalid])->assertUnprocessable();
        }
        Event::assertDispatched(TabletopEvent::class, fn ($e) => str_ends_with($e->channel, '.user.'.$this->player->id) && ($e->envelope['token']['checkStats'] ?? null) === $stats);
        Event::assertNotDispatched(TabletopEvent::class, fn ($e) => str_ends_with($e->channel, '.user.'.$this->other->id) && isset($e->envelope['token']['checkStats']));
    }

    public function test_new_config_ignores_stored_fixed_modifier_and_projects_only_public_stat_key(): void
    {
        $this->useTokenStats();
        $this->action['check']['modifier'] = 99;
        $this->save();
        $this->assertArrayNotHasKey('modifier', $this->prop->refresh()->interactions[0]['check']);
        $this->roll(5);
        $this->actingAs($this->player)->getJson($this->base.'/snapshot')
            ->assertJsonPath('props.0.interactions.0.check.stat_key', 'perception')
            ->assertJsonMissingPath('props.0.interactions.0.check.dc')->assertJsonMissingPath('props.0.interactions.0.check.modifier');
        $this->postJson($this->base.'/interact', $this->command() + ['actorTokenId' => $this->token->id])->assertOk()->assertJsonPath('check.total', 8);
    }

    public function test_random_source_returns_only_d20_values(): void
    {
        $roller = new D20Roller;
        for ($i = 0; $i < 50; $i++) {
            $this->assertContains($roller->roll(), range(1, 20));
        }
    }
}
