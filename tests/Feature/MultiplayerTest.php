<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\CampaignInvite;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Realtime\ChannelAccess;
use App\Realtime\SafeBroadcast;
use Illuminate\Broadcasting\BroadcastException;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Tests\TestCase;

class MultiplayerTest extends TestCase
{
    use DatabaseMigrations;

    private User $gm;

    private User $player;

    private User $outsider;

    private Campaign $campaign;

    private Scene $scene;

    private Token $token;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->outsider = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Multiplayer']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Public crossing']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->token = $this->scene->tokens()->create(['name' => 'Warden', 'x' => 30, 'y' => 90, 'hp' => 9, 'max_hp' => 20, 'owner_user_id' => $this->player->id]);
        Event::fake([TabletopEvent::class]);
    }

    private function command(array $data = []): array
    {
        return $data + ['clientMutationId' => (string) Str::uuid()];
    }

    private function playerEvents(): array
    {
        return Event::dispatched(TabletopEvent::class)->pluck(0)->filter(fn ($event) => str_contains($event->channel, '.user.'.$this->player->id))->values()->all();
    }

    public function test_invites_are_hashed_limited_idempotent_and_never_grant_gm(): void
    {
        $invite = $this->actingAs($this->gm)->postJson('/api/campaigns/'.$this->campaign->id.'/invites', ['maxUses' => 1])->assertOk()->json();
        $raw = basename($invite['url']);
        $this->assertSame(hash('sha256', $raw), CampaignInvite::find($invite['id'])->token_hash);
        $this->assertStringNotContainsString($raw, json_encode(CampaignInvite::find($invite['id'])->toArray()));
        $this->actingAs($this->outsider)->postJson('/api/invites/'.$raw.'/join', ['role' => 'gm'])->assertOk()->assertJsonPath('role', 'player');
        $this->postJson('/api/invites/'.$raw.'/join')->assertOk();
        $this->assertSame(1, CampaignInvite::find($invite['id'])->uses_count);
        $new = User::factory()->create();
        $this->actingAs($new)->postJson('/api/invites/'.$raw.'/join')->assertUnprocessable();
        $this->actingAs($this->gm)->postJson('/api/invites/'.$raw.'/join')->assertOk()->assertJsonPath('role', 'gm');
        $this->actingAs($this->player)->postJson('/api/campaigns/'.$this->campaign->id.'/invites')->assertForbidden();
        $this->deleteJson('/api/invites/'.$invite['id'])->assertForbidden();
        $this->actingAs($this->gm)->deleteJson('/api/invites/'.$invite['id'])->assertOk();
        $this->actingAs($this->outsider)->postJson('/api/invites/'.$raw.'/join')->assertUnprocessable();
    }

    public function test_expired_and_invalid_invites_fail_and_guest_join_requires_auth(): void
    {
        $invite = $this->actingAs($this->gm)->postJson('/api/campaigns/'.$this->campaign->id.'/invites')->json();
        CampaignInvite::find($invite['id'])->update(['expires_at' => now()->subMinute()]);
        $this->actingAs($this->outsider)->postJson('/api/invites/'.basename($invite['url']).'/join')->assertUnprocessable();
        $this->getJson('/api/invites/'.str_repeat('f', 64))->assertUnprocessable();
        auth()->logout();
        $this->postJson('/api/invites/'.basename($invite['url']).'/join')->assertUnauthorized();
    }

    public function test_private_channels_and_presence_enforce_role_identity_active_scene_and_epoch(): void
    {
        config(['broadcasting.default' => 'reverb', 'broadcasting.connections.reverb.key' => 'test', 'broadcasting.connections.reverb.secret' => 'test', 'broadcasting.connections.reverb.app_id' => 'test']);
        require base_path('routes/channels.php');
        $gm = 'private-'.ChannelAccess::gm($this->campaign->id, $this->scene->id);
        $player = 'private-'.ChannelAccess::player($this->campaign->id, $this->scene->id, 0, $this->player->id);
        $auth = fn ($channel) => $this->postJson('/broadcasting/auth', ['socket_id' => '12.34', 'channel_name' => $channel]);
        $this->actingAs($this->gm);
        $auth($gm)->assertOk();
        $this->actingAs($this->player);
        $auth($gm)->assertForbidden();
        $auth($player)->assertOk();
        $presence = $auth('presence-campaign.'.$this->campaign->id)->assertOk()->json('channel_data');
        $this->assertStringNotContainsString($this->player->email, $presence);
        $this->assertSame(['id', 'name', 'role'], array_keys(json_decode($presence, true)['user_info']));
        $this->actingAs($this->outsider);
        $auth($player)->assertForbidden();
        $auth('presence-campaign.'.$this->campaign->id)->assertForbidden();
        $this->campaign->forceFill(['live_revision' => 1])->save();
        $this->actingAs($this->player);
        $auth($player)->assertForbidden();
        $this->campaign->forceFill(['active_scene_id' => null])->save();
        $auth('private-'.ChannelAccess::player($this->campaign->id, $this->scene->id, 1, $this->player->id))->assertForbidden();
    }

    public function test_player_event_projection_handles_hide_reveal_hidden_edits_and_removal(): void
    {
        $this->actingAs($this->gm)->patchJson('/api/tokens/'.$this->token->id, $this->command(['is_hidden' => true]))->assertOk();
        $events = $this->playerEvents();
        $this->assertSame('token.removed', $events[0]->envelope['type']);
        $this->assertSame(['deletedId' => (string) $this->token->id, 'combat' => null], $events[0]->envelope['payload']);
        $this->patchJson('/api/tokens/'.$this->token->id, $this->command(['name' => 'Secret dragon']))->assertOk();
        $events = $this->playerEvents();
        $this->assertSame('scene.revision', $events[1]->envelope['type']);
        $this->assertSame([], $events[1]->envelope['payload']);
        $this->assertStringNotContainsString('Secret dragon', json_encode($events));
        $this->patchJson('/api/tokens/'.$this->token->id, $this->command(['is_hidden' => false]))->assertOk();
        $event = $this->playerEvents()[2];
        $this->assertSame('token.created', $event->envelope['type']);
        $this->assertTrue($event->envelope['payload']['token']['canMove']);
        foreach (['ownerUserId', 'isHidden', 'isLocked', 'ac', 'speed'] as $key) {
            $this->assertArrayNotHasKey($key, $event->envelope['payload']['token']);
        }
        $this->deleteJson('/api/tokens/'.$this->token->id, $this->command())->assertOk();
        $this->assertSame('token.removed', $this->playerEvents()[3]->envelope['type']);
    }

    public function test_preparation_after_deactivation_never_targets_old_player_channels(): void
    {
        $this->actingAs($this->gm)->postJson('/api/campaigns/'.$this->campaign->id.'/activate', $this->command(['sceneId' => null]))->assertOk();
        $this->patchJson('/api/tokens/'.$this->token->id, $this->command(['name' => 'Future secret']))->assertOk();
        $this->assertCount(0, $this->playerEvents());
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertForbidden();
        $this->get('/campaigns/'.$this->campaign->id.'/play')->assertOk();
        $this->get('/campaigns/'.$this->campaign->id.'/scenes/'.$this->scene->id)->assertForbidden();
    }

    public function test_move_retry_is_exactly_once_and_reusing_id_for_another_payload_conflicts(): void
    {
        $data = $this->command(['x' => 123.25, 'y' => 420]);
        $first = $this->actingAs($this->player)->withHeader('X-Socket-ID', '12.34')->postJson('/api/tokens/'.$this->token->id.'/move', $data)->assertOk()->json();
        $this->postJson('/api/tokens/'.$this->token->id.'/move', $data)->assertOk()->assertHeader('Idempotent-Replay', 'true')->assertExactJson($first);
        $this->assertSame(1, $this->scene->fresh()->revision);
        $this->assertCount(1, $this->playerEvents());
        $this->assertSame('12.34', $this->playerEvents()[0]->socket);
        $this->postJson('/api/tokens/'.$this->token->id.'/move', [...$data, 'x' => 99])->assertConflict();
        $this->token->update(['is_locked' => true]);
        $this->postJson('/api/tokens/'.$this->token->id.'/move', $data)->assertForbidden();
    }

    public function test_delete_retry_survives_route_model_deletion_and_create_retry_does_not_duplicate(): void
    {
        $data = $this->command();
        $this->actingAs($this->gm)->deleteJson('/api/tokens/'.$this->token->id, $data)->assertOk();
        $this->deleteJson('/api/tokens/'.$this->token->id, $data)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $create = $this->command(['x' => 30, 'y' => 30, 'name' => 'Once']);
        $this->postJson('/api/scenes/'.$this->scene->id.'/tokens', $create)->assertOk();
        $this->postJson('/api/scenes/'.$this->scene->id.'/tokens', $create)->assertOk();
        $this->assertSame(1, $this->scene->tokens()->count());
        $this->assertSame(2, $this->scene->fresh()->revision);
    }

    public function test_preview_is_authorized_ephemeral_and_stale_after_final_commit(): void
    {
        $preview = ['x' => 200, 'y' => 250, 'dragSessionId' => (string) Str::uuid(), 'sequence' => 1, 'baseRevision' => 0];
        $this->actingAs($this->player)->postJson('/api/tokens/'.$this->token->id.'/preview', $preview)->assertOk()->assertJsonPath('accepted', true);
        $this->assertSame(0, $this->scene->fresh()->revision);
        $this->assertEquals(30, $this->token->fresh()->x);
        $this->assertSame(0, DB::table('scene_mutation_receipts')->count());
        $this->postJson('/api/tokens/'.$this->token->id.'/move', $this->command(['x' => 210, 'y' => 270, 'dragSessionId' => $preview['dragSessionId']]))->assertOk();
        $this->postJson('/api/tokens/'.$this->token->id.'/preview', [...$preview, 'sequence' => 2])->assertOk()->assertJsonPath('accepted', false);
        $this->token->update(['is_locked' => true]);
        $this->postJson('/api/tokens/'.$this->token->id.'/preview', [...$preview, 'baseRevision' => 1])->assertForbidden();
        $this->actingAs($this->outsider)->postJson('/api/tokens/'.$this->token->id.'/preview', $preview)->assertForbidden();
    }

    public function test_failed_authorization_and_validation_have_no_receipt_or_broadcast(): void
    {
        $this->actingAs($this->outsider)->postJson('/api/tokens/'.$this->token->id.'/move', $this->command(['x' => 2, 'y' => 3]))->assertForbidden();
        $this->actingAs($this->player)->postJson('/api/tokens/'.$this->token->id.'/move', $this->command(['x' => 'bad', 'y' => 3]))->assertUnprocessable();
        $this->assertSame(0, DB::table('scene_mutation_receipts')->count());
        $this->assertSame(0, $this->scene->fresh()->revision);
        Event::assertNotDispatched(TabletopEvent::class);
    }

    public function test_preview_cannot_bypass_ownership_hidden_or_inactive_scene(): void
    {
        $preview = ['x' => 1, 'y' => 2, 'sequence' => 1, 'baseRevision' => 0, 'dragSessionId' => (string) Str::uuid()];
        $this->actingAs($this->player);
        $this->token->update(['owner_user_id' => $this->gm->id]);
        $this->postJson('/api/tokens/'.$this->token->id.'/preview', $preview)->assertForbidden();
        $this->token->update(['owner_user_id' => $this->player->id, 'is_hidden' => true]);
        $this->postJson('/api/tokens/'.$this->token->id.'/preview', $preview)->assertForbidden();
        $this->token->update(['is_hidden' => false]);
        $this->campaign->forceFill(['active_scene_id' => null])->save();
        $this->postJson('/api/tokens/'.$this->token->id.'/preview', $preview)->assertForbidden();
        Event::assertNotDispatched(TabletopEvent::class);
    }

    public function test_receipt_replay_does_not_restore_old_gm_metadata_after_role_change(): void
    {
        $this->token->update(['owner_user_id' => $this->gm->id]);
        $data = $this->command(['x' => 90, 'y' => 90]);
        $this->actingAs($this->gm)->postJson('/api/tokens/'.$this->token->id.'/move', $data)->assertOk()->assertJsonPath('token.hp', 9);
        $this->campaign->members()->updateExistingPivot($this->gm->id, ['role' => 'player']);
        $this->postJson('/api/tokens/'.$this->token->id.'/move', $data)->assertForbidden()->assertJsonMissingPath('token.hp')->assertJsonMissingPath('token.ownerUserId');
        $this->assertSame(1, $this->scene->fresh()->revision);
    }

    public function test_broker_failure_boundary_does_not_turn_commit_notification_into_http_failure(): void
    {
        $event = new TabletopEvent('campaign.1.control', ['type' => 'test']);
        Event::shouldReceive('dispatch')->once()->with($event)->andThrow(new BroadcastException('offline'));
        Log::shouldReceive('warning')->once()->with('Tabletop broadcast unavailable', ['type' => 'test']);
        app(SafeBroadcast::class)->send($event);
        $this->assertTrue(true); // No exception escapes after the database has committed.
    }
}
