<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\SceneNote;
use App\Models\SceneRegion;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class StabilizationTest extends TestCase
{
    use DatabaseMigrations;

    public function test_selective_handout_revoke_and_retry_keep_recipient_boundaries(): void
    {
        Storage::fake('campaigns');
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $one = User::factory()->create();
        $two = User::factory()->create();
        $outsider = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Private table']);
        foreach ([$gm, $one, $two] as $u) {
            $campaign->members()->attach($u, ['role' => $u->id === $gm->id ? 'gm' : 'player']);
        }
        $base = '/api/campaigns/'.$campaign->id;
        $this->actingAs($gm);
        $asset = $this->post($base.'/assets', ['kind' => 'handout', 'file' => UploadedFile::fake()->image('secret-filename.png')], ['Accept' => 'application/json'])->assertOk()->json();
        $handout = $this->postJson($base.'/handouts', ['assetId' => $asset['id'], 'title' => 'Letter'])->assertOk()->json();
        $data = ['handoutId' => $handout['id'], 'recipientIds' => [$one->id], 'clientMutationId' => (string) Str::uuid()];
        $this->postJson($base.'/handouts/show', $data)->assertOk();
        $this->postJson($base.'/handouts/show', $data)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->postJson($base.'/handouts/show', ['handoutId' => $handout['id'], 'recipientIds' => [$outsider->id]])->assertUnprocessable();
        $this->postJson($base.'/handouts/show', ['handoutId' => $handout['id'], 'recipientIds' => []])->assertUnprocessable();
        $this->actingAs($two)->getJson($base.'/handouts')->assertJsonCount(0, 'handouts');
        $this->getJson($base.'/handouts/'.$handout['id'])->assertForbidden();
        $this->get('/api/assets/'.$asset['id'])->assertForbidden();
        $this->actingAs($one)->getJson($base.'/handouts/'.$handout['id'])->assertOk()->assertJsonMissingPath('recipients');
        $this->get('/api/assets/'.$asset['id'])->assertOk();
        $this->postJson($base.'/handouts/revoke', ['handoutId' => $handout['id']])->assertForbidden();
        $this->actingAs($gm)->postJson($base.'/handouts/show', ['handoutId' => $handout['id']])->assertOk();
        $foreignCampaign = Campaign::create(['name' => 'Other GM workspace']);
        $foreignCampaign->members()->attach($outsider, ['role' => 'gm']);
        $this->actingAs($outsider)->getJson($base.'/handouts/'.$handout['id'])->assertForbidden();
        $this->postJson('/api/campaigns/'.$foreignCampaign->id.'/handouts/revoke', ['handoutId' => $handout['id']])->assertNotFound();
        $this->actingAs($gm);
        $this->postJson($base.'/handouts/revoke', ['handoutId' => $handout['id'], 'recipientIds' => [$one->id]])->assertOk();
        $this->actingAs($one)->get('/api/assets/'.$asset['id'])->assertForbidden();
        $this->get('/api/assets/'.$asset['id'].'/thumbnail')->assertForbidden();
        $this->getJson($base.'/handouts')->assertJsonCount(0, 'handouts');
        $this->actingAs($two)->get('/api/assets/'.$asset['id'])->assertOk();
        $campaign->members()->detach($two);
        $this->actingAs($gm)->postJson($base.'/handouts/revoke', ['handoutId' => $handout['id']])->assertOk();
        $campaign->members()->attach($two, ['role' => 'player']);
        $this->actingAs($two)->get('/api/assets/'.$asset['id'])->assertForbidden();
        Event::assertDispatched(TabletopEvent::class, fn ($e) => $e->envelope['type'] === 'handout.revoked' && ! isset($e->envelope['recipients']));
    }

    public function test_inverse_edits_are_atomic_gm_only_compare_and_swap_commands(): void
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $player = User::factory()->create();
        $c = Campaign::create(['name' => 'History']);
        $c->members()->attach($gm, ['role' => 'gm']);
        $c->members()->attach($player, ['role' => 'player']);
        $s = $c->scenes()->create(['name' => 'Table']);
        $c->update(['active_scene_id' => $s->id]);
        $token = $s->tokens()->create(['name' => 'Secret', 'x' => 100, 'y' => 200, 'hp' => 10, 'max_hp' => 10, 'is_hidden' => true]);
        $url = '/api/scenes/'.$s->id.'/edit-history';
        $data = ['changes' => [['kind' => 'token', 'id' => $token->id, 'expected' => ['x' => 100], 'value' => ['x' => 50]]], 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($player)->postJson($url, $data)->assertForbidden();
        $this->actingAs($gm)->postJson($url, $data)->assertOk()->assertJsonPath('revision', 1)->assertJsonPath('tokens.0.x', 50);
        $this->postJson($url, $data)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $data['clientMutationId'] = (string) Str::uuid();
        $this->postJson($url, $data)->assertConflict();
        $this->assertSame(1, $s->fresh()->revision);
        $data['changes'][0]['expected'] = ['x' => 50];
        $data['changes'][0]['value'] = ['x' => 100];
        $this->postJson($url, $data)->assertOk()->assertJsonPath('revision', 2);
        $this->assertSame(10, $token->fresh()->hp);
        $bad = ['changes' => [['kind' => 'token', 'id' => $token->id, 'expected' => ['hp' => 10], 'value' => ['hp' => 1]]]];
        $this->postJson($url, $bad)->assertUnprocessable();
        $foreign = $c->scenes()->create(['name' => 'Other'])->tokens()->create(['name' => 'Other', 'x' => 100, 'y' => 200]);
        $data['clientMutationId'] = (string) Str::uuid();
        $data['changes'][0]['expected'] = ['x' => 100];
        $data['changes'][] = ['kind' => 'token', 'id' => $foreign->id, 'expected' => ['x' => 100], 'value' => ['x' => 50]];
        $this->postJson($url, $data)->assertConflict();
        $this->assertSame(2, $s->fresh()->revision);
        Event::assertNotDispatched(TabletopEvent::class, fn ($e) => str_contains($e->channel, '.user.') && str_contains(json_encode($e->envelope), 'Secret'));
    }

    public function test_private_note_and_region_inverse_does_not_leak_or_fire(): void
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $player = User::factory()->create();
        $c = Campaign::create(['name' => 'History']);
        $c->members()->attach($gm, ['role' => 'gm']);
        $c->members()->attach($player, ['role' => 'player']);
        $s = $c->scenes()->create(['name' => 'Table']);
        $c->update(['active_scene_id' => $s->id]);
        $n = SceneNote::create(['scene_id' => $s->id, 'title' => 'SECRET', 'body' => 'SECRET', 'icon' => 'note', 'x' => 20, 'y' => 20, 'created_by' => $gm->id]);
        $r = SceneRegion::create(['scene_id' => $s->id, 'name' => 'SECRET', 'shape' => 'circle', 'geometry' => ['x' => 20, 'y' => 20, 'radius' => 100], 'enabled' => true]);
        $url = '/api/scenes/'.$s->id.'/edit-history';
        $this->actingAs($gm)->postJson($url, ['changes' => [['kind' => 'note', 'id' => $n->id, 'expected' => ['x' => 20], 'value' => ['x' => 30]]]])->assertOk()->assertJsonPath('note.x', 30);
        $this->postJson($url, ['changes' => [['kind' => 'region', 'id' => $r->id, 'expected' => ['enabled' => true], 'value' => ['enabled' => false]]]])->assertOk()->assertJsonPath('region.enabled', false);
        $this->assertDatabaseCount('trigger_fires', 0);
        Event::assertNotDispatched(TabletopEvent::class, fn ($e) => str_contains($e->channel, '.user.') && str_contains(json_encode($e->envelope), 'SECRET'));
    }
}
