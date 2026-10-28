<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\HandoutReveal;
use App\Models\Scene;
use App\Models\SceneNote;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class PreparationTest extends TestCase
{
    use DatabaseMigrations;

    private User $gm;

    private User $player;

    private User $outsider;

    private Campaign $campaign;

    private Scene $scene;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('campaigns');
        Event::fake([TabletopEvent::class]);
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->outsider = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Preparation QA']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Active table']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->actingAs($this->gm);
    }

    private function base(): string
    {
        return '/api/campaigns/'.$this->campaign->id;
    }

    private function image(string $kind = 'map', string $name = 'Moonlit_Forest.png'): array
    {
        return $this->post($this->base().'/assets', ['kind' => $kind, 'file' => UploadedFile::fake()->image($name, 800, 600)], ['Accept' => 'application/json'])->assertOk()->json();
    }

    public function test_library_search_taxonomy_pagination_is_campaign_scoped_and_private(): void
    {
        $a = $this->image();
        $this->assertSame('Moonlit Forest', $a['name']);
        $this->assertArrayNotHasKey('storage_path', $a);
        $a = $this->patchJson('/api/assets/'.$a['id'], ['name' => 'Old road', 'tags' => ['forest', 'Night'], 'collections' => ['Session 12', 'Reusable']])->assertOk()->json();
        $this->getJson($this->base().'/assets?search=forest&kind=map&tag='.$a['tags'][0]['id'].'&collection='.$a['collections'][0]['id'])->assertOk()->assertJsonPath('total', 1);
        $other = Campaign::create(['name' => 'Other']);
        $other->members()->attach($this->gm, ['role' => 'gm']);
        $this->getJson('/api/campaigns/'.$other->id.'/assets?tag='.$a['tags'][0]['id'])->assertOk()->assertJsonPath('total', 0)->assertJsonPath('tags', []);
        $this->patchJson('/api/assets/'.$a['id'], ['tags' => [], 'collections' => []])->assertOk()->assertJsonPath('tags', [])->assertJsonPath('collections', []);
        $model = Asset::findOrFail($a['id']);
        for ($i = 0; $i < 305; $i++) {
            $copy = $model->replicate();
            $copy->name = 'Fixture '.$i;
            $copy->storage_path = 'fixture-'.$i.'.png';
            $copy->save();
        }
        $this->getJson($this->base().'/assets?page=2')->assertOk()->assertJsonCount(40, 'assets')->assertJsonPath('total', 306)->assertJsonPath('pages', 8);
        foreach ([$this->player, $this->outsider] as $user) {
            $this->actingAs($user);
            $this->getJson($this->base().'/assets')->assertForbidden();
            $this->getJson('/api/assets/'.$a['id'].'/detail')->assertForbidden();
            $this->patchJson('/api/assets/'.$a['id'], ['name' => 'intrusion'])->assertForbidden();
            $this->deleteJson('/api/assets/'.$a['id'])->assertForbidden();
            $this->get('/api/assets/'.$a['id'].'/thumbnail')->assertForbidden();
        }
    }

    public function test_thumbnails_duplicates_and_reference_safe_deletion(): void
    {
        $a = $this->image();
        $b = $this->image();
        $original = Asset::find($a['id']);
        $this->assertNotSame($original->storage_path, Asset::find($b['id'])->storage_path);
        $thumb = $this->get('/api/assets/'.$a['id'].'/thumbnail')->assertOk()->assertHeader('Content-Type', 'image/webp');
        $this->assertLessThan(32000, strlen($thumb->streamedContent()));
        $this->assertTrue(Storage::disk('campaigns')->exists($original->storage_path.'.thumb.webp'));
        $map = ['assetId' => $a['id'], 'x' => 0, 'y' => 0, 'width' => 800, 'height' => 600];
        $this->putJson('/api/scenes/'.$this->scene->id.'/map', $map)->assertOk()->assertJsonPath('revision', 1);
        $second = $this->campaign->scenes()->create(['name' => 'Reuse']);
        $this->putJson('/api/scenes/'.$second->id.'/map', $map)->assertOk();
        $this->deleteJson('/api/assets/'.$a['id'])->assertConflict();
        $this->getJson('/api/assets/'.$a['id'].'/detail')->assertJsonCount(2, 'usage');
        $this->actingAs($this->player)->get('/api/assets/'.$a['id'].'/thumbnail')->assertOk();
        $this->actingAs($this->gm)->putJson('/api/scenes/'.$this->scene->id.'/map', array_replace($map, ['assetId' => $b['id']]))->assertOk()->assertJsonPath('revision', 2);
        $this->actingAs($this->player)->get('/api/assets/'.$a['id'])->assertForbidden();
        $this->get('/api/assets/'.$a['id'].'/thumbnail')->assertForbidden();
        $this->actingAs($this->gm)->putJson('/api/scenes/'.$second->id.'/map', array_replace($map, ['assetId' => null]))->assertOk();
        $this->deleteJson('/api/assets/'.$a['id'])->assertOk();
        Storage::disk('campaigns')->assertMissing([$original->storage_path, $original->storage_path.'.thumb.webp']);
        $this->assertDatabaseMissing('assets', ['id' => $a['id']]);
        $this->post($this->base().'/assets', ['kind' => 'handout', 'file' => UploadedFile::fake()->createWithContent('bad.svg', '<svg/>')], ['Accept' => 'application/json'])->assertUnprocessable();
        $this->image('handout', 'Good.png');
        $this->assertDatabaseCount('assets', 2);
    }

    public function test_token_asset_creation_assignment_and_revocation_are_one_revision_commands(): void
    {
        $a = $this->image('token', 'Goblin_Archer.png');
        $b = $this->image('token', 'Knight.png');
        $token = $this->postJson('/api/scenes/'.$this->scene->id.'/tokens', ['name' => $a['name'], 'x' => 100.5, 'y' => 230.25, 'token_image_asset_id' => $a['id']])->assertOk()->assertJsonPath('revision', 1)->json('token');
        $this->assertEquals($this->scene->fresh()->grid_size, $token['size']);
        $this->assertSame($a['id'], $token['image']['id']);
        $this->deleteJson('/api/assets/'.$a['id'])->assertConflict();
        $this->actingAs($this->player)->get('/api/assets/'.$a['id'])->assertOk();
        $this->actingAs($this->gm)->patchJson('/api/tokens/'.$token['id'], ['token_image_asset_id' => $b['id']])->assertOk()->assertJsonPath('revision', 2);
        $this->actingAs($this->player)->get('/api/assets/'.$a['id'])->assertForbidden();
        $this->get('/api/assets/'.$a['id'].'/thumbnail')->assertForbidden();
        $this->get('/api/assets/'.$b['id'])->assertOk();
        $other = Campaign::create(['name' => 'foreign']);
        $other->members()->attach($this->gm, ['role' => 'gm']);
        $foreign = $other->scenes()->create(['name' => 'foreign scene']);
        $this->actingAs($this->gm)->postJson('/api/scenes/'.$foreign->id.'/tokens', ['name' => 'x', 'x' => 0, 'y' => 0, 'token_image_asset_id' => $a['id']])->assertUnprocessable();
        $this->assertEquals(0, $foreign->fresh()->revision);
    }

    public function test_handout_discovery_is_persistent_recipient_scoped_and_show_is_idempotent(): void
    {
        $a = $this->image('handout', 'Secret_Letter.png');
        $h = $this->postJson($this->base().'/handouts', ['assetId' => $a['id'], 'title' => 'The letter', 'description' => 'A clue'])->assertOk()->json();
        $this->actingAs($this->player)->getJson($this->base().'/handouts')->assertOk()->assertJsonPath('handouts', []);
        $this->get('/api/assets/'.$a['id'])->assertForbidden();
        $this->get('/api/assets/'.$a['id'].'/thumbnail')->assertForbidden();
        $this->postJson($this->base().'/handouts/show', ['handoutId' => $h['id']])->assertForbidden();
        $payload = ['handoutId' => $h['id'], 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($this->gm)->postJson($this->base().'/handouts/show', $payload)->assertOk();
        $this->postJson($this->base().'/handouts/show', $payload)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertDatabaseCount('handout_reveals', 1);
        Event::assertDispatchedTimes(TabletopEvent::class, 1);
        Event::assertDispatched(TabletopEvent::class, fn ($e) => $e->envelope['type'] === 'handout.shown' && ! str_contains(json_encode($e->envelope), 'Secret_Letter'));
        $this->postJson($this->base().'/handouts/show', ['handoutId' => $h['id']])->assertOk();
        $this->assertDatabaseCount('handout_reveals', 1);
        Event::assertDispatchedTimes(TabletopEvent::class, 2);
        $this->campaign->forceFill(['active_scene_id' => null])->save();
        $this->actingAs($this->player)->getJson($this->base().'/handouts')->assertOk()->assertJsonPath('handouts.0.title', 'The letter');
        $this->get('/api/assets/'.$a['id'])->assertOk();
        $this->get('/api/assets/'.$a['id'].'/thumbnail')->assertOk();
        $this->actingAs($this->outsider)->get('/api/assets/'.$a['id'])->assertForbidden();
        $this->getJson($this->base().'/handouts')->assertForbidden();
        $this->campaign->members()->attach($this->outsider, ['role' => 'player']);
        $this->getJson($this->base().'/handouts')->assertOk()->assertJsonPath('handouts', []);
        $this->get('/api/assets/'.$a['id'])->assertForbidden();
        $this->actingAs($this->gm)->deleteJson('/api/assets/'.$a['id'])->assertConflict();
        $this->assertSame($this->player->id, HandoutReveal::first()->user_id);
    }

    public function test_notes_are_gm_only_persistent_revisioned_and_replay_safe(): void
    {
        $path = '/api/scenes/'.$this->scene->id.'/notes';
        $payload = ['action' => 'create', 'x' => 50.25, 'y' => 100, 'title' => 'SECRET TRAP', 'body' => 'DC 15', 'icon' => 'warning', 'clientMutationId' => (string) Str::uuid()];
        $n = $this->postJson($path, $payload)->assertOk()->assertJsonPath('revision', 1)->json('note');
        $this->postJson($path, $payload)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertDatabaseCount('scene_notes', 1);
        $this->postJson($path, ['action' => 'update', 'id' => $n['id'], 'x' => 150, 'y' => 200])->assertOk()->assertJsonPath('revision', 2)->assertJsonPath('note.body', 'DC 15');
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertJsonPath('notes.0.x', 150)->assertJsonPath('notes.0.body', 'DC 15');
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertJsonMissingPath('notes')->assertDontSee('SECRET TRAP');
        foreach ([$this->player, $this->outsider] as $user) {
            $this->actingAs($user)->postJson($path, $payload)->assertForbidden();
        }
        $events = Event::dispatched(TabletopEvent::class)->map(fn ($args) => $args[0]);
        foreach ($events->filter(fn ($e) => str_contains($e->channel, '.user.')) as $event) {
            $this->assertSame('scene.revision', $event->envelope['type']);
            $this->assertSame('{}', json_encode($event->envelope['payload']));
        }
        $this->assertCount(2, $events->filter(fn ($e) => str_ends_with($e->channel, '.gm')));
        $inactive = $this->campaign->scenes()->create(['name' => 'Prepared']);
        $this->actingAs($this->gm)->postJson('/api/scenes/'.$inactive->id.'/notes', ['action' => 'update', 'id' => $n['id'], 'body' => 'bad'])->assertNotFound();
        $this->assertEquals(0, $inactive->fresh()->revision);
        $this->postJson($path, ['action' => 'delete', 'id' => $n['id']])->assertOk()->assertJsonPath('revision', 3);
        $this->assertNull(SceneNote::find($n['id']));
    }

    public function test_handout_cross_campaign_references_and_private_channel_identity_are_denied(): void
    {
        $a = $this->image('handout');
        $h = $this->postJson($this->base().'/handouts', ['assetId' => $a['id'], 'title' => 'Private'])->assertOk()->json();
        $other = Campaign::create(['name' => 'Other campaign']);
        $other->members()->attach($this->gm, ['role' => 'gm']);
        $this->postJson('/api/campaigns/'.$other->id.'/handouts', ['assetId' => $a['id'], 'title' => 'Foreign'])->assertUnprocessable();
        $this->postJson('/api/campaigns/'.$other->id.'/handouts/show', ['handoutId' => $h['id']])->assertNotFound();
        $this->assertDatabaseCount('handout_reveals', 0);
        config(['broadcasting.default' => 'reverb', 'broadcasting.connections.reverb.key' => 'test', 'broadcasting.connections.reverb.secret' => 'test', 'broadcasting.connections.reverb.app_id' => 'test']);
        require base_path('routes/channels.php');
        $channel = 'private-campaign.'.$this->campaign->id.'.handouts.user.'.$this->player->id;
        $this->actingAs($this->player)->postJson('/broadcasting/auth', ['socket_id' => '12.34', 'channel_name' => $channel])->assertOk();
        $this->postJson('/broadcasting/auth', ['socket_id' => '12.34', 'channel_name' => 'private-campaign.'.$other->id.'.handouts.user.'.$this->player->id])->assertForbidden();
        $this->actingAs($this->outsider)->postJson('/broadcasting/auth', ['socket_id' => '12.34', 'channel_name' => $channel])->assertForbidden();
        $this->actingAs($this->gm)->postJson('/broadcasting/auth', ['socket_id' => '12.34', 'channel_name' => $channel])->assertForbidden();
    }
}
