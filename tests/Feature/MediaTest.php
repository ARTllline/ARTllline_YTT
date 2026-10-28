<?php

namespace Tests\Feature;

use App\Actions\CueRunner;
use App\Actions\SceneActions;
use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\CueRun;
use App\Models\User;
use App\Services\AudioProbe;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class MediaTest extends TestCase
{
    use DatabaseMigrations;

    private $gm;

    private $player;

    private $campaign;

    private $scene;

    private string $base;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        Queue::fake();
        Storage::fake('campaigns');
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Audio']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Rain']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->campaign->refresh();
        $this->base = '/api/campaigns/'.$this->campaign->id.'/media';
        $this->actingAs($this->gm);
    }

    private function asset(string $kind = 'music', int $duration = 10000): Asset
    {
        $asset = Asset::create(['campaign_id' => $this->campaign->id, 'uploaded_by' => $this->gm->id, 'kind' => $kind,
            'name' => 'Secret '.$kind, 'original_name' => 'test.wav', 'storage_path' => Str::uuid().'.wav', 'mime_type' => 'audio/wav',
            'file_size' => 100, 'width' => 0, 'height' => 0, 'duration_ms' => $duration]);
        Storage::disk('campaigns')->put($asset->storage_path, str_repeat('a', 100));

        return $asset;
    }

    private function command(string $action, array $data = [])
    {
        return $this->postJson($this->base, $data + ['action' => $action, 'sceneId' => (string) $this->scene->id,
            'epoch' => $this->campaign->live_revision, 'volume' => 0.8, 'fade' => 1000, 'loop' => true]);
    }

    public function test_private_audio_upload_probe_metadata_and_range_delivery(): void
    {
        $pcm = str_repeat(pack('v', 100), 8000);
        $wav = 'RIFF'.pack('V', 36 + strlen($pcm)).'WAVEfmt '.pack('VvvVVvv', 16, 1, 1, 8000, 16000, 2, 16).'data'.pack('V', strlen($pcm)).$pcm;
        $file = UploadedFile::fake()->createWithContent('Rain.wav', $wav);
        $info = app(AudioProbe::class)->inspect($file);
        $this->assertSame(1000, $info['duration']);
        $id = $this->postJson('/api/campaigns/'.$this->campaign->id.'/assets', ['kind' => 'ambient', 'file' => $file])
            ->assertOk()->assertJsonPath('duration', 1000)->assertJsonPath('kind', 'ambient')->assertJsonMissingPath('storage_path')->json('id');
        $this->get('/api/assets/'.$id, ['Range' => 'bytes=0-43'])->assertStatus(206)->assertHeader('Content-Type', 'audio/wav');
        $this->get('/api/assets/'.$id.'/thumbnail')->assertNotFound();
        $this->actingAs($this->player)->get('/api/assets/'.$id)->assertForbidden();
        $this->getJson('/api/campaigns/'.$this->campaign->id.'/assets?kind=ambient')->assertForbidden();
        $this->postJson('/api/campaigns/'.$this->campaign->id.'/assets', ['kind' => 'ambient', 'file' => UploadedFile::fake()->createWithContent('fake.mp3', '<script>alert(1)</script>')])->assertForbidden();
        $this->actingAs($this->gm)->postJson('/api/campaigns/'.$this->campaign->id.'/assets', ['kind' => 'sfx', 'file' => UploadedFile::fake()->image('fake.mp3')])->assertUnprocessable();
    }

    public function test_live_music_replacement_pause_resume_and_expiring_crossfade_grant(): void
    {
        $this->freezeTime();
        $a = $this->asset();
        $b = $this->asset();
        $first = $this->command('music.start', ['assetId' => $a->id])->assertOk()->json();
        $this->travel(3)->seconds();
        $this->command('music.pause')->assertOk()->assertJsonPath('music.paused', true)->assertJsonPath('music.position', 3000);
        $this->travel(10)->seconds();
        $this->command('music.resume')->assertOk()->assertJsonPath('music.paused', false);
        $second = $this->command('music.start', ['assetId' => $b->id, 'fade' => 2000])->assertOk()->json();
        $this->assertNotSame($first['music']['id'], $second['music']['id']);
        $this->actingAs($this->player)->getJson($this->base)->assertOk()->assertJsonPath('music.assetId', (string) $b->id)->assertJsonPath('fade', 2000)->assertJsonMissingPath('sfx');
        $this->get('/api/assets/'.$a->id)->assertOk();
        $this->travel(18)->seconds();
        $this->get('/api/assets/'.$a->id)->assertForbidden();
        $this->get('/api/assets/'.$b->id)->assertOk();
        $this->assertSame(0, $this->scene->fresh()->revision);
    }

    public function test_ambient_limit_removal_atmosphere_and_scene_cleanup_preserve_music(): void
    {
        $music = $this->asset();
        $rain = $this->asset('ambient');
        $wind = $this->asset('ambient');
        $this->command('music.start', ['assetId' => $music->id])->assertOk();
        foreach ([$rain, $wind, $this->asset('ambient'), $this->asset('ambient')] as $asset) {
            $this->command('ambient.start', ['assetId' => $asset->id])->assertOk();
        }
        $this->command('ambient.start', ['assetId' => $this->asset('ambient')->id])->assertUnprocessable();
        $this->command('ambient.stop', ['assetId' => $rain->id])->assertOk()->assertJsonCount(3, 'ambient');
        $this->command('atmosphere.start', ['effect' => 'rain', 'intensity' => 'medium'])->assertOk()->assertJsonPath('effects.rain', 'medium');
        $this->actingAs($this->player)->getJson($this->base)->assertJsonPath('effects.rain', 'medium')->assertJsonCount(3, 'ambient');
        $next = $this->campaign->scenes()->create(['name' => 'Sun']);
        app(SceneActions::class)->activate($this->gm, $this->campaign, $next->id);
        $this->getJson($this->base)->assertJsonPath('sceneId', (string) $next->id)->assertJsonCount(0, 'ambient')->assertJsonCount(0, 'effects')->assertJsonPath('music.assetId', (string) $music->id);
        $this->get('/api/assets/'.$rain->id)->assertForbidden();
        $this->get('/api/assets/'.$wind->id)->assertForbidden();
        $this->actingAs($this->gm)->command('sfx.play', ['assetId' => $this->asset('sfx')->id])->assertConflict();
    }

    public function test_sfx_is_ephemeral_bounded_and_duplicate_http_does_not_publish_twice(): void
    {
        $sfx = $this->asset('sfx', 2000);
        $id = (string) Str::uuid();
        $this->command('sfx.play', ['assetId' => $sfx->id, 'clientMutationId' => $id])->assertOk();
        $this->command('sfx.play', ['assetId' => $sfx->id, 'clientMutationId' => $id])->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $events = Event::dispatched(TabletopEvent::class)->filter(fn ($args) => $args[0]->envelope['type'] === 'media.sfx');
        $this->assertCount(1, $events);
        $this->assertSame($id, $events->first()[0]->envelope['eventId']);
        $this->assertSame(0, DB::table('live_media')->count());
        $this->actingAs($this->player)->getJson($this->base)->assertJsonMissingPath('sfx')->assertJsonMissingPath('events');
        $this->get('/api/assets/'.$sfx->id)->assertOk();
        $this->travel(18)->seconds();
        $this->get('/api/assets/'.$sfx->id)->assertForbidden();
        $this->actingAs($this->gm)->command('sfx.play', ['assetId' => $this->asset('sfx', 121000)->id])->assertUnprocessable();
    }

    public function test_permissions_cross_campaign_and_same_command_changed_payload(): void
    {
        $asset = $this->asset();
        $id = (string) Str::uuid();
        $this->command('music.start', ['assetId' => $asset->id, 'clientMutationId' => $id])->assertOk();
        $this->command('music.start', ['assetId' => $asset->id, 'clientMutationId' => $id, 'volume' => 0.1])->assertConflict();
        $this->actingAs($this->player)->command('music.stop')->assertForbidden();
        $this->actingAs(User::factory()->create())->getJson($this->base)->assertForbidden();
        $this->get('/api/assets/'.$asset->id)->assertForbidden();
        $other = Campaign::create(['name' => 'Other']);
        $asset->update(['campaign_id' => $other->id]);
        $this->actingAs($this->gm)->command('music.start', ['assetId' => $asset->id])->assertUnprocessable();
    }

    public function test_cue_media_atomic_receipts_and_cancellation_keep_applied_state(): void
    {
        $music = $this->asset();
        $sfx = $this->asset('sfx');
        $base = '/api/scenes/'.$this->scene->id.'/cues';
        $steps = [['type' => 'music.start', 'config' => ['assetId' => (string) $music->id, 'volume' => 0.6, 'fade' => 1000, 'loop' => true]],
            ['type' => 'atmosphere.start', 'config' => ['effect' => 'embers', 'intensity' => 'strong']],
            ['type' => 'sfx.play', 'config' => ['assetId' => (string) $sfx->id, 'volume' => 1]], ['type' => 'wait', 'config' => ['duration' => 60000]]];
        $cue = $this->postJson($base.'/save', ['name' => 'Boss', 'steps' => $steps])->assertOk()->json('cue.id');
        $this->getJson('/api/assets/'.$music->id.'/detail')->assertOk()->assertJsonPath('usage.0', 'Используется в событии');
        $this->deleteJson('/api/assets/'.$music->id)->assertConflict();
        $run = CueRun::findOrFail($this->postJson($base.'/start', ['cueId' => $cue])->assertOk()->json('run.id'));
        for ($i = 0; $i < 4; $i++) {
            app(CueRunner::class)->advance($this->campaign->id, $run->id, $i);
            app(CueRunner::class)->advance($this->campaign->id, $run->id, $i);
        }
        $this->postJson($base.'/cancel', ['runId' => $run->id])->assertOk();
        $this->getJson($this->base)->assertJsonPath('music.assetId', (string) $music->id)->assertJsonPath('effects.embers', 'strong')->assertJsonPath('revision', 2);
        $events = Event::dispatched(TabletopEvent::class)->filter(fn ($args) => $args[0]->envelope['type'] === 'media.sfx');
        $this->assertCount(1, $events);
        $this->assertSame('cancelled', $run->fresh()->status);
    }

    public function test_non_looping_track_expires_and_grants_do_not_expose_other_library_assets(): void
    {
        $asset = $this->asset();
        $secret = $this->asset();
        $this->command('music.start', ['assetId' => $asset->id, 'loop' => false])->assertOk();
        $this->actingAs($this->player)->get('/api/assets/'.$secret->id)->assertForbidden();
        $this->travel(11)->seconds();
        $this->getJson($this->base)->assertJsonPath('music', null);
        $this->get('/api/assets/'.$asset->id)->assertForbidden();
    }

    public function test_media_channel_is_member_and_recipient_scoped_and_controls_are_authoritative(): void
    {
        config(['broadcasting.default' => 'reverb', 'broadcasting.connections.reverb.key' => 'test', 'broadcasting.connections.reverb.secret' => 'test', 'broadcasting.connections.reverb.app_id' => 'test']);
        require base_path('routes/channels.php');
        $auth = fn ($participant) => $this->postJson('/broadcasting/auth', ['socket_id' => '12.34',
            'channel_name' => 'private-campaign.'.$this->campaign->id.'.media.user.'.$participant]);
        $this->actingAs($this->player);
        $auth($this->player->id)->assertOk();
        $auth($this->gm->id)->assertForbidden();
        $outsider = User::factory()->create();
        $this->actingAs($outsider);
        $auth($outsider->id)->assertForbidden();
        $this->actingAs($this->gm);
        $this->command('audio.volume', ['channel' => 'ambient', 'volume' => 0.25])->assertOk()->assertJsonPath('volumes.ambient', 0.25);
        $this->command('atmosphere.start', ['effect' => 'snow', 'intensity' => 'light'])->assertOk();
        $this->command('atmosphere.stop', ['effect' => 'snow'])->assertOk()->assertJsonCount(0, 'effects');
        $this->command('atmosphere.start', ['effect' => '<script>', 'intensity' => 'light'])->assertUnprocessable();
        $this->assertSame(0, $this->scene->fresh()->revision);
    }
}
