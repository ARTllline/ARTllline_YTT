<?php

namespace Tests\Feature;

use App\Actions\CombatActions;
use App\Actions\CueRunner;
use App\Actions\HandoutActions;
use App\Actions\SceneActions;
use App\Actions\TemplateActions;
use App\Actions\TokenActions;
use App\Events\TabletopEvent;
use App\Jobs\ExecuteCueStep;
use App\Models\Campaign;
use App\Models\CueRun;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class CueTest extends TestCase
{
    use DatabaseMigrations;

    private $gm;

    private $player;

    private $campaign;

    private $scene;

    private $token;

    private string $base;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        Queue::fake();
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Director']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Stage']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->token = $this->scene->tokens()->create(['name' => 'SECRET BOSS', 'is_hidden' => true, 'x' => 400, 'y' => 500]);
        $this->base = '/api/scenes/'.$this->scene->id.'/cues';
        $this->actingAs($this->gm);
    }

    private function save(array $steps): int
    {
        return $this->postJson($this->base.'/save', ['name' => 'Засада', 'steps' => $steps])->assertOk()->json('cue.id');
    }

    private function start(int $id): CueRun
    {
        $id = $this->postJson($this->base.'/start', ['cueId' => $id])->assertOk()->json('run.id');

        return CueRun::findOrFail($id);
    }

    private function advance(CueRun $run): void
    {
        $run->refresh();
        app(CueRunner::class)->advance($this->campaign->id, $run->id, $run->position);
        $run->refresh();
    }

    private function reveal(): array
    {
        return ['type' => 'objects.reveal', 'config' => ['tokenIds' => [$this->token->id], 'propIds' => []]];
    }

    public function test_ordered_crud_snapshot_and_authorization(): void
    {
        $id = $this->save([$this->reveal(), ['type' => 'wait', 'config' => ['duration' => 500]]]);
        $run = $this->start($id);
        $this->postJson($this->base.'/save', ['cueId' => $id, 'name' => 'Изменено', 'steps' => [['type' => 'wait', 'config' => ['duration' => 1000]]]])->assertOk();
        $this->assertSame('objects.reveal', $run->steps()->first()->type);
        $this->assertSame(2, $run->steps()->count());
        $this->assertSame([0, 1], $run->steps()->pluck('position')->all());
        $this->actingAs($this->player)->getJson($this->base)->assertForbidden();
        foreach (['save', 'delete', 'start', 'retry', 'cancel'] as $action) {
            $this->postJson($this->base.'/'.$action, [])->assertForbidden();
        }
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertJsonCount(0, 'tokens')->assertJsonMissingPath('cues');
        $this->actingAs($this->gm)->postJson($this->base.'/delete', ['cueId' => $id])->assertOk();
        $this->assertNull($run->fresh()->cue_id);
        $this->advance($run);
        $this->assertFalse($this->token->fresh()->is_hidden);
    }

    public function test_sequential_wait_combat_and_no_revision_for_director(): void
    {
        $run = $this->start($this->save([$this->reveal(), ['type' => 'wait', 'config' => ['duration' => 500]],
            ['type' => 'message', 'config' => ['text' => '<script>plain text</script>', 'duration' => 500]],
            ['type' => 'combat.add', 'config' => ['tokenIds' => [$this->token->id]]], ['type' => 'combat.begin', 'config' => []]]));
        $this->advance($run);
        $this->assertSame(1, $this->scene->fresh()->revision);
        $this->advance($run);
        $this->assertSame(2, $run->position);
        $this->advance($run);
        $this->assertSame(2, $run->position);
        $this->travel(501)->milliseconds();
        $this->advance($run);
        $this->assertSame(1, $this->scene->fresh()->revision);
        $this->travel(501)->milliseconds();
        $this->advance($run);
        $this->advance($run);
        $this->advance($run);
        $this->assertSame('completed', $run->status);
        $this->assertDatabaseHas('combats', ['scene_id' => $this->scene->id, 'status' => 'active']);
        Event::assertDispatched(TabletopEvent::class, fn ($e) => ($e->envelope['action'] ?? '') === 'clear');
        Queue::assertPushed(ExecuteCueStep::class);
    }

    public function test_cancel_during_wait_and_activation_cancel_future_steps(): void
    {
        $run = $this->start($this->save([$this->reveal(), ['type' => 'wait', 'config' => ['duration' => 3000]],
            ['type' => 'objects.hide', 'config' => ['tokenIds' => [$this->token->id], 'propIds' => []]]]));
        $this->advance($run);
        $this->advance($run);
        $this->postJson($this->base.'/cancel', ['runId' => $run->id])->assertOk();
        $this->travel(10)->seconds();
        $this->advance($run);
        $this->assertSame('cancelled', $run->status);
        $this->assertFalse($this->token->fresh()->is_hidden);
        $run2 = $this->start($this->save([['type' => 'wait', 'config' => ['duration' => 500]]]));
        app(SceneActions::class)->activate($this->gm, $this->campaign, null);
        $this->assertSame('cancelled', $run2->fresh()->status);
        $this->postJson($this->base.'/start', ['cueId' => $run2->cue_id])->assertConflict();
    }

    public function test_hidden_focus_fails_without_leaking_and_retry_uses_original_step(): void
    {
        $run = $this->start($this->save([['type' => 'camera.focus', 'config' => ['kind' => 'token', 'id' => $this->token->id, 'duration' => 300]]]));
        $this->advance($run);
        $this->assertSame('failed', $run->status);
        $frames = Event::dispatched(TabletopEvent::class)->pluck(0)->map(fn ($e) => $e->envelope);
        $this->assertStringNotContainsString('SECRET BOSS', json_encode($frames));
        $this->assertStringNotContainsString('"x":400', json_encode($frames));
        $key = $run->steps()->first()->id;
        app(TokenActions::class)->update($this->gm, $this->token, ['is_hidden' => false]);
        $this->postJson($this->base.'/retry', ['runId' => $run->id])->assertOk();
        $this->advance($run);
        $this->assertSame($key, $run->steps()->first()->id);
        Event::assertDispatched(TabletopEvent::class, fn ($e) => ($e->envelope['action'] ?? '') === 'camera.focus'
            && $e->envelope['config']['x'] === 400.0 && ! isset($e->envelope['config']['id']));
    }

    public function test_spawn_and_start_receipt_retries_and_recovery_are_idempotent(): void
    {
        $template = app(TemplateActions::class)->save($this->gm, $this->campaign,
            ['sceneId' => $this->scene->id, 'kind' => 'encounter', 'name' => 'Enemy', 'tokenIds' => [$this->token->id], 'propIds' => []])['template'];
        $id = $this->save([['type' => 'encounter.spawn', 'config' => ['templateId' => $template['id'], 'x' => 50, 'y' => 60, 'addToCombat' => true, 'startCombat' => true]]]);
        $body = ['cueId' => $id, 'clientMutationId' => (string) Str::uuid()];
        $runId = $this->postJson($this->base.'/start', $body)->assertOk()->json('run.id');
        $this->postJson($this->base.'/start', $body)->assertOk()->assertJsonPath('run.id', $runId);
        $run = CueRun::findOrFail($runId);
        $this->advance($run);
        app(CueRunner::class)->advance($this->campaign->id, $runId, 0);
        $this->assertDatabaseCount('tokens', 2);
        $this->assertDatabaseCount('combatants', 1);
        $this->assertSame(4, $this->scene->fresh()->revision);
        $this->travel(91)->seconds();
        $this->assertSame(1, app(CueRunner::class)->recover());
        $this->advance($run);
        $this->assertSame('completed', $run->status);
        $this->assertSame(0, app(CueRunner::class)->recover());
    }

    public function test_foreign_targets_and_executable_types_are_rejected(): void
    {
        $other = $this->campaign->scenes()->create(['name' => 'Other'])->tokens()->create(['name' => 'Foreign', 'x' => 0, 'y' => 0]);
        $this->postJson($this->base.'/save', ['name' => 'Bad', 'steps' => [['type' => 'object.move', 'config' => ['kind' => 'token', 'id' => $other->id, 'x' => 1, 'y' => 2]]]])->assertUnprocessable();
        $this->postJson($this->base.'/save', ['name' => 'Bad', 'steps' => [['type' => 'javascript', 'config' => ['code' => 'alert(1)']]]])->assertUnprocessable();
    }

    public function test_prefab_and_handout_retries_publish_once_with_atomic_database_queue(): void
    {
        Queue::fake()->except([ExecuteCueStep::class]);
        Storage::fake('campaigns');
        $asset = $this->post('/api/campaigns/'.$this->campaign->id.'/assets', ['kind' => 'handout',
            'file' => UploadedFile::fake()->image('letter.png')], ['Accept' => 'application/json'])->assertOk()->json('id');
        $handout = app(HandoutActions::class)->save($this->gm, $this->campaign, ['assetId' => $asset, 'title' => 'Letter']);
        $template = app(TemplateActions::class)->save($this->gm, $this->campaign,
            ['sceneId' => $this->scene->id, 'kind' => 'prefab', 'name' => 'Guard', 'tokenIds' => [$this->token->id], 'propIds' => []])['template'];
        $run = $this->start($this->save([['type' => 'prefab.spawn', 'config' => ['templateId' => $template['id'], 'x' => 10, 'y' => 20]],
            ['type' => 'handout.show', 'config' => ['handoutId' => $handout['id']]]]));
        $this->assertDatabaseCount('jobs', 1);
        $this->advance($run);
        app(CueRunner::class)->advance($this->campaign->id, $run->id, 0);
        $this->assertDatabaseCount('tokens', 2);
        $this->assertDatabaseCount('jobs', 2);
        $this->advance($run);
        app(CueRunner::class)->advance($this->campaign->id, $run->id, 1);
        $this->assertDatabaseCount('handout_reveals', 1);
        $presentations = Event::dispatched(TabletopEvent::class)->pluck(0)->filter(fn ($e) => $e->envelope['type'] === 'handout.shown');
        $this->assertCount(1, $presentations);
        $this->assertSame($run->steps()->where('position', 1)->first()->id, $presentations->first()->envelope['presentationId']);
        $this->advance($run);
        $this->assertSame('completed', $run->status);
    }

    public function test_failed_composite_step_rolls_back_spawn_and_revision_before_retry(): void
    {
        $template = app(TemplateActions::class)->save($this->gm, $this->campaign,
            ['sceneId' => $this->scene->id, 'kind' => 'encounter', 'name' => 'Guard', 'tokenIds' => [$this->token->id], 'propIds' => []])['template'];
        $run = $this->start($this->save([['type' => 'encounter.spawn', 'config' => ['templateId' => $template['id'], 'x' => 10, 'y' => 20, 'addToCombat' => true]]]));
        $this->mock(CombatActions::class)->shouldReceive('execute')->once()->andThrow(new \RuntimeException('Injected failure after spawn'));
        $this->advance($run);
        $this->assertSame('failed', $run->status);
        $this->assertDatabaseCount('tokens', 1);
        $this->assertSame(0, $this->scene->fresh()->revision);
        $this->app->forgetInstance(CombatActions::class);
        $this->postJson($this->base.'/retry', ['runId' => $run->id])->assertOk();
        $this->advance($run);
        $this->assertDatabaseCount('tokens', 2);
        $this->assertDatabaseCount('combatants', 1);
    }
}
