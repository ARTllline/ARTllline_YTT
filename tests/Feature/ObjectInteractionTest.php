<?php

namespace Tests\Feature;

use App\Actions\CueRunner;
use App\Events\TabletopEvent;
use App\Jobs\ExecuteCueStep;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Cue;
use App\Models\CueRun;
use App\Models\Handout;
use App\Models\SceneProp;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

class ObjectInteractionTest extends TestCase
{
    use DatabaseMigrations;

    private $gm;

    private $player;

    private $otherPlayer;

    private $campaign;

    private $scene;

    private $token;

    private $prop;

    private $handout;

    private $cue;

    private string $base;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        Queue::fake();
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->otherPlayer = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Interactive table']);
        foreach ([[$this->gm, 'gm'], [$this->player, 'player'], [$this->otherPlayer, 'player']] as [$user, $role]) {
            $this->campaign->members()->attach($user, ['role' => $role]);
        }
        $this->scene = $this->campaign->scenes()->create(['name' => 'Study']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->token = $this->scene->tokens()->create(['name' => 'Old door', 'x' => 200, 'y' => 200, 'is_locked' => true]);
        $asset = Asset::create(['campaign_id' => $this->campaign->id, 'uploaded_by' => $this->gm->id, 'kind' => 'prop', 'name' => 'Desk', 'original_name' => 'desk.png', 'storage_path' => 'secret/desk.png', 'mime_type' => 'image/png', 'file_size' => 100, 'width' => 200, 'height' => 200]);
        $this->prop = SceneProp::create(['scene_id' => $this->scene->id, 'asset_id' => $asset->id, 'name' => 'Desk', 'x' => 400, 'y' => 400, 'is_locked' => true]);
        $image = $asset->replicate();
        $image->kind = 'handout';
        $image->storage_path = 'secret/letter.png';
        $image->save();
        $this->handout = Handout::create(['campaign_id' => $this->campaign->id, 'asset_id' => $image->id, 'title' => 'SECRET LETTER', 'description' => 'SECRET BACKGROUND', 'created_by' => $this->gm->id]);
        $this->cue = Cue::create(['scene_id' => $this->scene->id, 'name' => 'SECRET CUE']);
        $this->cue->steps()->create(['position' => 0, 'type' => 'message', 'config' => ['text' => 'You find blood.', 'duration' => 1000]]);
        $this->base = '/api/scenes/'.$this->scene->id;
        $this->actingAs($this->gm);
    }

    private function action(string $type = 'handout', array $extra = []): array
    {
        return $extra + ['id' => (string) Str::uuid(), 'label' => $type === 'handout' ? 'Прочитать' : 'Осмотреть', 'icon' => $type === 'handout' ? 'book' : 'eye', 'result_type' => $type, 'result_target' => (string) ($type === 'handout' ? $this->handout->id : $this->cue->id), 'enabled' => true];
    }

    private function save(string $kind, array $actions): void
    {
        $this->actingAs($this->gm)->postJson($this->base.'/object-actions', ['kind' => $kind, 'id' => $kind === 'token' ? $this->token->id : $this->prop->id, 'actions' => $actions, 'clientMutationId' => (string) Str::uuid()])->assertOk();
    }

    private function command(string $kind, string $actionId): array
    {
        return ['kind' => $kind, 'id' => $kind === 'token' ? $this->token->id : $this->prop->id, 'actionId' => $actionId, 'epoch' => 0, 'clientMutationId' => (string) Str::uuid()];
    }

    public function test_visible_locked_prop_reveals_correct_handout_only_to_interacting_player(): void
    {
        $action = $this->action();
        $this->save('prop', [$action]);
        $data = $this->command('prop', $action['id']);
        $this->actingAs($this->player)->postJson($this->base.'/interact', $data)->assertOk()->assertExactJson(['accepted' => true, 'mutationId' => $data['clientMutationId']]);
        $this->assertDatabaseHas('handout_reveals', ['handout_id' => $this->handout->id, 'user_id' => $this->player->id]);
        $this->assertDatabaseCount('handout_reveals', 1);
        $this->getJson('/api/campaigns/'.$this->campaign->id.'/handouts/'.$this->handout->id)->assertOk()->assertJsonPath('title', 'SECRET LETTER');
        $this->actingAs($this->otherPlayer)->getJson('/api/campaigns/'.$this->campaign->id.'/handouts/'.$this->handout->id)->assertForbidden();
        Event::assertDispatched(TabletopEvent::class, fn ($e) => $e->envelope['type'] === 'handout.shown'
            && $e->channel === 'campaign.'.$this->campaign->id.'.handouts.user.'.$this->player->id && $e->additionalChannels === []);
        $this->actingAs($this->player)->postJson($this->base.'/interact', $data)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertCount(1, Event::dispatched(TabletopEvent::class)->filter(fn ($args) => $args[0]->envelope['type'] === 'handout.shown'));
    }

    public function test_token_action_uses_existing_cue_runner_without_exposing_definition(): void
    {
        $action = $this->action('cue');
        $this->save('token', [$action]);
        $data = $this->command('token', $action['id']);
        $this->actingAs($this->player)->postJson($this->base.'/interact', $data)->assertOk()->assertJsonMissing(['name' => 'SECRET CUE']);
        $run = CueRun::sole();
        $this->assertEquals($this->gm->id, $run->created_by);
        $this->assertEquals($this->cue->id, $run->cue_id);
        Queue::assertPushed(ExecuteCueStep::class);
        $this->postJson($this->base.'/interact', $data)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertDatabaseCount('cue_runs', 1);
        app(CueRunner::class)->advance($this->campaign->id, $run->id, 0);
        $this->assertEquals('completed', $run->steps()->first()->status);
        $this->getJson($this->base.'/cues')->assertForbidden();
    }

    public function test_player_snapshot_and_realtime_contain_only_enabled_action_labels_and_icons(): void
    {
        $first = $this->action();
        $second = $this->action('cue');
        $disabled = $this->action('cue', ['enabled' => false, 'label' => 'SECRET DISABLED']);
        $this->save('token', [$second, $disabled, $first]);
        $this->save('prop', [$first]);
        $snapshot = $this->actingAs($this->player)->getJson($this->base.'/snapshot')->assertOk()->json();
        $safe = fn ($a) => array_intersect_key($a, array_flip(['id', 'label', 'icon']));
        $this->assertSame([$safe($second), $safe($first)], $snapshot['tokens'][0]['interactions']);
        $this->assertSame([$safe($first)], $snapshot['props'][0]['interactions']);
        foreach (Event::dispatched(TabletopEvent::class) as [$event]) {
            if (str_contains($event->channel, '.user.')) {
                $json = json_encode($event->envelope);
                foreach (['result_target', 'result_type', 'author_id', 'SECRET CUE', 'SECRET LETTER', 'SECRET DISABLED'] as $secret) {
                    $this->assertStringNotContainsString($secret, $json);
                }
            }
        }
        $this->actingAs($this->gm)->getJson($this->base.'/snapshot')->assertOk()->assertJsonPath('tokens.0.interactions.0.result_target', (string) $this->cue->id);
    }

    public function test_hidden_disabled_removed_and_forged_actions_are_rejected_including_retries(): void
    {
        $action = $this->action();
        $this->save('prop', [$action]);
        $data = $this->command('prop', $action['id']);
        $this->actingAs($this->player)->postJson($this->base.'/interact', $data)->assertOk();
        $this->prop->update(['is_hidden' => true]);
        $this->postJson($this->base.'/interact', $data)->assertForbidden();
        $this->postJson($this->base.'/interact', array_replace($data, ['clientMutationId' => (string) Str::uuid()]))->assertForbidden();
        $this->getJson($this->base.'/snapshot')->assertJsonCount(0, 'props');
        $this->prop->update(['is_hidden' => false]);
        $this->save('prop', [array_replace($action, ['enabled' => false])]);
        $this->actingAs($this->player)->postJson($this->base.'/interact', $data)->assertForbidden();
        $this->postJson($this->base.'/interact', $this->command('prop', (string) Str::uuid()))->assertForbidden();
        $this->postJson($this->base.'/interact', $this->command('token', $action['id']))->assertForbidden();
        $this->save('prop', []);
        $this->actingAs($this->player)->postJson($this->base.'/interact', $data)->assertForbidden();
    }

    public function test_cross_scene_campaign_outsider_and_stale_epoch_are_denied(): void
    {
        $action = $this->action();
        $this->save('prop', [$action]);
        $data = $this->command('prop', $action['id']);
        $other = Campaign::create(['name' => 'Foreign']);
        $scene = $other->scenes()->create(['name' => 'Foreign scene']);
        $token = $scene->tokens()->create(['name' => 'Foreign', 'x' => 0, 'y' => 0]);
        $this->actingAs($this->player)->postJson($this->base.'/interact', array_replace($data, ['kind' => 'token', 'id' => $token->id]))->assertNotFound();
        $this->postJson('/api/scenes/'.$scene->id.'/interact', $data)->assertForbidden();
        $this->postJson($this->base.'/interact', array_replace($data, ['epoch' => 1]))->assertConflict();
        $this->actingAs(User::factory()->create())->postJson($this->base.'/interact', $data)->assertForbidden();
    }

    public function test_configuration_is_gm_only_scoped_ordered_and_validated(): void
    {
        $action = $this->action();
        $data = ['kind' => 'prop', 'id' => $this->prop->id, 'actions' => [$action]];
        $this->actingAs($this->player)->postJson($this->base.'/object-actions', $data)->assertForbidden();
        $this->getJson($this->base.'/object-action-resources')->assertForbidden();
        $this->actingAs($this->gm)->getJson($this->base.'/object-action-resources')->assertOk()->assertJsonPath('handouts.0.name', 'SECRET LETTER');
        $scene = $this->campaign->scenes()->create(['name' => 'Other scene']);
        $cue = Cue::create(['scene_id' => $scene->id, 'name' => 'Foreign cue']);
        $foreign = $this->action('cue', ['result_target' => (string) $cue->id]);
        $this->postJson($this->base.'/object-actions', array_replace($data, ['actions' => [$foreign]]))->assertUnprocessable();
        $foreignCampaign = Campaign::create(['name' => 'Another campaign']);
        $foreignHandout = Handout::create(['campaign_id' => $foreignCampaign->id, 'asset_id' => $this->handout->asset_id, 'title' => 'Other secret', 'created_by' => $this->gm->id]);
        $this->postJson($this->base.'/object-actions', array_replace($data, ['actions' => [array_replace($action, ['result_target' => (string) $foreignHandout->id])]]))->assertUnprocessable();
        foreach ([['icon' => '<svg>'], ['result_type' => 'script'], ['label' => ''], ['author_id' => $this->player->id]] as $patch) {
            $this->postJson($this->base.'/object-actions', array_replace($data, ['actions' => [array_replace($action, $patch)]]))->assertUnprocessable();
        }
        $this->save('prop', [$this->action('cue'), $action]);
        $this->assertSame('cue', $this->prop->fresh()->interactions[0]['result_type']);
        $this->assertSame($this->gm->id, $this->prop->fresh()->interactions[1]['author_id']);
    }

    public function test_target_ids_cannot_be_supplied_and_deleted_targets_or_revoked_author_are_unavailable(): void
    {
        $action = $this->action();
        $this->save('prop', [$action]);
        $data = $this->command('prop', $action['id']);
        $this->actingAs($this->player)->postJson($this->base.'/interact', $data + ['handoutId' => 999])->assertUnprocessable();
        $this->handout->delete();
        $this->postJson($this->base.'/interact', $data)->assertForbidden();
        $this->getJson($this->base.'/snapshot')->assertJsonCount(0, 'props.0.interactions');
        $cueAction = $this->action('cue');
        $this->save('token', [$cueAction]);
        $this->campaign->members()->updateExistingPivot($this->gm->id, ['role' => 'player']);
        $this->actingAs($this->player)->postJson($this->base.'/interact', $this->command('token', $cueAction['id']))->assertForbidden();
    }

    public function test_gm_preview_is_private_and_cannot_be_replayed_after_role_change(): void
    {
        $action = $this->action();
        $this->save('prop', [$action]);
        $data = $this->command('prop', $action['id']);
        $this->postJson($this->base.'/interact', $data)->assertOk()->assertJsonPath('handout.title', 'SECRET LETTER');
        $this->assertDatabaseCount('handout_reveals', 0);
        $this->campaign->members()->updateExistingPivot($this->gm->id, ['role' => 'player']);
        $this->postJson($this->base.'/interact', $data)->assertForbidden();
    }
}
