<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\Scene;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class SceneEncounterTest extends TestCase
{
    use DatabaseMigrations;

    private User $gm;

    private User $player;

    private Scene $scene;

    private string $path;

    private array $ids;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Encounters']);
        $campaign->members()->attach($this->gm, ['role' => 'gm']);
        $campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $campaign->scenes()->create(['name' => 'Preparation']);
        $campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->path = '/api/scenes/'.$this->scene->id;
        $this->ids = collect([1, 2, 3])->map(fn ($n) => (string) $this->scene->tokens()->create(['name' => 'Guard '.$n, 'kind' => 'npc', 'x' => $n * 100, 'y' => 100])->id)->all();
        $this->actingAs($this->gm);
    }

    protected function tearDown(): void
    {
        DB::table('scene_mutation_receipts')->whereNull('campaign_id')->delete();
        Character::whereNull('campaign_id')->delete();
        parent::tearDown();
    }

    private function value(): array
    {
        return ['name' => 'Ambush secret', 'status' => 'ready', 'groups' => [
            ['id' => 'main', 'name' => 'Main', 'tokenIds' => array_slice($this->ids, 0, 2)],
            ['id' => 'reserve', 'name' => 'Reinforcements secret', 'tokenIds' => [$this->ids[2]]],
        ]];
    }

    private function save(?array $expected, ?array $value, ?string $id = null): array
    {
        return $this->postJson($this->path.'/encounters', ['id' => $id ?? $expected['id'] ?? (string) Str::uuid(), 'expected' => $expected, 'value' => $value, 'clientMutationId' => (string) Str::uuid()])->assertOk()->json();
    }

    public function test_composition_reload_revision_replay_and_player_privacy(): void
    {
        $command = ['id' => (string) Str::uuid(), 'expected' => null, 'value' => $this->value(), 'clientMutationId' => (string) Str::uuid()];
        $r = $this->postJson($this->path.'/encounters', $command)->assertOk()->assertJsonPath('revision', 1)->json();
        $this->postJson($this->path.'/encounters', $command)->assertOk()->assertHeader('Idempotent-Replay', 'true')->assertJsonPath('revision', 1);
        $this->getJson($this->path.'/snapshot')->assertOk()->assertJsonPath('encounters', $r['encounters']);
        $this->assertSame(3, $this->scene->tokens()->count());
        $this->assertDatabaseCount('combats', 0);
        $playerEvents = Event::dispatched(TabletopEvent::class)->pluck(0)->filter(fn ($e) => str_contains($e->channel, '.user.'));
        $this->assertNotEmpty($playerEvents);
        foreach ($playerEvents as $event) {
            $this->assertStringNotContainsString('secret', json_encode($event->envelope));
            $this->assertSame('scene.revision', $event->envelope['type']);
        }
        $this->actingAs($this->player)->getJson($this->path.'/snapshot')->assertOk()->assertJsonMissingPath('encounters');
        $this->postJson($this->path.'/encounters', $command)->assertForbidden();
        $this->actingAs(User::factory()->create())->postJson($this->path.'/encounters', $command)->assertForbidden();
        // A saved GM receipt is reauthorized after a role change.
        $this->scene->campaign->members()->updateExistingPivot($this->gm->id, ['role' => 'player']);
        $this->actingAs($this->gm)->postJson($this->path.'/encounters', $command)->assertForbidden();
    }

    public function test_membership_edits_do_not_delete_entities_and_stale_writes_reject(): void
    {
        $e = $this->save(null, $this->value())['encounters'][0];
        $next = $e;
        $next['name'] = 'Revised';
        $next['groups'][0]['tokenIds'] = [$this->ids[1]];
        $updated = $this->save($e, $next)['encounters'][0];
        $this->assertSame(3, $this->scene->tokens()->count());
        $this->postJson($this->path.'/encounters', ['id' => $e['id'], 'expected' => $e, 'value' => $next])->assertConflict();
        $this->save($updated, null);
        $this->assertSame(3, $this->scene->tokens()->count());
        $this->getJson($this->path.'/snapshot')->assertJsonPath('encounters', []);
    }

    public function test_cross_scene_duplicate_members_and_invalid_groups_are_atomic(): void
    {
        $other = $this->scene->campaign->scenes()->create(['name' => 'Other']);
        $foreign = $other->tokens()->create(['name' => 'Foreign', 'x' => 1, 'y' => 1]);
        $invalid = $this->value();
        $invalid['groups'][1]['tokenIds'] = [(string) $foreign->id];
        foreach ([$invalid, array_replace($this->value(), ['groups' => [array_replace($this->value()['groups'][0], ['tokenIds' => [$this->ids[0], $this->ids[0]]])]])] as $value) {
            $this->postJson($this->path.'/encounters', ['id' => (string) Str::uuid(), 'expected' => null, 'value' => $value])->assertUnprocessable();
        }
        $this->assertSame(0, $this->scene->fresh()->revision);
        $this->assertDatabaseCount('scene_encounters', 0);
    }

    public function test_encounter_history_create_edit_delete_and_conflict(): void
    {
        $e = $this->save(null, $this->value())['encounters'][0];
        $history = fn ($expected, $value) => $this->postJson($this->path.'/edit-history', ['changes' => [['kind' => 'encounter', 'id' => $e['id'], 'expected' => ['encounter' => $expected], 'value' => ['encounter' => $value]]]]);
        $history($e, null)->assertOk()->assertJsonPath('deletedEncounterId', $e['id']);
        $history(null, $e)->assertOk()->assertJsonPath('encounters.0', $e);
        $next = $e;
        $next['name'] = 'Changed';
        $this->save($e, $next);
        $history($e, null)->assertConflict();
    }

    public function test_prep02_duplicate_excludes_membership_delete_and_history_restore_it(): void
    {
        $e = $this->save(null, $this->value())['encounters'][0];
        $duplicate = $this->postJson($this->path.'/selection', ['action' => 'duplicate', 'tokenIds' => [$this->ids[0]], 'propIds' => []])->assertOk()->json();
        $this->getJson($this->path.'/snapshot')->assertJsonPath('encounters.0', $e);
        $this->assertNotContains($duplicate['tokens'][0]['id'], $e['groups'][0]['tokenIds']);
        $removed = $this->postJson($this->path.'/selection', ['action' => 'delete', 'tokenIds' => [$this->ids[0]], 'propIds' => []])->assertOk()->json();
        $this->assertSame([$this->ids[1]], $removed['encounters'][0]['groups'][0]['tokenIds']);
        $this->postJson($this->path.'/edit-history', ['changes' => [['kind' => 'selectionPresence', 'id' => (string) $this->scene->id,
            'expected' => $removed['selectionEdit'], 'value' => array_replace($removed['selectionEdit'], ['present' => true])]]])->assertOk()->assertJsonPath('encounters.0', $e);
        $this->deleteJson('/api/tokens/'.$this->ids[0])->assertOk()->assertJsonPath('encounters.0.groups.0.tokenIds', [$this->ids[1]]);
    }

    public function test_reserve_library_placement_is_hidden_from_first_event_and_keeps_template_independent(): void
    {
        $e = $this->save(null, $this->value())['encounters'][0];
        $npc = $this->postJson('/api/library/npcs', ['name' => 'Library guard', 'hp' => 10, 'max_hp' => 10])->assertOk()->json('character');
        Event::fake([TabletopEvent::class]);
        $r = $this->postJson($this->path.'/npcs', ['npcId' => $npc['id'], 'x' => 200, 'y' => 200, 'encounter' => ['id' => $e['id'], 'groupId' => 'reserve']])->assertOk()->assertJsonPath('token.isHidden', true)->json();
        $this->assertNotSame($npc['id'], $r['token']['characterId']);
        $this->assertContains($r['token']['id'], $r['encounters'][0]['groups'][1]['tokenIds']);
        foreach (Event::dispatched(TabletopEvent::class)->pluck(0)->filter(fn ($e) => str_contains($e->channel, '.user.')) as $event) {
            $this->assertStringNotContainsString('Library guard', json_encode($event->envelope));
            $this->assertArrayNotHasKey('encounters', (array) $event->envelope['payload']);
        }
        $before = $this->scene->tokens()->count();
        $this->postJson($this->path.'/npcs', ['npcId' => $npc['id'], 'x' => 0, 'y' => 0, 'encounter' => ['id' => $e['id'], 'groupId' => 'deleted-group']])->assertConflict();
        $this->assertSame($before, $this->scene->tokens()->count());
    }

    public function test_vision_projection_never_includes_preparation_and_empty_main_becomes_draft(): void
    {
        $this->scene->forceFill(['vision_enabled' => true])->save();
        $e = $this->save(null, $this->value())['encounters'][0];
        foreach (Event::dispatched(TabletopEvent::class)->pluck(0)->filter(fn ($e) => str_contains($e->channel, '.user.')) as $event) {
            $this->assertSame('vision.updated', $event->envelope['type']);
            $this->assertArrayNotHasKey('encounters', (array) $event->envelope['payload']);
            $this->assertStringNotContainsString('secret', json_encode($event->envelope));
        }
        $this->actingAs($this->player)->getJson($this->path.'/snapshot')->assertOk()->assertJsonMissingPath('encounters');
        $this->actingAs($this->gm)->postJson($this->path.'/selection', ['action' => 'delete', 'tokenIds' => $e['groups'][0]['tokenIds'], 'propIds' => []])->assertOk()->assertJsonPath('encounters.0.status', 'draft');
        $this->getJson($this->path.'/snapshot')->assertOk()->assertJsonPath('encounters.0.status', 'draft');
    }

    public function test_presence_restore_refuses_deleted_encounter_dependency_without_partial_restore(): void
    {
        $e = $this->save(null, $this->value())['encounters'][0];
        $r = $this->postJson($this->path.'/selection', ['action' => 'delete', 'tokenIds' => [$this->ids[2]], 'propIds' => []])->assertOk()->json();
        $this->save($r['encounters'][0], null);
        $this->postJson($this->path.'/edit-history', ['changes' => [['kind' => 'selectionPresence', 'id' => (string) $this->scene->id,
            'expected' => $r['selectionEdit'], 'value' => array_replace($r['selectionEdit'], ['present' => true])]]])->assertConflict();
        $this->assertDatabaseMissing('tokens', ['id' => $this->ids[2]]);
        $this->assertDatabaseMissing('scene_encounters', ['id' => $e['id']]);
    }
}
