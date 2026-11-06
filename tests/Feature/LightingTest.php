<?php

namespace Tests\Feature;

use App\Actions\SceneTransaction;
use App\Events\TabletopEvent;
use App\Jobs\RefreshSceneLighting;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Scene;
use App\Models\User;
use App\Realtime\SafeBroadcast;
use App\Services\LightRaster;
use App\Services\SceneLighting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class LightingTest extends TestCase
{
    use RefreshDatabase;

    private function fixture(): array
    {
        Event::fake([TabletopEvent::class]);
        Queue::fake([RefreshSceneLighting::class]);
        Cache::flush();
        $gm = User::factory()->create();
        $player = User::factory()->create();
        $outsider = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Lighting']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $scene = $campaign->scenes()->create(['name' => 'Light', 'width' => 800, 'height' => 600]);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $hero = $scene->tokens()->create(['name' => 'Hero', 'kind' => 'player_character', 'owner_user_id' => $player->id, 'x' => 200, 'y' => 300, 'vision_range' => 220]);
        $hidden = $scene->tokens()->create(['name' => 'Secret emitter', 'is_hidden' => true, 'x' => 210, 'y' => 310]);
        $graph = ['vertices' => [['id' => 'a', 'x' => 400, 'y' => 20], ['id' => 'b', 'x' => 400, 'y' => 580]],
            'edges' => [['id' => 'wall', 'a' => 'a', 'b' => 'b', 'thickness' => 16, 'blocksMovement' => false,
                'blocksVision' => false, 'blocksLight' => true, 'materialVersionId' => null]], 'rooms' => [], 'openings' => []];
        $scene->mapWorld()->create(['structure' => $graph]);
        $value = ['enabled' => true, 'mode' => 'night', 'brightness' => .12, 'color' => '#829bd4', 'sources' => [$this->source()]];

        return compact('gm', 'player', 'outsider', 'campaign', 'scene', 'hero', 'hidden', 'graph', 'value');
    }

    private function source(array $patch = []): array
    {
        return array_replace(['id' => 'torch', 'name' => 'Torch', 'enabled' => true, 'x' => 200, 'y' => 300,
            'tokenId' => null, 'radius' => 700, 'color' => '#ffc078', 'intensity' => 1.2, 'falloff' => 1], $patch);
    }

    private function save(Scene $scene, array $value): TestResponse
    {
        return $this->putJson("/api/scenes/{$scene->id}/lighting", ['value' => $value,
            'expected' => SceneLighting::settings($scene->fresh(), true), 'clientMutationId' => (string) Str::uuid()]);
    }

    private function lit(array $render, float $x, float $y, int $source = 0): bool
    {
        $bit = (int) floor($y / $render['cellSize']) * $render['width'] + (int) floor($x / $render['cellSize']);

        $mask = $render['sources'][$source]['mask'];
        $bits = base64_decode(ltrim($mask, '~'));
        if (str_starts_with($mask, '~')) {
            $out = '';
            for ($i = 0; $i < strlen($bits); $i += 3) {
                $run = unpack('vcount/Cvalue', substr($bits, $i, 3));
                $out .= str_repeat(chr($run['value']), $run['count']);
            }
            $bits = $out;
        }

        return (bool) (ord($bits[intdiv($bit, 8)]) & (1 << ($bit % 8)));
    }

    public function test_gm_persistence_conflicts_authorization_and_recipient_safe_realtime(): void
    {
        extract($this->fixture());
        $this->actingAs($player);
        $this->save($scene, $value)->assertForbidden();
        $this->actingAs($outsider)->getJson("/api/scenes/{$scene->id}/lighting")->assertForbidden();
        $this->actingAs($gm);
        $this->save($scene, $value)->assertOk()->assertJsonPath('lighting.mode', 'night')->assertJsonPath('movementGeometryChanged', false);
        $this->getJson("/api/scenes/{$scene->id}/snapshot")->assertJsonPath('lighting.sources.0.name', 'Torch');
        $this->putJson("/api/scenes/{$scene->id}/lighting", ['value' => $value, 'expected' => SceneLighting::defaults(), 'clientMutationId' => (string) Str::uuid()])->assertConflict();
        $events = Event::dispatched(TabletopEvent::class)->map(fn ($v) => $v[0]);
        $playerEvent = $events->first(fn ($e) => str_ends_with($e->channel, '.user.'.$player->id));
        $this->assertArrayNotHasKey('sources', $playerEvent->envelope['payload']['lighting']);
        $this->actingAs($player)->getJson("/api/scenes/{$scene->id}/snapshot")->assertJsonMissingPath('lighting.sources');
        $campaign->forceFill(['active_scene_id' => null])->save();
        $this->getJson("/api/scenes/{$scene->id}/lighting")->assertForbidden();
    }

    public function test_blocks_light_is_independent_and_door_window_and_transformed_prop_cast_shadows(): void
    {
        extract($this->fixture());
        $this->actingAs($gm);
        $this->save($scene, $value)->assertOk();
        $url = "/api/scenes/{$scene->id}/lighting";
        $render = $this->getJson($url)->assertOk()->json();
        $this->assertTrue($this->lit($render, 300, 300));
        $this->assertFalse($this->lit($render, 500, 300));
        $graph['edges'][0]['blocksLight'] = false;
        $graph['edges'][0]['blocksVision'] = true;
        $scene->mapWorld->update(['structure' => $graph]);
        $this->assertTrue($this->lit($this->getJson($url)->json(), 500, 300));
        $graph['edges'][0]['blocksLight'] = true;
        $graph['openings'] = [['id' => 'door', 'edgeId' => 'wall', 'type' => 'door', 'center' => .5, 'width' => 100, 'open' => false]];
        $scene->mapWorld->update(['structure' => $graph]);
        $this->assertFalse($this->lit($this->getJson($url)->json(), 500, 300));
        $graph['openings'][0]['open'] = true;
        $scene->mapWorld->update(['structure' => $graph]);
        $this->assertTrue($this->lit($this->getJson($url)->json(), 500, 300));
        $graph['openings'][0] = ['id' => 'window', 'edgeId' => 'wall', 'type' => 'window', 'center' => .5, 'width' => 100,
            'blocksMovement' => true, 'blocksVision' => true, 'blocksLight' => false];
        $scene->mapWorld->update(['structure' => $graph]);
        $this->assertTrue($this->lit($this->getJson($url)->json(), 500, 300));
        $graph['openings'][0]['blocksLight'] = true;
        $graph['openings'][0]['blocksVision'] = false;
        $scene->mapWorld->update(['structure' => $graph]);
        $this->assertFalse($this->lit($this->getJson($url)->json(), 500, 300));
        $scene->mapWorld->update(['structure' => ['vertices' => [], 'edges' => [], 'rooms' => []]]);
        // Direct persisted snapshot, same collider contract as ObjectPreset placement.
        $asset = Asset::create(['campaign_id' => $campaign->id, 'uploaded_by' => $gm->id, 'kind' => 'prop', 'name' => 'Prop', 'original_name' => 'test.png', 'storage_path' => 'private/test.png', 'mime_type' => 'image/png', 'file_size' => 1, 'width' => 100, 'height' => 100]);
        $scene->props()->create(['asset_id' => $asset->id, 'x' => 400, 'y' => 300, 'rotation' => 35, 'scale_x' => 1, 'scale_y' => 1,
            'preset_snapshot' => ['width' => 100, 'height' => 150, 'pivotX' => .5, 'pivotY' => .5, 'collider' => ['type' => 'rectangle', 'width' => 100, 'height' => 150, 'x' => 0, 'y' => 0, 'blocksMovement' => false, 'blocksVision' => false, 'blocksLight' => true]]]);
        $this->assertFalse($this->lit($this->getJson($url)->json(), 500, 300));
    }

    public function test_no_hidden_emitters_or_unseen_shadow_geometry_and_read_does_not_mutate_fog(): void
    {
        extract($this->fixture());
        $scene->update(['vision_enabled' => true]);
        $value['sources'][] = $this->source(['id' => 'secret', 'tokenId' => (string) $hidden->id]);
        $value['sources'][] = $this->source(['id' => 'unseen', 'x' => 650]);
        $this->actingAs($gm);
        $this->save($scene, $value)->assertOk();
        $this->actingAs($player)->getJson("/api/scenes/{$scene->id}/snapshot")->assertOk();
        $rows = DB::table('fog_memories')->get()->toArray();
        $render = $this->getJson("/api/scenes/{$scene->id}/lighting")->assertOk()->assertJsonCount(1, 'sources')->json();
        $this->assertTrue($this->lit($render, 240, 300));
        $this->assertFalse($this->lit($render, 350, 500));
        $json = json_encode($render);
        foreach (['secret', 'unseen', 'blocksLight', 'blocksVision', 'geometryKey', 'points', 'Torch'] as $private) {
            $this->assertStringNotContainsString($private, $json);
        }
        $this->assertEquals($rows, DB::table('fog_memories')->get()->toArray());
    }

    public function test_attachment_validation_follow_hide_delete_and_disabled_legacy_scene(): void
    {
        extract($this->fixture());
        $this->actingAs($gm);
        $this->getJson("/api/scenes/{$scene->id}/lighting")->assertOk()->assertJsonPath('settings.enabled', false)->assertJsonCount(0, 'sources');
        $value['sources'][0]['tokenId'] = (string) $hero->id;
        $this->save($scene, $value)->assertOk();
        $hero->update(['x' => 250]);
        $this->getJson("/api/scenes/{$scene->id}/lighting")->assertJsonPath('sources.0.x', 250);
        $hero->update(['is_hidden' => true]);
        $this->actingAs($player)->getJson("/api/scenes/{$scene->id}/lighting")->assertJsonCount(0, 'sources');
        $hero->delete();
        $this->actingAs($gm)->getJson("/api/scenes/{$scene->id}/lighting")->assertJsonCount(0, 'sources');
        $other = $campaign->scenes()->create(['name' => 'Other'])->tokens()->create(['name' => 'Other', 'x' => 50, 'y' => 50]);
        $value['sources'][0]['tokenId'] = $other->id;
        $this->save($scene, $value)->assertUnprocessable();
        $value['sources'] = array_map(fn ($i) => $this->source(['id' => 'source'.$i]), range(1, 17));
        $this->save($scene, $value)->assertUnprocessable();
    }

    public function test_scan_conversion_preserves_empty_and_overlapping_union(): void
    {
        $square = [['x' => 0, 'y' => 0], ['x' => 16, 'y' => 0], ['x' => 16, 'y' => 16], ['x' => 0, 'y' => 16]];
        $this->assertSame("\0\0", LightRaster::polygons([], 4, 4, 4));
        $this->assertSame("\xff\xff", LightRaster::polygons([$square, $square], 4, 4, 4));
    }

    public function test_accepted_movement_publishes_recipient_safe_light_without_new_revisions(): void
    {
        extract($this->fixture());
        $scene->update(['vision_enabled' => true]);
        $value['sources'][0]['tokenId'] = (string) $hero->id;
        $this->actingAs($gm);
        $this->save($scene, $value)->assertOk();
        $revision = $scene->fresh()->revision;
        Event::fake([TabletopEvent::class]);
        $move = $this->actingAs($player)->postJson("/api/tokens/{$hero->id}/move", ['x' => 230, 'y' => 300,
            'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('revision', $revision + 1)
            ->assertJsonMissingPath('lightingRender')->json();
        $this->assertFalse($move['movementGeometryChanged']);
        $this->assertSame($revision + 1, $scene->fresh()->revision);
        Queue::assertPushed(RefreshSceneLighting::class, 1); // pending work coalesces to latest state
        (new RefreshSceneLighting($scene->id))->handle(app(SceneLighting::class), app(SafeBroadcast::class));
        $frames = Event::dispatched(TabletopEvent::class)->pluck(0)->filter(fn ($e) => $e->envelope['type'] === 'lighting.frame');
        $this->assertCount(2, $frames);
        foreach ($frames as $event) {
            $this->assertEquals($revision + 1, $event->envelope['revision']);
            if (str_ends_with($event->channel, '.user.'.$player->id)) {
                $this->assertArrayNotHasKey('sources', $event->envelope['render']['settings']);
                $this->assertEquals(230, $event->envelope['render']['sources'][0]['x']);
            }
        }
        $value['sources'] = [];
        $value['enabled'] = false;
        $this->actingAs($gm);
        $this->save($scene, $value)->assertOk()->assertJsonPath('lighting.enabled', false);
    }

    public function test_observer_removal_and_world_resize_refresh_visual_state(): void
    {
        extract($this->fixture());
        $scene->update(['vision_enabled' => true, 'lighting' => $value]);
        $this->actingAs($gm)->patchJson("/api/tokens/{$hero->id}", ['kind' => 'npc', 'clientMutationId' => (string) Str::uuid()])->assertOk();
        Queue::assertPushed(RefreshSceneLighting::class);
        Queue::fake([RefreshSceneLighting::class]);
        Cache::flush();
        app(SceneTransaction::class)->run($scene->fresh(), function ($locked) {
            $locked->update(['width' => 900]);

            return ['scene' => ['width' => 900]];
        });
        Queue::assertPushed(RefreshSceneLighting::class);
        $render = $this->getJson("/api/scenes/{$scene->id}/lighting")->assertOk()->json();
        $this->assertEquals(900, $render['width'] * $render['cellSize']);
    }

    public function test_unseen_public_light_spills_through_vision_only_wall_without_disclosing_its_source(): void
    {
        extract($this->fixture());
        $graph['edges'][0]['blocksVision'] = true;
        $graph['edges'][0]['blocksLight'] = false;
        $scene->mapWorld->update(['structure' => $graph]);
        $scene->update(['vision_enabled' => true]);
        $hero->update(['vision_range' => 700]);
        $value['sources'] = [$this->source(['id' => 'unseen-public', 'name' => 'Unseen torch', 'x' => 600, 'radius' => 800]),
            $this->source(['id' => 'gm-hidden', 'tokenId' => (string) $hidden->id])];
        $this->actingAs($gm);
        $this->save($scene, $value)->assertOk();
        $render = $this->actingAs($player)->getJson("/api/scenes/{$scene->id}/lighting")->assertOk()->assertJsonCount(0, 'sources')->json();
        $pixels = gzuncompress(base64_decode($render['spill']));
        $sample = function ($x, $y) use ($render, $pixels) {
            return ord($pixels[((int) floor($y / $render['cellSize']) * $render['width'] + (int) floor($x / $render['cellSize'])) * 4]);
        };
        $this->assertGreaterThan(100, $sample(200, 300));
        $this->assertSame(0, $sample(650, 300), 'Unseen pixels are never sent in an irradiance field');
        $this->assertStringNotContainsString('unseen-public', json_encode($render));
        $this->assertStringNotContainsString('gm-hidden', json_encode($render));
        $value['sources'][1]['enabled'] = false;
        $this->actingAs($gm);
        $this->save($scene, $value)->assertOk();
        $withoutHidden = $this->actingAs($player)->getJson("/api/scenes/{$scene->id}/lighting")->assertOk()->json();
        $this->assertSame($render['spill'], $withoutHidden['spill'], 'GM-hidden light contributes no pixels');
    }

    public function test_darkness_realtime_targeting_and_memory_use_the_same_light_blockers(): void
    {
        extract($this->fixture());
        $scene->update(['vision_enabled' => true, 'lighting' => $value]);
        $ability = ['id' => (string) Str::uuid(), 'name' => 'Test', 'target' => 'token', 'enabled' => true];
        $hero->update(['vision_range' => 600, 'abilities' => [$ability]]);
        $target = $scene->tokens()->create(['name' => 'Target across wall', 'x' => 500, 'y' => 300]);
        $url = "/api/scenes/{$scene->id}";
        $this->actingAs($player)->getJson($url.'/snapshot')->assertJsonPath('tokens.1.name', $target->name);

        $value['brightness'] = 0;
        $value['sources'][] = $this->source(['id' => 'secret', 'tokenId' => (string) $hidden->id]);
        Event::fake([TabletopEvent::class]);
        $this->actingAs($gm);
        $this->save($scene, $value)->assertOk();
        $payload = Event::dispatched(TabletopEvent::class)->pluck(0)
            ->first(fn ($e) => str_ends_with($e->channel, '.user.'.$player->id))->envelope['payload'];
        $this->assertSame([(string) $target->id], $payload['deletedIds']);
        $this->assertArrayHasKey('raster', $payload['vision']);
        $this->assertStringNotContainsString($target->name, json_encode($payload));
        $this->getJson($url.'/snapshot')->assertJsonPath('tokens.2.name', $target->name);
        $dark = $this->actingAs($player)->getJson($url.'/snapshot')->assertJsonCount(1, 'tokens')->json('vision');
        $epoch = $campaign->fresh()->live_revision;
        $this->postJson($url.'/interact', ['kind' => 'token', 'id' => $target->id,
            'epoch' => $epoch, 'clientMutationId' => (string) Str::uuid()])->assertNotFound();
        $this->postJson($url.'/abilities/execute', ['actorTokenId' => $hero->id, 'abilityId' => $ability['id'],
            'target' => ['kind' => 'token', 'id' => $target->id], 'rollMode' => 'normal',
            'epoch' => $epoch, 'clientMutationId' => (string) Str::uuid()])->assertNotFound();

        $value['sources'][] = $this->source(['id' => 'far-torch', 'x' => 560, 'radius' => 150]);
        $this->actingAs($gm);
        $this->save($scene, $value)->assertOk();
        $this->actingAs($player)->getJson($url.'/snapshot')->assertJsonPath('tokens.1.name', $target->name)
            ->assertJsonPath('vision.explored.bits', $dark['explored']['bits']);
        $this->getJson($url.'/lighting')->assertJsonCount(2, 'sources')->assertJsonMissing(['id' => 'secret']);
    }
}
