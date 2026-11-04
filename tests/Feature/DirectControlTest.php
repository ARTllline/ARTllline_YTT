<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Combat;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class DirectControlTest extends TestCase
{
    use RefreshDatabase;

    private function fixture(): array
    {
        config(['app.debug' => false]);
        Event::fake([TabletopEvent::class]);
        $this->withoutMiddleware(ThrottleRequests::class);
        $player = User::factory()->create();
        $other = User::factory()->create();
        $campaign = Campaign::create(['name' => 'WASD']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $campaign->members()->attach($other, ['role' => 'gm']);
        $scene = $campaign->scenes()->create(['name' => 'WASD', 'width' => 800, 'height' => 600]);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $token = $scene->tokens()->create(['name' => 'Walker', 'kind' => 'player_character', 'x' => 100, 'y' => 150,
            'size' => 20, 'owner_user_id' => $player->id]);
        $this->actingAs($player);

        return [$player, $other, $campaign, $scene, $token];
    }

    private function open($token): array
    {
        $data = ['streamId' => (string) Str::uuid(), 'clientMutationId' => (string) Str::uuid()];
        $this->postJson("/api/tokens/{$token->id}/control/start", $data)->assertOk()->assertJsonPath('streamId', $data['streamId']);
        // Deterministic server clock credit; no sleeps or live MySQL.
        $state = $token->fresh()->direct_control;
        $state['at'] -= 250;
        $token->update(['direct_control' => $state]);

        return ['streamId' => $data['streamId'], 'sequence' => 1, 'origin' => ['x' => (float) $token->x, 'y' => (float) $token->y],
            'x' => $token->x + 30, 'y' => (float) $token->y, 'clientMutationId' => (string) Str::uuid()];
    }

    public function test_short_steps_use_normal_receipts_and_private_stream_state(): void
    {
        [, , , $scene, $token] = $this->fixture();
        $data = $this->open($token);
        $url = "/api/tokens/{$token->id}/control/step";
        $accepted = $this->postJson($url, $data)->assertOk()->assertJsonPath('token.x', 130)
            ->assertJsonPath('tokenMovements.0.continuous', true)->assertJsonMissingPath('combat')
            ->assertJsonMissingPath('token.direct_control')->json();
        $this->postJson($url, $data)->assertOk()->assertJsonPath('revision', $accepted['revision']);
        $this->assertEquals(130, $token->fresh()->x);
        $data['clientMutationId'] = (string) Str::uuid();
        $this->postJson($url, $data)->assertConflict();
        $this->getJson("/api/scenes/{$scene->id}/snapshot")->assertOk()->assertDontSee('direct_control')->assertDontSee($data['streamId']);
        Event::assertNotDispatched(TabletopEvent::class, fn ($event) => str_contains(json_encode($event->envelope), $data['streamId']));
    }

    public function test_speed_frequency_waypoint_length_and_expiry_are_server_validated(): void
    {
        [, , , , $token] = $this->fixture();
        $url = "/api/tokens/{$token->id}/control/step";
        $data = $this->open($token);
        $this->postJson($url, array_replace($data, ['x' => 126, 'y' => 176]))->assertUnprocessable(); // diagonal > 36
        $this->postJson($url, $data + ['waypoints' => [['x' => 100, 'y' => 180]]])->assertUnprocessable();
        $state = $token->fresh()->direct_control;
        $state['at'] = microtime(true) * 1000;
        $token->update(['direct_control' => $state]);
        $this->postJson($url, $data)->assertStatus(429);
        $state['at'] -= 250;
        $state['expires'] = microtime(true) * 1000 - 1;
        $token->update(['direct_control' => $state]);
        $this->postJson($url, $data)->assertConflict();
        $this->assertEquals(100, $token->fresh()->x);
    }

    public function test_permissions_combat_scene_switch_and_concurrent_gm_edits_revoke_movement(): void
    {
        [$player, $gm, $campaign, $scene, $token] = $this->fixture();
        $data = $this->open($token);
        $url = "/api/tokens/{$token->id}/control/step";
        $stranger = User::factory()->create();
        $this->actingAs($stranger)->postJson($url, $data)->assertForbidden();
        $this->actingAs($gm)->patchJson("/api/tokens/{$token->id}", ['x' => 105, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->assertNull($token->fresh()->direct_control);
        $this->actingAs($player)->postJson($url, $data)->assertConflict();
        $token->refresh();
        $data = $this->open($token);
        $combat = Combat::create(['scene_id' => $scene->id, 'created_by' => $gm->id, 'status' => 'active', 'round' => 1]);
        $this->postJson($url, $data)->assertUnprocessable();
        $combat->update(['status' => 'ended']);
        $campaign->forceFill(['active_scene_id' => null])->save();
        $this->postJson($url, $data)->assertForbidden();
    }

    public function test_current_walls_doors_windows_and_footprint_use_the_shared_sweep(): void
    {
        [, , , $scene, $token] = $this->fixture();
        $graph = json_decode(file_get_contents(base_path('tests/Fixtures/movement.json')), true)['graph'];
        $world = $scene->mapWorld()->create(['structure' => $graph]);
        foreach ([[150, true, false, 20, false], [234, false, false, 20, true], [234, true, false, 20, false],
            [410, false, false, 20, true], [410, false, true, 20, false], [234, false, false, 66, false]] as [$y, $close, $window, $size, $allowed]) {
            $graph['openings'][0]['open'] = ! $close;
            $graph['openings'][1]['blocksMovement'] = $window;
            $world->update(['structure' => $graph]);
            $token->refresh()->update(['x' => 283, 'y' => $y, 'size' => $size]);
            $data = $this->open($token);
            $response = $this->postJson("/api/tokens/{$token->id}/control/step", $data);
            $allowed ? $response->assertOk() : $response->assertUnprocessable()->assertDontSee('wall')->assertDontSee('door');
            $this->assertEquals($allowed ? 313 : 283, $token->fresh()->x);
        }
    }

    public function test_a_new_stream_rejects_old_commands_and_deletion_invalidates_receipts(): void
    {
        [, , , , $token] = $this->fixture();
        $old = $this->open($token);
        $current = $this->open($token);
        $url = "/api/tokens/{$token->id}/control/step";
        $this->postJson($url, $old)->assertConflict();
        $this->postJson($url, $current)->assertOk();
        $this->assertEquals(130, $token->fresh()->x);
        $token->delete();
        $this->postJson($url, $current)->assertNotFound();
    }

    public function test_start_receipts_cannot_revive_a_superseded_stream(): void
    {
        [, , , , $token] = $this->fixture();
        $url = "/api/tokens/{$token->id}/control/start";
        $start = ['streamId' => (string) Str::uuid(), 'clientMutationId' => (string) Str::uuid()];
        $this->postJson($url, $start)->assertOk();
        $this->postJson($url, $start)->assertOk()->assertJsonPath('streamId', $start['streamId']);
        $this->open($token);
        $this->postJson($url, $start)->assertConflict();
    }

    public function test_geometry_is_read_again_after_the_stream_opens(): void
    {
        [, , , $scene, $token] = $this->fixture();
        $graph = json_decode(file_get_contents(base_path('tests/Fixtures/movement.json')), true)['graph'];
        $world = $scene->mapWorld()->create(['structure' => $graph]);
        $token->update(['x' => 283, 'y' => 234]);
        $data = $this->open($token);
        $graph['openings'][0]['open'] = false;
        $world->update(['structure' => $graph]);
        $this->postJson("/api/tokens/{$token->id}/control/step", $data)->assertUnprocessable()
            ->assertJsonPath('message', 'Перемещение недоступно.');
        $this->assertEquals(283, $token->fresh()->x);
        $this->assertEquals(0, $token->fresh()->direct_control['sequence']);
    }

    public function test_route_rate_limit_is_shared_by_starts_and_steps(): void
    {
        [, , , , $token] = $this->fixture();
        $this->withMiddleware(ThrottleRequests::class);
        for ($i = 0; $i < 7; $i++) {
            $this->postJson("/api/tokens/{$token->id}/control/start", [
                'streamId' => (string) Str::uuid(), 'clientMutationId' => (string) Str::uuid(),
            ])->assertOk();
        }
        $this->postJson("/api/tokens/{$token->id}/control/step", [])->assertStatus(429);
    }
}
