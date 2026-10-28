<?php

namespace Tests\Feature;

use App\Actions\CueRunner;
use App\Actions\SceneActions;
use App\Events\TabletopEvent;
use App\Jobs\ExecuteCueStep;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Combat;
use App\Models\Cue;
use App\Models\CueRun;
use App\Models\SceneProp;
use App\Models\SceneRegion;
use App\Models\SceneTrigger;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Services\RegionGeometry;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

class TriggerTest extends TestCase
{
    use DatabaseMigrations;

    private $gm;

    private $player;

    private $campaign;

    private $scene;

    private $token;

    private $region;

    private $cue;

    private string $base;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        Queue::fake();
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Trigger QA']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Stage']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->token = $this->scene->tokens()->create(['name' => 'Hero', 'owner_user_id' => $this->player->id, 'x' => 0, 'y' => 200, 'size' => 40, 'scale' => 1]);
        $this->region = SceneRegion::create(['scene_id' => $this->scene->id, 'name' => 'SECRET GRAVEYARD', 'shape' => 'rectangle', 'geometry' => ['x' => 100, 'y' => 100, 'width' => 200, 'height' => 200], 'enabled' => true]);
        $this->cue = Cue::create(['scene_id' => $this->scene->id, 'name' => 'SECRET GHOST']);
        $this->cue->steps()->create(['position' => 0, 'type' => 'objects.hide', 'config' => ['tokenIds' => [$this->token->id], 'propIds' => []]]);
        $this->base = '/api/scenes/'.$this->scene->id;
        $this->actingAs($this->gm);
    }

    private function trigger(array $extra = []): SceneTrigger
    {
        return SceneTrigger::create($extra + ['scene_id' => $this->scene->id, 'name' => 'SECRET RULE', 'event_type' => 'region.enter', 'region_id' => $this->region->id,
            'cue_id' => $this->cue->id, 'created_by' => $this->gm->id, 'enabled' => true, 'once' => true, 'cooldown_ms' => 0, 'actor_filter' => 'player']);
    }

    private function move(float $x, float $y = 200, ?string $id = null): void
    {
        $this->postJson('/api/tokens/'.$this->token->id.'/move', ['x' => $x, 'y' => $y, 'clientMutationId' => $id ?? (string) Str::uuid()])->assertOk();
    }

    private function finish(CueRun $run): void
    {
        for ($i = 0; $i < 10 && in_array($run->fresh()->status, ['queued', 'running']); $i++) {
            $this->travel(1)->seconds();
            app(CueRunner::class)->advance($this->campaign->id, $run->id, $run->fresh()->position);
        }
    }

    public function test_footprint_geometry_touching_rectangle_corner_and_circle(): void
    {
        $t = clone $this->token;
        foreach ([[79, 200, false], [80, 200, true], [85, 85, false], [86, 86, true], [320, 200, true], [321, 200, false]] as [$x, $y, $inside]) {
            $t->x = $x;
            $t->y = $y;
            $this->assertSame($inside, RegionGeometry::contains($this->region, $t));
        }
        $this->region->shape = 'circle';
        $this->region->geometry = ['x' => 200, 'y' => 200, 'radius' => 50];
        $t->x = 270;
        $t->y = 200;
        $this->assertTrue(RegionGeometry::contains($this->region, $t));
        $t->x = 270.01;
        $this->assertFalse(RegionGeometry::contains($this->region, $t));
    }

    public function test_authoritative_enter_exit_inside_preview_retry_and_cue_execution(): void
    {
        $enter = $this->trigger();
        $exit = $this->trigger(['event_type' => 'region.exit']);
        $this->actingAs($this->player);
        $this->postJson('/api/tokens/'.$this->token->id.'/preview', ['x' => 200, 'y' => 200, 'baseRevision' => 0, 'dragSessionId' => (string) Str::uuid(), 'sequence' => 1])->assertOk();
        $this->assertDatabaseCount('cue_runs', 0);
        $id = (string) Str::uuid();
        $this->move(80, 200, $id);
        $this->move(80, 200, $id);
        $this->assertDatabaseCount('cue_runs', 1);
        $this->move(200);
        $this->assertDatabaseCount('cue_runs', 1);
        $this->getJson($this->base.'/snapshot')->assertOk();
        $this->assertDatabaseCount('cue_runs', 1);
        $this->move(321);
        $this->assertDatabaseCount('cue_runs', 2);
        $this->assertSame(1, $enter->fresh()->fire_count);
        $this->assertSame(1, $exit->fresh()->fire_count);
        $run = CueRun::orderBy('queue_order')->first();
        Queue::assertPushed(ExecuteCueStep::class);
        $this->finish($run);
        $this->assertTrue($this->token->fresh()->is_hidden);
        $this->assertSame('completed', $run->fresh()->status);
    }

    public function test_actor_filter_disabled_region_and_trigger_cooldown_and_once(): void
    {
        $t = $this->trigger(['once' => false, 'cooldown_ms' => 5000]);
        $this->region->update(['enabled' => false]);
        $this->move(200);
        $this->assertDatabaseCount('cue_runs', 0);
        $this->region->update(['enabled' => true]);
        $this->move(0);
        $t->update(['enabled' => false]);
        $this->move(200);
        $this->assertDatabaseCount('cue_runs', 0);
        $t->update(['enabled' => true]);
        $this->move(0);
        $this->move(200);
        $this->move(0);
        $this->move(200);
        $this->assertDatabaseCount('cue_runs', 1);
        $this->travel(5001)->milliseconds();
        $this->move(0);
        $this->move(200);
        $this->assertDatabaseCount('cue_runs', 2);
        $t->update(['once' => true]);
        $this->travel(6)->seconds();
        $this->move(0);
        $this->move(200);
        $this->assertDatabaseCount('cue_runs', 2);
        $t->update(['once' => false, 'cooldown_ms' => 0, 'actor_filter' => 'token', 'actor_token_id' => null]);
        $this->move(0);
        $this->move(200);
        $this->assertDatabaseCount('cue_runs', 2);
        $t->update(['actor_token_id' => $this->token->id]);
        $this->move(0);
        $this->move(200);
        $this->assertDatabaseCount('cue_runs', 3);
        $t->update(['actor_filter' => 'player']);
        $this->token->update(['owner_user_id' => $this->gm->id]);
        $this->move(0);
        $this->move(200);
        $this->assertDatabaseCount('cue_runs', 3);
        $t->update(['actor_filter' => 'any']);
        $this->move(0);
        $this->move(200);
        $this->assertDatabaseCount('cue_runs', 4);
    }

    public function test_regions_crud_revisions_reference_validation_and_player_metadata_isolation(): void
    {
        $r = ['action' => 'create', 'name' => 'SECRET REGION', 'shape' => 'circle', 'geometry' => ['x' => 1234, 'y' => 4321, 'radius' => 80], 'enabled' => true];
        $new = $this->postJson($this->base.'/regions', $r)->assertOk()->json('region');
        $this->postJson($this->base.'/regions', array_replace($r, ['action' => 'update', 'id' => $new['id'], 'geometry' => ['x' => 200, 'y' => 300, 'radius' => 100]]))->assertOk()->assertJsonPath('revision', 2);
        $d = ['action' => 'save', 'name' => 'SECRET RULE', 'eventType' => 'region.enter', 'cueId' => $this->cue->id, 'regionId' => $new['id'], 'enabled' => true, 'once' => true, 'cooldownMs' => 5000, 'minimumRound' => 1, 'actorFilter' => 'player'];
        $this->postJson($this->base.'/triggers', $d)->assertOk();
        $other = $this->campaign->scenes()->create(['name' => 'Other']);
        $foreign = Cue::create(['scene_id' => $other->id, 'name' => 'Other cue']);
        $this->postJson($this->base.'/triggers', array_replace($d, ['cueId' => $foreign->id]))->assertUnprocessable();
        $this->postJson($this->base.'/regions', array_replace($r, ['geometry' => ['x' => 0, 'y' => 0, 'radius' => -1]]))->assertUnprocessable();
        $this->actingAs($this->player)->getJson($this->base.'/snapshot')->assertJsonMissingPath('regions')->assertJsonMissingPath('triggers');
        $this->getJson($this->base.'/triggers')->assertForbidden();
        $this->getJson($this->base.'/triggers?summary=1')->assertForbidden();
        $this->postJson($this->base.'/triggers', $d)->assertForbidden();
        $this->postJson($this->base.'/regions', $r)->assertForbidden();
        foreach (Event::dispatched(TabletopEvent::class)->pluck(0) as $event) {
            if (str_contains($event->channel, '.user.')) {
                $json = json_encode($event->envelope);
                $this->assertStringNotContainsString('SECRET', $json);
                $this->assertStringNotContainsString('1234', $json);
                $this->assertSame('scene.revision', $event->envelope['type']);
            }
        }
        $this->actingAs($this->gm)->postJson($this->base.'/regions', ['action' => 'delete', 'id' => $new['id']])->assertOk();
        $this->assertNull(SceneTrigger::first()->region_id);
    }

    public function test_interaction_has_identical_safe_response_and_rechecks_hidden_and_epoch_on_retry(): void
    {
        $this->trigger(['event_type' => 'object.interact', 'region_id' => null, 'token_id' => $this->token->id]);
        $data = ['kind' => 'token', 'id' => $this->token->id, 'epoch' => 0, 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($this->player)->postJson($this->base.'/interact', $data)->assertOk()->assertExactJson(['accepted' => true, 'mutationId' => $data['clientMutationId']]);
        $this->postJson($this->base.'/interact', $data)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertDatabaseCount('cue_runs', 1);
        $this->token->update(['is_hidden' => true]);
        $this->postJson($this->base.'/interact', $data)->assertForbidden();
        $this->postJson($this->base.'/interact', array_replace($data, ['clientMutationId' => (string) Str::uuid()]))->assertForbidden();
        $this->token->update(['is_hidden' => false]);
        $this->postJson($this->base.'/interact', array_replace($data, ['epoch' => 1, 'clientMutationId' => (string) Str::uuid()]))->assertConflict();
        $unbound = $this->scene->tokens()->create(['name' => 'Unbound', 'x' => 0, 'y' => 0]);
        $this->postJson($this->base.'/interact', ['kind' => 'token', 'id' => $unbound->id, 'epoch' => 0])->assertOk()->assertJsonPath('accepted', true);
        $this->assertDatabaseCount('cue_runs', 1);
        $this->actingAs(User::factory()->create())->postJson($this->base.'/interact', ['kind' => 'token', 'id' => $unbound->id, 'epoch' => 0])->assertForbidden();
    }

    public function test_scene_activation_only_on_actual_scene_change_and_combat_transitions(): void
    {
        $this->trigger(['event_type' => 'scene.activated', 'region_id' => null, 'once' => false]);
        $this->getJson($this->base.'/snapshot')->assertOk();
        app(SceneActions::class)->activate($this->gm, $this->campaign, $this->scene->id);
        $this->assertDatabaseCount('cue_runs', 0);
        app(SceneActions::class)->activate($this->gm, $this->campaign, null);
        $this->postJson('/api/campaigns/'.$this->campaign->id.'/activate', ['sceneId' => $this->scene->id])->assertOk();
        $this->assertDatabaseCount('cue_runs', 1);
        $start = $this->trigger(['event_type' => 'combat.started', 'region_id' => null]);
        $round = $this->trigger(['event_type' => 'combat.round', 'region_id' => null, 'minimum_round' => 3, 'once' => false]);
        $combat = Combat::create(['scene_id' => $this->scene->id, 'created_by' => $this->gm->id]);
        $entry = $combat->combatants()->create(['token_id' => $this->token->id, 'position' => 0]);
        $id = (string) Str::uuid();
        $begin = ['combatId' => (string) $combat->id, 'clientMutationId' => $id];
        $this->postJson($this->base.'/combat/begin', $begin)->assertOk();
        $this->postJson($this->base.'/combat/begin', $begin)->assertOk();
        $this->assertSame(1, $start->fresh()->fire_count);
        $this->postJson($this->base.'/combat/current', ['combatId' => (string) $combat->id, 'combatantId' => (string) $entry->id])->assertOk();
        $this->assertSame(0, $round->fresh()->fire_count);
        foreach ([1, 2] as $n) {
            $this->postJson($this->base.'/combat/next', ['combatId' => (string) $combat->id, 'expectedRound' => $n, 'expectedCurrentCombatantId' => (string) $entry->id])->assertOk();
        }
        $this->assertSame(1, $round->fresh()->fire_count);
    }

    public function test_queued_runs_preserve_order_and_recursive_chain_fires_each_trigger_once(): void
    {
        $this->cue->steps()->delete();
        $this->cue->steps()->create(['position' => 0, 'type' => 'object.move', 'config' => ['kind' => 'token', 'id' => (string) $this->token->id, 'x' => 0, 'y' => 200]]);
        $enter = $this->trigger(['once' => false]);
        $back = Cue::create(['scene_id' => $this->scene->id, 'name' => 'Return']);
        $back->steps()->create(['position' => 0, 'type' => 'object.move', 'config' => ['kind' => 'token', 'id' => (string) $this->token->id, 'x' => 200, 'y' => 200]]);
        $exit = $this->trigger(['once' => false, 'event_type' => 'region.exit', 'cue_id' => $back->id]);
        $this->move(200);
        $a = CueRun::first();
        app(CueRunner::class)->advance($this->campaign->id, $a->id, 0);
        $b = CueRun::orderByDesc('queue_order')->first();
        $this->assertNotSame($a->id, $b->id);
        app(CueRunner::class)->advance($this->campaign->id, $b->id, 0);
        $this->assertSame(0, $b->fresh()->position);
        $this->finish($a);
        $this->finish($b);
        $this->assertDatabaseCount('cue_runs', 2);
        $this->assertDatabaseCount('trigger_fires', 2);
        $this->assertSame([$enter->id, $exit->id], $b->fresh()->trigger_chain);
        $this->assertSame((float) 200, (float) $this->token->fresh()->x);
        $this->assertSame(1, $enter->fresh()->fire_count);
        $this->assertSame(1, $exit->fresh()->fire_count);
    }

    public function test_visible_locked_prop_interaction_hidden_retry_and_foreign_scene_are_authorized(): void
    {
        $asset = Asset::create(['campaign_id' => $this->campaign->id, 'uploaded_by' => $this->gm->id, 'kind' => 'prop',
            'name' => 'Door', 'original_name' => 'door.png', 'storage_path' => 'unused.png', 'mime_type' => 'image/png', 'file_size' => 100, 'width' => 100, 'height' => 100]);
        $prop = SceneProp::create(['scene_id' => $this->scene->id, 'asset_id' => $asset->id, 'x' => 600, 'y' => 600, 'is_locked' => true]);
        $this->trigger(['event_type' => 'object.interact', 'region_id' => null, 'prop_id' => $prop->id]);
        $data = ['kind' => 'prop', 'id' => $prop->id, 'epoch' => 0, 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($this->player)->postJson($this->base.'/interact', $data)->assertOk();
        $this->assertDatabaseCount('cue_runs', 1);
        $prop->update(['is_hidden' => true]);
        $this->postJson($this->base.'/interact', $data)->assertForbidden();
        $this->getJson($this->base.'/snapshot')->assertJsonCount(0, 'props');
        $other = $this->campaign->scenes()->create(['name' => 'Other']);
        $prop->update(['is_hidden' => false, 'scene_id' => $other->id]);
        $this->postJson($this->base.'/interact', array_replace($data, ['clientMutationId' => (string) Str::uuid()]))->assertNotFound();
        $this->assertDatabaseCount('cue_runs', 1);
    }

    public function test_cooldown_milliseconds_and_deleted_author_permission_do_not_consume_fire(): void
    {
        $this->travelTo(Carbon::parse('2026-10-29 12:00:00.700'));
        $t = $this->trigger(['once' => false, 'cooldown_ms' => 5000]);
        $this->move(200);
        $this->travel(4999)->milliseconds();
        $this->move(0);
        $this->move(200);
        $this->assertSame(1, $t->fresh()->fire_count);
        $this->travel(1)->milliseconds();
        $this->move(0);
        $this->move(200);
        $this->assertSame(2, $t->fresh()->fire_count);
        $this->campaign->members()->updateExistingPivot($this->gm->id, ['role' => 'player']);
        $this->actingAs($this->player);
        $this->travel(6)->seconds();
        $this->move(0);
        $this->move(200);
        $this->assertSame(2, $t->fresh()->fire_count);
    }

    public function test_group_move_once_and_maximum_execution_depth(): void
    {
        $second = $this->scene->tokens()->create(['name' => 'Second', 'owner_user_id' => $this->player->id, 'x' => 0, 'y' => 150]);
        $t = $this->trigger();
        $this->postJson($this->base.'/selection', ['action' => 'move', 'tokenIds' => [$this->token->id, $second->id], 'propIds' => [],
            'anchorKind' => 'token', 'anchorId' => $this->token->id, 'x' => 200, 'y' => 200])->assertOk();
        $this->assertDatabaseCount('cue_runs', 1);
        $t->update(['once' => false]);
        app(CommandContext::class)->triggerChain = range(100, 107);
        $this->move(0);
        $this->move(200);
        $this->assertDatabaseCount('cue_runs', 1);
    }

    public function test_cancelling_a_waiting_run_does_not_clear_the_active_presentation(): void
    {
        $runner = app(CueRunner::class);
        $first = $runner->start($this->gm, $this->scene, $this->cue);
        $second = $runner->start($this->gm, $this->scene, $this->cue, [], (string) Str::uuid(), true);
        Event::fake([TabletopEvent::class]);
        $runner->control($this->gm, $this->scene, $second->id, 'cancel');
        Event::assertNotDispatched(TabletopEvent::class);
        $this->assertSame('queued', $first->fresh()->status);
        $this->assertSame('cancelled', $second->fresh()->status);
    }
}
