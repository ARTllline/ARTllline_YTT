<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\ContentTemplate;
use App\Models\Scene;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

class CreationIdentityTest extends TestCase
{
    use RefreshDatabase;

    private function table(): array
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $player = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Creation QA']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $scene = $campaign->scenes()->create(['name' => 'Table']);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();

        return [$gm, $player, $campaign, $scene];
    }

    public function test_quick_creation_identity_persists_and_is_projected_safely_to_players(): void
    {
        [$gm, $player, $campaign, $scene] = $this->table();
        $base = '/api/scenes/'.$scene->id;
        $token = $this->actingAs($gm)->postJson($base.'/tokens', ['name' => 'Goblin', 'x' => 120, 'y' => 180, 'kind' => 'npc', 'disposition' => 'hostile', 'hp' => 7, 'max_hp' => 7])->assertOk()->assertJsonPath('token.kind', 'npc')->assertJsonPath('token.disposition', 'hostile')->assertJsonPath('token.hp', 7)->json('token');
        $event = Event::dispatched(TabletopEvent::class)->pluck(0)->first(fn ($e) => str_contains($e->channel, '.user.'));
        $this->assertSame('hostile', $event->envelope['payload']['token']['disposition']);
        $this->assertArrayNotHasKey('hp', $event->envelope['payload']['token']);
        $this->actingAs($player)->getJson($base.'/snapshot')->assertJsonPath('tokens.0.disposition', 'hostile')->assertJsonMissingPath('tokens.0.hp');
        $this->postJson($base.'/tokens', ['name' => 'Player attempt', 'x' => 0, 'y' => 0])->assertForbidden();
        $this->patchJson('/api/tokens/'.$token['id'], ['disposition' => 'friendly'])->assertForbidden();
        $this->actingAs($gm)->patchJson('/api/tokens/'.$token['id'], ['kind' => 'player_character', 'disposition' => 'friendly'])->assertOk();
        $this->getJson($base.'/snapshot')->assertJsonPath('tokens.0.kind', 'player_character')->assertJsonPath('tokens.0.disposition', 'friendly');
        Event::fake([TabletopEvent::class]);
        $this->patchJson('/api/tokens/'.$token['id'], ['is_hidden' => true])->assertOk();
        $event = Event::dispatched(TabletopEvent::class)->pluck(0)->first(fn ($e) => str_contains($e->channel, '.user.'));
        $this->assertStringNotContainsString('Goblin', json_encode($event->envelope));
        $this->actingAs($player)->getJson($base.'/snapshot')->assertJsonCount(0, 'tokens');
    }

    public function test_invalid_identity_or_hp_is_atomic_and_does_not_create_a_token(): void
    {
        [$gm, , , $scene] = $this->table();
        $this->actingAs($gm);
        foreach ([['kind' => 'dragon'], ['disposition' => 'enemy'], ['hp' => 11, 'max_hp' => 7]] as $bad) {
            $this->postJson('/api/scenes/'.$scene->id.'/tokens', $bad + ['name' => 'Bad', 'x' => 0, 'y' => 0])->assertUnprocessable();
        }
        $this->assertSame(0, $scene->tokens()->count());
        $this->assertSame(0, $scene->fresh()->revision);
    }

    public function test_encounters_and_duplicates_preserve_identity_and_legacy_templates_still_spawn(): void
    {
        [$gm, , $campaign, $scene] = $this->table();
        $this->actingAs($gm);
        $token = $scene->tokens()->create(['name' => 'Goblin', 'x' => 0, 'y' => 0, 'kind' => 'npc', 'disposition' => 'hostile']);
        $template = $this->postJson('/api/campaigns/'.$campaign->id.'/templates', ['sceneId' => $scene->id, 'kind' => 'encounter', 'name' => 'Patrol', 'tokenIds' => [(string) $token->id], 'propIds' => []])->assertOk()->json('template.id');
        $this->postJson('/api/scenes/'.$scene->id.'/spawn', ['templateId' => $template, 'x' => 100, 'y' => 200])->assertOk()->assertJsonPath('tokens.0.kind', 'npc')->assertJsonPath('tokens.0.disposition', 'hostile');
        $this->postJson('/api/scenes/'.$scene->id.'/selection', ['action' => 'duplicate', 'tokenIds' => [(string) $token->id], 'propIds' => []])->assertOk()->assertJsonPath('tokens.0.disposition', 'hostile');
        $item = ContentTemplate::find($template)->items()->first();
        $data = $item->data;
        unset($data['disposition']);
        $data['kind'] = 'archer';
        $item->update(['data' => $data]);
        $this->postJson('/api/scenes/'.$scene->id.'/spawn', ['templateId' => $template, 'x' => 300, 'y' => 400])->assertOk()->assertJsonPath('tokens.0.kind', 'npc')->assertJsonPath('tokens.0.disposition', 'neutral');
    }

    public function test_visual_scene_creation_checks_map_campaign_and_creates_map_atomically_without_activation(): void
    {
        [$gm, $player, $campaign, $active] = $this->table();
        $asset = Asset::create(['campaign_id' => $campaign->id, 'uploaded_by' => $gm->id, 'kind' => 'map', 'original_name' => 'Map.png', 'storage_path' => 'map.png', 'mime_type' => 'image/png', 'file_size' => 100, 'width' => 1800, 'height' => 1200]);
        $route = '/api/campaigns/'.$campaign->id.'/scenes';
        $id = $this->actingAs($gm)->postJson($route, ['name' => 'Forest', 'mapAssetId' => $asset->id])->assertOk()->json('id');
        $scene = Scene::find($id);
        $this->assertEquals($asset->id, $scene->map_asset_id);
        $this->assertEquals(1800, $scene->width);
        $this->assertEquals(1200, $scene->map_height);
        $this->assertEquals($active->id, $campaign->fresh()->active_scene_id);
        $this->postJson($route, ['name' => 'Blank'])->assertOk();
        $asset->update(['campaign_id' => Campaign::create(['name' => 'Other'])->id]);
        $count = $campaign->scenes()->count();
        $this->postJson($route, ['name' => 'Foreign', 'mapAssetId' => $asset->id])->assertUnprocessable();
        $this->assertSame($count, $campaign->scenes()->count());
        $this->actingAs($player)->postJson($route, ['name' => 'Player scene'])->assertForbidden();
    }
}
