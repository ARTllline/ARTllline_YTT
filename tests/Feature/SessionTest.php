<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\ContentTemplate;
use App\Models\Cue;
use App\Models\Handout;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class SessionTest extends TestCase
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
        Storage::fake('campaigns');
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Session campaign']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'SECRET BOSS ROOM']);
        $this->base = '/api/campaigns/'.$this->campaign->id;
        $this->actingAs($this->gm);
    }

    private function createSession(): array
    {
        return $this->postJson($this->base.'/sessions/create', ['name' => 'Secret run of show'])->assertOk()
            ->assertJsonPath('session.status', 'planned')->assertJsonPath('session.planRevision', 0)->json('session');
    }

    private function item(string $type, mixed $reference = null): array
    {
        return ['id' => (string) Str::uuid(), 'type' => $type, 'referenceId' => $reference, 'title' => '', 'notes' => 'GM secret'];
    }

    private function asset(string $kind = 'map'): Asset
    {
        $asset = Asset::create(['campaign_id' => $this->campaign->id, 'uploaded_by' => $this->gm->id, 'kind' => $kind,
            'name' => 'SECRET final boss', 'original_name' => 'final_boss_demon.png', 'storage_path' => Str::uuid().'.png', 'mime_type' => 'image/png',
            'file_size' => 100, 'width' => 100, 'height' => 100]);
        Storage::disk('campaigns')->put($asset->storage_path, str_repeat('a', 100));

        return $asset;
    }

    private function preload(bool $audio = false): array
    {
        return $this->postJson($this->base.'/preload', ['sceneId' => $this->scene->id, 'includeAudio' => $audio])->assertOk()->json('preload');
    }

    public function test_plan_crud_order_reference_resume_and_focus_has_no_side_effects(): void
    {
        $session = $this->createSession();
        $cue = Cue::create(['scene_id' => $this->scene->id, 'name' => 'Secret cue']);
        $handout = Handout::create(['campaign_id' => $this->campaign->id, 'asset_id' => $this->asset('handout')->id, 'title' => 'Secret letter', 'created_by' => $this->gm->id]);
        $encounter = ContentTemplate::create(['campaign_id' => $this->campaign->id, 'kind' => 'encounter', 'name' => 'Secret patrol', 'created_by' => $this->gm->id]);
        $items = [$this->item('chapter'), $this->item('scene', $this->scene->id), $this->item('cue', $cue->id), $this->item('handout', $handout->id), $this->item('encounter', $encounter->id), $this->item('note')];
        $save = ['sessionId' => $session['id'], 'planRevision' => 0, 'name' => 'The evening', 'items' => $items, 'clientMutationId' => (string) Str::uuid()];
        $this->postJson($this->base.'/sessions/save', $save)->assertOk()->assertJsonCount(6, 'session.items');
        $this->postJson($this->base.'/sessions/save', $save)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->postJson($this->base.'/sessions/start', ['sessionId' => $session['id']])->assertOk()->assertJsonPath('session.status', 'active');
        $this->postJson($this->base.'/sessions/focus', ['sessionId' => $session['id'], 'itemId' => $items[4]['id']])->assertOk();
        $this->postJson($this->base.'/sessions/notes', ['sessionId' => $session['id'], 'notes' => 'Remember old road'])->assertOk();
        $this->getJson($this->base.'/sessions/'.$session['id'])->assertOk()->assertJsonPath('currentItemId', $items[4]['id'])->assertJsonPath('notes', 'Remember old road');
        $this->assertNull($this->campaign->fresh()->active_scene_id);
        $this->assertDatabaseCount('cue_runs', 0);
        $this->assertDatabaseCount('handout_reveals', 0);
        $this->assertDatabaseCount('tokens', 0);
        $this->assertDatabaseCount('live_media', 0);
        Event::assertNotDispatched(TabletopEvent::class);
        $reordered = array_reverse($items);
        $this->postJson($this->base.'/sessions/save', ['sessionId' => $session['id'], 'planRevision' => 1, 'name' => 'The evening', 'items' => $reordered])->assertOk()->assertJsonPath('session.items.0.id', $items[5]['id'])->assertJsonPath('session.currentItemId', $items[4]['id']);
        $this->postJson($this->base.'/sessions/save', ['sessionId' => $session['id'], 'planRevision' => 1, 'name' => 'stale', 'items' => []])->assertConflict();
        $this->postJson($this->base.'/sessions/complete', ['sessionId' => $session['id']])->assertOk()->assertJsonPath('session.notes', 'Remember old road');
        $this->getJson($this->base.'/sessions/'.$session['id'])->assertJsonPath('status', 'completed');
        $this->postJson($this->base.'/sessions/notes', ['sessionId' => $session['id'], 'notes' => 'overwrite'])->assertConflict();
        $this->postJson($this->base.'/sessions/delete', ['sessionId' => $session['id']])->assertOk();
        $this->assertDatabaseCount('session_items', 0);
        $this->assertDatabaseHas('scenes', ['id' => $this->scene->id]);
        $this->assertDatabaseHas('cues', ['id' => $cue->id]);
    }

    public function test_only_one_active_session_cross_campaign_references_and_missing_reference(): void
    {
        $a = $this->createSession();
        $b = $this->createSession();
        $this->postJson($this->base.'/sessions/start', ['sessionId' => $a['id']])->assertOk();
        $this->postJson($this->base.'/sessions/start', ['sessionId' => $b['id']])->assertConflict();
        $this->postJson($this->base.'/sessions/delete', ['sessionId' => $a['id']])->assertConflict();
        $foreign = Campaign::create(['name' => 'Other']);
        $other = $foreign->scenes()->create(['name' => 'Other scene']);
        $save = ['sessionId' => $a['id'], 'name' => 'A', 'planRevision' => 0, 'items' => [$this->item('scene', $other->id)]];
        $this->postJson($this->base.'/sessions/save', $save)->assertUnprocessable();
        $save['items'][0]['referenceId'] = $this->scene->id;
        $this->postJson($this->base.'/sessions/save', $save)->assertOk();
        $this->scene->delete();
        $this->getJson($this->base.'/sessions/'.$a['id'])->assertOk()->assertJsonPath('items.0.missing', true)->assertJsonPath('items.0.referenceId', null)->assertJsonPath('items.0.notes', 'GM secret');
        $this->postJson($this->base.'/sessions/focus', ['sessionId' => $a['id'], 'itemId' => (string) Str::uuid()])->assertUnprocessable();
    }

    public function test_session_plan_notes_resources_and_mutations_are_gm_only_even_receipt_replay(): void
    {
        $session = $this->createSession();
        $body = ['sessionId' => $session['id'], 'notes' => 'private', 'clientMutationId' => (string) Str::uuid()];
        $this->postJson($this->base.'/sessions/notes', $body)->assertOk();
        $this->actingAs($this->player);
        $this->getJson($this->base.'/sessions')->assertForbidden();
        $this->getJson($this->base.'/sessions/'.$session['id'])->assertForbidden();
        $this->getJson($this->base.'/session-resources?type=cue')->assertForbidden();
        foreach (['create', 'save', 'focus', 'notes', 'start', 'auto', 'complete', 'delete'] as $action) {
            $this->postJson($this->base.'/sessions/'.$action, $body)->assertForbidden();
        }
        $this->campaign->members()->updateExistingPivot($this->gm->id, ['role' => 'player']);
        $this->actingAs($this->gm)->postJson($this->base.'/sessions/notes', $body)->assertForbidden();
    }

    public function test_safe_manifest_opaque_delivery_hidden_handouts_and_activation_cache_identity(): void
    {
        $map = $this->asset();
        $visible = $this->asset('token');
        $hidden = $this->asset('token');
        $handout = $this->asset('handout');
        $this->scene->update(['map_asset_id' => $map->id]);
        $this->scene->tokens()->create(['name' => 'visible actor', 'x' => 100, 'y' => 100, 'token_image_asset_id' => $visible->id]);
        $this->scene->tokens()->create(['name' => 'SECRET MONSTER', 'x' => 200, 'y' => 200, 'token_image_asset_id' => $hidden->id, 'is_hidden' => true]);
        $preload = $this->preload();
        $this->assertNull($this->campaign->fresh()->active_scene_id);
        $this->actingAs($this->player);
        $response = $this->getJson($this->base.'/preload')->assertOk()->assertJsonCount(2, 'manifest.resources')->assertJsonMissingPath('manifest.sceneId');
        $manifest = $response->json('manifest');
        foreach (['SECRET', 'boss', 'name', 'assetId', 'coordinates', 'sceneId', 'notes', 'cue', 'handout'] as $secret) {
            $this->assertStringNotContainsString($secret, $response->getContent());
        }
        $url = $manifest['resources'][0]['url'];
        $this->get($url, ['Range' => 'bytes=0-9'])->assertStatus(206)->assertHeader('Content-Disposition', 'inline; filename="resource"')->assertHeader('Cache-Control', 'no-store, private');
        $this->get('/api/assets/'.$map->id)->assertForbidden();
        $this->get('/api/assets/'.$hidden->id)->assertForbidden();
        $this->get('/api/assets/'.$handout->id)->assertForbidden();
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertForbidden();
        $this->actingAs(User::factory()->create())->get($url)->assertForbidden();
        $this->actingAs($this->gm)->postJson($this->base.'/activate', ['sceneId' => $this->scene->id])->assertOk();
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()->assertJsonPath('map.asset.url', $url)->assertJsonCount(1, 'tokens');
        $this->getJson($this->base.'/preload')->assertJsonPath('manifest.id', $preload['id']);
    }

    public function test_readiness_late_join_failure_reconnect_expiry_and_stale_batch(): void
    {
        $this->freezeTime();
        $this->scene->update(['map_asset_id' => $this->asset()->id]);
        $first = $this->preload();
        $this->assertSame('waiting', $first['players'][0]['status']);
        $body = ['batchId' => $first['id'], 'clientId' => (string) Str::uuid(), 'status' => 'ready', 'loaded' => 1];
        $this->actingAs($this->player)->postJson($this->base.'/preload/readiness', $body)->assertOk();
        $this->actingAs($this->gm)->getJson($this->base.'/preload')->assertJsonPath('preload.players.0.status', 'ready');
        $late = User::factory()->create();
        $this->campaign->members()->attach($late, ['role' => 'player']);
        $this->getJson($this->base.'/preload')->assertJsonCount(2, 'preload.players')->assertJsonPath('preload.players.1.status', 'waiting');
        $this->actingAs($late)->getJson($this->base.'/preload')->assertJsonPath('manifest.id', $first['id']);
        $this->postJson($this->base.'/preload/readiness', array_replace($body, ['loaded' => 0]))->assertUnprocessable();
        $this->postJson($this->base.'/preload/readiness', array_replace($body, ['status' => 'failed', 'loaded' => 0]))->assertOk();
        $this->actingAs($this->gm)->getJson($this->base.'/preload')->assertJsonPath('preload.players.1.status', 'failed');
        $this->travel(46)->seconds();
        $this->getJson($this->base.'/preload')->assertJsonPath('preload.players.0.status', 'waiting');
        $this->scene->increment('revision');
        $this->getJson($this->base.'/preload')->assertJsonPath('preload.valid', false);
        $this->actingAs($this->player)->getJson($this->base.'/preload')->assertJsonPath('manifest', null);
        $this->postJson($this->base.'/preload/readiness', $body)->assertConflict();
        $this->actingAs($this->gm);
        $second = $this->preload();
        $this->assertNotSame($first['id'], $second['id']);
        $this->actingAs($this->player)->postJson($this->base.'/preload/readiness', $body)->assertConflict();
        $this->travel(31)->minutes();
        $this->getJson($this->base.'/preload')->assertJsonPath('manifest', null);
    }

    public function test_audio_opt_in_limit_revision_revocation_and_no_playback(): void
    {
        $music = $this->asset('music');
        $music->update(['duration_ms' => 1000]);
        $cue = Cue::create(['scene_id' => $this->scene->id, 'name' => 'Secret song']);
        $step = $cue->steps()->create(['position' => 0, 'type' => 'music.start', 'config' => ['assetId' => (string) $music->id]]);
        $this->assertSame(0, $this->preload()['total']);
        $this->assertSame(1, $this->preload(true)['total']);
        $this->assertDatabaseCount('live_media', 0);
        $this->assertDatabaseCount('cue_runs', 0);
        $this->actingAs($this->player);
        $url = $this->getJson($this->base.'/preload')->json('manifest.resources.0.url');
        $this->get($url)->assertOk();
        $this->get('/api/assets/'.$music->id)->assertForbidden();
        $step->delete();
        $this->get($url)->assertForbidden();
        $this->getJson($this->base.'/preload')->assertJsonPath('manifest', null);
        $this->postJson($this->base.'/preload', ['sceneId' => $this->scene->id, 'includeAudio' => true])->assertForbidden();
        $huge = $this->asset();
        $huge->update(['file_size' => 134217729]);
        $this->scene->update(['map_asset_id' => $huge->id]);
        $this->actingAs($this->gm)->postJson($this->base.'/preload', ['sceneId' => $this->scene->id, 'includeAudio' => false])->assertUnprocessable();
    }
}
