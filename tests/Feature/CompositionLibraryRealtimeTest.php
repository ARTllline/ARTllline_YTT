<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class CompositionLibraryRealtimeTest extends TestCase
{
    use DatabaseMigrations;

    protected function tearDown(): void
    {
        // This migration suite intentionally refuses rollback with global receipts.
        DB::table('scene_mutation_receipts')->whereNull('campaign_id')->delete();
        parent::tearDown();
    }

    public function test_committed_catalog_commands_notify_only_the_owner_once_and_channel_auth_is_private(): void
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $other = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Source']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $scene = $campaign->scenes()->create(['name' => 'Composition']);
        $prop = $scene->props()->create(['name' => 'Crate', 'x' => 10, 'y' => 20]);
        $this->actingAs($gm);
        $data = ['name' => 'Crates', 'tokenIds' => [], 'propIds' => [$prop->id], 'expectedRevision' => 0, 'clientMutationId' => (string) Str::uuid()];
        $path = '/api/scenes/'.$scene->id.'/composition-presets';
        $preset = $this->postJson($path, $data)->assertOk()->json('preset');
        $this->postJson($path, $data)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $path = '/api/library/compositions/'.$preset['id'].'/command';
        $this->postJson($path, ['action' => 'rename', 'name' => 'Supplies', 'expectedRevision' => 1])->assertOk();
        $this->postJson($path, ['action' => 'duplicate', 'expectedRevision' => 2])->assertOk();
        $this->postJson($path, ['action' => 'delete', 'expectedRevision' => 2])->assertOk();
        $events = Event::dispatched(TabletopEvent::class)->pluck(0);
        $this->assertCount(4, $events);
        foreach ($events as $event) {
            $this->assertSame('library.'.$gm->id.'.compositions', $event->channel);
            $this->assertSame('composition-library.changed', $event->envelope['type']);
            $this->assertIsInt($event->envelope['revision']);
            $this->assertArrayNotHasKey('snapshot', $event->envelope);
        }
        config(['broadcasting.default' => 'reverb', 'broadcasting.connections.reverb.key' => 'test', 'broadcasting.connections.reverb.secret' => 'test', 'broadcasting.connections.reverb.app_id' => 'test']);
        require base_path('routes/channels.php');
        $auth = ['socket_id' => '12.34', 'channel_name' => 'private-library.'.$gm->id.'.compositions'];
        $this->postJson('/broadcasting/auth', $auth)->assertOk();
        $this->actingAs($other)->postJson('/broadcasting/auth', $auth)->assertForbidden();
    }
}
