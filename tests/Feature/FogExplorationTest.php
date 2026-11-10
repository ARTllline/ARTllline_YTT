<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\User;
use App\Services\StructureData;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class FogExplorationTest extends TestCase
{
    use RefreshDatabase;

    private function fixture(): array
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $p1 = User::factory()->create();
        $p2 = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Fog']);
        foreach ([[$gm, 'gm'], [$p1, 'player'], [$p2, 'player']] as [$user, $role]) {
            $campaign->members()->attach($user, ['role' => $role]);
        }
        $scene = $campaign->scenes()->create(['name' => 'Fog', 'width' => 1000, 'height' => 500, 'vision_enabled' => true]);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $a = $scene->tokens()->create(['name' => 'A', 'kind' => 'player_character', 'owner_user_id' => $p1->id, 'x' => 150, 'y' => 250, 'vision_range' => 100]);
        $b = $scene->tokens()->create(['name' => 'B', 'kind' => 'player_character', 'owner_user_id' => $p2->id, 'x' => 850, 'y' => 250, 'vision_range' => 100]);
        $npc = $scene->tokens()->create(['name' => 'NPC', 'x' => 170, 'y' => 250]);
        $scene->tokens()->create(['name' => 'Secret', 'x' => 155, 'y' => 250, 'is_hidden' => true]);
        $url = "/api/scenes/{$scene->id}";

        return compact('gm', 'p1', 'p2', 'scene', 'campaign', 'a', 'b', 'npc', 'url');
    }

    private function explored(array $memory, float $x, float $y): bool
    {
        $bit = (int) floor($y / $memory['cellSize']) * $memory['width'] + (int) floor($x / $memory['cellSize']);
        $bits = base64_decode($memory['bits']);

        return (bool) (ord($bits[intdiv($bit, 8)]) & (1 << ($bit % 8)));
    }

    public function test_personal_territory_survives_movement_reload_without_retaining_entities(): void
    {
        extract($this->fixture());
        $first = $this->actingAs($p1)->getJson($url.'/snapshot')->assertOk()->json();
        $this->assertTrue($this->explored($first['vision']['explored'], 170, 250));
        $this->assertFalse($this->explored($first['vision']['explored'], 850, 250));
        $this->actingAs($gm)->patchJson('/api/tokens/'.$a->id, ['x' => 500, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $next = $this->actingAs($p1)->getJson($url.'/snapshot')->assertOk()->json();
        $this->assertTrue($this->explored($next['vision']['explored'], 170, 250));
        $this->assertTrue($this->explored($next['vision']['explored'], 500, 250));
        $this->assertFalse($this->explored($next['vision']['explored'], 850, 250));
        $this->assertSame([(string) $a->id], array_column($next['tokens'], 'id'));
        $this->assertStringNotContainsString('Secret', json_encode($next));
        $this->assertSame($next['vision'], $this->getJson($url.'/snapshot')->json('vision'));
        $this->actingAs($gm)->getJson($url.'/snapshot')->assertJsonCount(4, 'tokens')->assertJsonMissingPath('vision.explored');
        $this->assertDatabaseCount('fog_memories', 2);
    }

    public function test_party_memory_does_not_grant_current_vision_or_change_personal_memory(): void
    {
        extract($this->fixture());
        $this->actingAs($p1)->postJson($url.'/vision', ['enabled' => true, 'memoryPolicy' => 'party'])->assertForbidden();
        $this->actingAs($gm)->postJson($url.'/vision', ['enabled' => true, 'memoryPolicy' => 'bogus'])->assertUnprocessable();
        $this->postJson($url.'/vision', ['enabled' => true, 'memoryPolicy' => 'party'])->assertOk();
        $first = $this->actingAs($p1)->getJson($url.'/snapshot')->json();
        $second = $this->actingAs($p2)->getJson($url.'/snapshot')->json();
        $this->assertSame($first['vision']['explored'], $second['vision']['explored']);
        $this->assertTrue($this->explored($first['vision']['explored'], 850, 250));
        $this->assertFalse(in_array((string) $b->id, array_column($first['tokens'], 'id'), true));
        $this->actingAs($gm)->patchJson('/api/tokens/'.$b->id, ['x' => 650, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $events = Event::dispatched(TabletopEvent::class)->map(fn ($args) => $args[0])->filter(fn ($event) => str_ends_with($event->channel, '.user.'.$p1->id) && isset($event->envelope['payload']['vision']['explored']));
        $this->assertNotEmpty($events);
        $this->assertTrue($this->explored($events->last()->envelope['payload']['vision']['explored'], 650, 250));
        $memory = $this->actingAs($p1)->getJson($url.'/snapshot')->json('vision.explored');
        $this->assertTrue($this->explored($memory, 650, 250));
        $this->actingAs($gm)->postJson($url.'/vision', ['enabled' => true, 'memoryPolicy' => 'player'])->assertOk();
        $personal = $this->actingAs($p1)->getJson($url.'/snapshot')->json('vision.explored');
        $this->assertFalse($this->explored($personal, 850, 250));
    }

    public function test_legacy_manual_fog_is_independent_and_disabled_vision_keeps_memory(): void
    {
        extract($this->fixture());
        $scene->update(['fog_base' => 'covered']);
        $before = $this->actingAs($p1)->getJson($url.'/snapshot')->assertJsonPath('fog.base', 'covered')->json('vision.explored');
        $this->actingAs($gm)->postJson($url.'/vision', ['enabled' => false])->assertOk();
        $this->actingAs($p1)->getJson($url.'/snapshot')->assertJsonPath('vision.enabled', false)->assertJsonMissingPath('vision.explored')->assertJsonPath('fog.base', 'covered');
        $this->actingAs($gm)->postJson($url.'/vision', ['enabled' => true])->assertOk();
        $this->assertSame($before, $this->actingAs($p1)->getJson($url.'/snapshot')->json('vision.explored'));
        $this->assertLessThanOrEqual(43692, strlen(DB::table('fog_memories')->first()->bits));
    }

    public function test_manual_reveal_history_never_extends_current_vision_or_writes_memory(): void
    {
        extract($this->fixture());
        $this->actingAs($p1)->getJson($url.'/fog/preview')->assertForbidden();
        $before = [];
        foreach ([$p1, $p2] as $player) {
            $before[$player->id] = $this->actingAs($player)->getJson($url.'/snapshot')->assertOk()->json();
        }
        $memory = DB::table('fog_memories')->orderBy('scope')->get()->all();
        $this->actingAs($gm)->getJson($url.'/fog/preview?player='.$p2->id)
            ->assertOk()->assertJsonPath('player', (string) $p2->id)
            ->assertJsonPath('vision', $before[$p2->id]['vision'])
            ->assertJsonMissingPath('tokens');
        $stroke = ['operation' => 'explore', 'shape' => 'rectangle', 'geometry' => [
            'points' => [['x' => 0, 'y' => 0], ['x' => 1000, 'y' => 500]],
        ]];
        $this->actingAs($p2)->postJson($url.'/fog/actions', $stroke)->assertForbidden();
        $response = $this->actingAs($gm)->postJson($url.'/fog/actions', $stroke)
            ->assertOk()->assertJsonPath('fogPrevious.sequence', 0)->json();
        $head = ['base' => 'clear', 'sequence' => $response['fogAction']['sequence'], 'append' => $stroke];
        $empty = ['base' => 'clear', 'sequence' => 0];
        $history = fn ($expected, $value) => ['changes' => [[
            'kind' => 'fog', 'id' => $scene->id, 'expected' => $expected, 'value' => $value,
        ]]];

        $events = Event::dispatched(TabletopEvent::class)->pluck(0)->filter(fn ($event) => str_contains($event->channel, '.user.'));
        $this->assertCount(2, $events);
        foreach ($events as $event) {
            $payload = $event->envelope['payload'];
            $this->assertSame('explore', $payload['fogAction']['operation']);
            $this->assertArrayNotHasKey('fogPrevious', $payload);
            $this->assertStringNotContainsString('Secret', json_encode($payload));
        }
        foreach ([$p1, $p2] as $player) {
            $this->actingAs($player)->getJson($url.'/snapshot')->assertOk()
                ->assertJsonPath('fog.actions.0.operation', 'explore')
                ->assertJsonPath('vision', $before[$player->id]['vision'])
                ->assertJsonPath('tokens', $before[$player->id]['tokens']);
        }
        $this->postJson($url.'/edit-history', $history($head, $empty))->assertForbidden();
        $this->actingAs($gm)->postJson($url.'/edit-history', $history($head, $empty))
            ->assertOk()->assertJsonPath('fogRemovedSequence', $head['sequence']);
        $this->postJson($url.'/edit-history', $history($head, $empty))->assertConflict();
        $this->postJson($url.'/edit-history', $history($empty, $head))
            ->assertOk()->assertJsonPath('fogAction.operation', 'explore');
        $reset = $this->postJson($url.'/fog/reset', ['base' => 'clear'])
            ->assertOk()->assertJsonPath('fog.actions', [])->json('fogPrevious');
        $this->postJson($url.'/edit-history', $history($empty + ['actions' => []], $reset))
            ->assertOk()->assertJsonPath('fog.actions.0.operation', 'explore');
        $this->postJson($url.'/edit-history', $history($reset, $empty + ['actions' => []]))
            ->assertOk()->assertJsonPath('fog.actions', []);
        $this->assertEquals($memory, DB::table('fog_memories')->orderBy('scope')->get()->all());
    }

    public function test_gm_reset_reseeds_only_current_territory_and_scenes_are_isolated(): void
    {
        extract($this->fixture());
        $this->actingAs($p1)->getJson($url.'/snapshot')->assertOk();
        $this->actingAs($gm)->patchJson('/api/tokens/'.$a->id, ['x' => 500, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->actingAs($p1)->postJson($url.'/vision', ['enabled' => true, 'resetMemory' => true])->assertForbidden();
        $this->actingAs($gm)->postJson($url.'/vision', ['enabled' => true, 'resetMemory' => true])->assertOk();
        $memory = $this->actingAs($p1)->getJson($url.'/snapshot')->json('vision.explored');
        $this->assertFalse($this->explored($memory, 150, 250));
        $this->assertTrue($this->explored($memory, 500, 250));
        $other = $campaign->scenes()->create(['name' => 'Other', 'width' => 1000, 'height' => 500, 'vision_enabled' => true]);
        $campaign->forceFill(['active_scene_id' => $other->id])->save();
        $empty = $this->getJson('/api/scenes/'.$other->id.'/snapshot')->assertOk()->json('vision.explored');
        $this->assertSame(str_repeat("\0", (int) ceil($empty['width'] * $empty['height'] / 8)), base64_decode($empty['bits']));
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $this->assertSame($memory, $this->getJson($url.'/snapshot')->json('vision.explored'));
    }

    public function test_doors_retain_territory_without_current_entities_or_private_geometry(): void
    {
        extract($this->fixture());
        $graph = ['vertices' => [['id' => 'a', 'x' => 220, 'y' => 20], ['id' => 'b', 'x' => 220, 'y' => 480]],
            'edges' => [['id' => 'wall', 'a' => 'a', 'b' => 'b', 'thickness' => 16, 'blocksMovement' => true,
                'blocksVision' => true, 'blocksLight' => false, 'materialVersionId' => null]], 'rooms' => [],
            'openings' => [['id' => 'door', 'edgeId' => 'wall', 'type' => 'door', 'center' => .5, 'width' => 100, 'open' => false, 'locked' => false, 'frame' => 'wood']]];
        $scene->mapWorld()->create(['structure' => $graph]);
        $npc->update(['x' => 300]);
        $a->update(['vision_range' => 200]);
        $closed = $this->actingAs($p1)->getJson($url.'/snapshot')->assertOk()->json();
        $this->assertFalse($this->explored($closed['vision']['explored'], 300, 250));
        foreach ([true, false] as $open) {
            $this->actingAs($gm)->postJson($url.'/structure', ['door' => ['id' => 'door', 'open' => $open],
                'expected' => StructureData::hash(StructureData::graph($scene->fresh())),
                'clientMutationId' => (string) Str::uuid()])->assertOk();
            $snapshot = $this->actingAs($p1)->getJson($url.'/snapshot')->assertOk()->json();
            $this->assertTrue($this->explored($snapshot['vision']['explored'], 300, 250));
            $this->assertSame($open, in_array((string) $npc->id, array_column($snapshot['tokens'], 'id'), true));
            $this->assertSame(['enabled', 'polygons', 'explored'], array_keys($snapshot['vision']));
            $this->assertStringNotContainsString('blocksVision', json_encode($snapshot));
        }
    }
}
