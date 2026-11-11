<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Combat;
use App\Models\Scene;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class EncounterCombatTest extends TestCase
{
    use DatabaseMigrations;

    private User $gm;

    private array $players;

    private Scene $scene;

    private array $ids;

    private array $encounter;

    private string $path;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        $users = User::factory()->count(3)->create()->all();
        $this->gm = array_shift($users);
        $this->players = $users;
        $campaign = Campaign::create(['name' => 'Encounter runtime']);
        $campaign->members()->attach($this->gm, ['role' => 'gm']);
        foreach ($this->players as $player) {
            $campaign->members()->attach($player, ['role' => 'player']);
        }
        $this->scene = $campaign->scenes()->create(['name' => 'Arena', 'width' => 2000, 'height' => 2000]);
        $campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->path = '/api/scenes/'.$this->scene->id;
        $this->ids = [];
        foreach (['main', 'reserve1', 'reserve2', 'hero1', 'hero2'] as $i => $name) {
            $character = $i >= 3 ? $campaign->characters()->create(['name' => $name, 'kind' => 'player_character', 'owner_user_id' => $this->players[$i - 3]->id, 'hp' => 7, 'max_hp' => 20]) : null;
            // Linked kinds and RPG state belong to Character; legacy token columns differ.
            $this->ids[] = (string) $this->scene->tokens()->create(['name' => $name, 'kind' => 'npc', 'character_id' => $character?->id,
                'owner_user_id' => $i >= 3 ? $this->players[$i - 3]->id : null, 'x' => 100 + $i * 60, 'y' => 100,
                'hp' => 7, 'max_hp' => 20, 'is_hidden' => $i === 1 || $i === 2])->id;
        }
        $this->actingAs($this->gm);
        $this->encounter = $this->postJson($this->path.'/encounters', ['id' => (string) Str::uuid(), 'expected' => null, 'value' => [
            'name' => 'SECRET ambush', 'status' => 'ready', 'groups' => [
                ['id' => 'main', 'name' => 'Main', 'tokenIds' => [$this->ids[0]]],
                ['id' => 'reserve', 'name' => 'SECRET reserves', 'tokenIds' => [$this->ids[1], $this->ids[2]]],
            ],
        ]])->assertOk()->json('encounters.0');
    }

    private function intent(string $action = 'start', ?string $combat = null): array
    {
        return ['id' => $this->encounter['id'], 'action' => $action, 'expected' => $this->encounter,
            'expectedCombatId' => $combat, 'clientMutationId' => (string) Str::uuid()];
    }

    private function runtime(array $input)
    {
        return $this->postJson($this->path.'/encounters/combat', $input);
    }

    private function combat(string $id, string $action, array $data = [])
    {
        return $this->postJson($this->path.'/combat/'.$action, $data + ['combatId' => $id, 'clientMutationId' => (string) Str::uuid()]);
    }

    public function test_launch_uses_one_scene_revision_existing_instances_and_normal_turn_initialization(): void
    {
        $revision = $this->scene->fresh()->revision;
        $result = $this->runtime($this->intent() + ['playerTokenIds' => [$this->ids[3], $this->ids[4]]])->assertOk()->json();
        $this->assertSame($revision + 1, $result['revision']);
        $this->assertSame('active', $result['combat']['status']);
        $this->assertSame(1, $result['combat']['round']);
        $this->assertSame([$this->ids[0], $this->ids[3], $this->ids[4]], array_column($result['combat']['combatants'], 'tokenId'));
        $this->assertSame([null, null, null], array_column($result['combat']['combatants'], 'initiative'));
        $this->assertSame($result['combat']['combatants'][0]['id'], $result['combat']['currentTurn']['combatantId']);
        $this->assertDatabaseCount('tokens', 5);
        $this->assertDatabaseCount('combats', 1);
        $this->assertDatabaseCount('scene_encounter_runs', 1);
        $this->assertDatabaseCount('combatants', 3);
        $this->assertSame(1, DB::table('combat_events')->where('type', 'combat.started')->count());
        foreach ($this->scene->tokens()->get() as $token) {
            $this->assertSame(7, $token->hp);
        }
        foreach (Combat::first()->combatants as $actor) {
            $this->assertTrue($actor->action_available);
            $this->assertTrue($actor->reaction_available);
            $this->assertSame(0.0, $actor->movement_spent);
        }
        $this->getJson($this->path.'/snapshot')->assertJsonPath('encounterRuns', $result['encounterRuns'])->assertJsonPath('combat', $result['combat']);
    }

    public function test_reinforcements_preserve_turn_round_order_budgets_hp_and_manual_initiative(): void
    {
        $combat = $this->runtime($this->intent() + ['playerTokenIds' => [$this->ids[3]]])->assertOk()->json('combat');
        $id = $combat['id'];
        $first = $combat['combatants'][0]['id'];
        $this->combat($id, 'initiative', ['combatantId' => $first, 'initiative' => 18])->assertOk();
        $this->combat($id, 'override', ['combatantId' => $first, 'action_available' => false, 'reaction_available' => false, 'movement_spent' => 15])->assertOk();
        $before = Combat::find($id)->getAttributes();
        $oldActors = DB::table('combatants')->where('combat_id', $id)->orderBy('position')->get()->map(fn ($e) => (array) $e)->all();
        $reserve = $this->intent('reinforce', $id) + ['tokenIds' => [$this->ids[1]]];
        $r = $this->runtime($reserve)->assertOk()->json('combat');
        $this->assertSame($before, Combat::find($id)->getAttributes());
        $this->assertSame($oldActors, DB::table('combatants')->whereIn('id', array_column($oldActors, 'id'))->orderBy('position')->get()->map(fn ($e) => (array) $e)->all());
        $added = $r['combatants'][2];
        $this->assertSame($this->ids[1], $added['tokenId']);
        $this->assertNull($added['initiative']);
        $this->assertDatabaseHas('tokens', ['id' => $this->ids[1], 'is_hidden' => true, 'hp' => 7]);
        $this->combat($id, 'initiative', ['combatantId' => $added['id'], 'initiative' => 25])->assertOk();
        $this->assertSame($this->ids[1], Combat::find($id)->combatants->last()->token_id.'');
        // Existing explicit sort is available, but reinforcement never invokes it.
        $this->combat($id, 'next', ['expectedRound' => 1, 'expectedCurrentCombatantId' => $first])->assertOk();
        $next = $this->combat($id, 'next', ['expectedRound' => 1, 'expectedCurrentCombatantId' => $r['combatants'][1]['id']])->assertOk()->json('combat');
        $this->assertSame($added['id'], $next['currentTurn']['combatantId']);
        $this->assertTrue($next['combatants'][2]['budget']['action']);
    }

    public function test_receipt_retry_group_and_individual_overlap_and_removed_actors_never_duplicate(): void
    {
        $start = $this->intent();
        $initial = $this->runtime($start)->assertOk()->json();
        $this->runtime($start)->assertOk()->assertHeader('Idempotent-Replay', 'true')->assertExactJson($initial);
        $id = $initial['combat']['id'];
        $one = $this->intent('reinforce', $id) + ['tokenIds' => [$this->ids[1]]];
        $r = $this->runtime($one)->assertOk()->json();
        $this->runtime($one)->assertOk()->assertExactJson($r);
        $this->runtime($this->intent('reinforce', $id) + ['tokenIds' => [$this->ids[1], $this->ids[2]]])->assertOk();
        $this->assertDatabaseCount('combatants', 3);
        $actor = (string) Combat::find($id)->combatants()->where('token_id', $this->ids[1])->value('id');
        $this->combat($id, 'remove', ['combatantId' => $actor])->assertOk();
        DB::table('scene_mutation_receipts')->delete();
        $this->runtime($one)->assertOk();
        $this->runtime($start)->assertOk();
        $this->assertDatabaseCount('combatants', 2);
        $this->combat($id, 'end')->assertOk()->assertJsonPath('encounterRuns.0.status', 'ended');
        $this->runtime($this->intent())->assertOk()->assertJsonPath('combat', null)->assertJsonPath('encounterRuns.0.status', 'ended');
        $this->assertDatabaseCount('combats', 1);
        $this->runtime($this->intent('reinforce', $id) + ['tokenIds' => [$this->ids[2]]])->assertConflict();
    }

    public function test_existing_combat_requires_current_confirmation_and_is_never_restarted(): void
    {
        $combat = $this->combat('', 'prepare')->assertOk()->json('combat');
        $id = $combat['id'];
        $this->combat($id, 'add', ['tokenIds' => [$this->ids[0], $this->ids[3]]])->assertOk();
        $this->combat($id, 'begin')->assertOk();
        $before = Combat::find($id)->getAttributes();
        $this->runtime($this->intent())->assertConflict();
        $this->assertDatabaseCount('scene_encounter_runs', 0);
        $this->runtime($this->intent('start', $id) + ['playerTokenIds' => [$this->ids[3], $this->ids[4]]])->assertOk();
        $this->assertSame($before, Combat::find($id)->getAttributes());
        $this->assertDatabaseCount('combats', 1);
        $this->assertDatabaseCount('combatants', 3);
        // Another prepared encounter can join this combat; shared tokens remain shared.
        $copy = $this->postJson($this->path.'/encounters', ['id' => (string) Str::uuid(), 'expected' => null, 'value' => $this->encounter])->assertOk()->json('encounters.0');
        $this->encounter = $copy;
        $this->runtime($this->intent('start', $id))->assertOk();
        $this->assertDatabaseCount('combatants', 3);
        $this->assertDatabaseCount('scene_encounter_runs', 2);
    }

    public function test_existing_preparing_combat_keeps_its_initiative_lifecycle(): void
    {
        $combat = $this->combat('', 'prepare')->assertOk()->json('combat');
        $this->runtime($this->intent('start', $combat['id']))->assertOk()->assertJsonPath('combat.status', 'preparing');
        $this->combat($combat['id'], 'begin')->assertOk()->assertJsonPath('encounterRuns.0.status', 'active');
    }

    public function test_linked_actor_resources_conditions_lifecycle_and_rest_follow_existing_ownership(): void
    {
        $character = $this->scene->campaign->characters()->create(['name' => 'Reserve caster', 'kind' => 'npc', 'hp' => 9, 'max_hp' => 20,
            'resources' => [['id' => (string) Str::uuid(), 'name' => 'Charges', 'current' => 1, 'max' => 3]],
            'rest_state' => ['status' => 'spending'], 'lifecycle' => ['status' => 'alive']]);
        $token = $this->scene->tokens()->findOrFail($this->ids[1]);
        $token->update(['character_id' => $character->id]);
        $this->postJson('/api/tokens/'.$token->id.'/condition-add', ['label' => 'Marked', 'visibility' => 'gm_only'])->assertOk();
        $conditions = $token->conditions()->get()->toArray();
        $before = $character->getAttributes();
        $c = $this->runtime($this->intent())->assertOk()->json('combat.id');
        $this->runtime($this->intent('reinforce', $c) + ['tokenIds' => [$this->ids[1]]])->assertOk();
        $character->refresh();
        foreach (['hp', 'max_hp', 'resources', 'lifecycle'] as $field) {
            $this->assertSame($before[$field], $character->getAttributes()[$field]);
        }
        $this->assertSame('interrupted', $character->rest_state['status']);
        $this->assertSame($conditions, $token->conditions()->get()->toArray());
        $character->update(['hp' => 0, 'lifecycle' => ['status' => 'dead']]);
        $this->runtime($this->intent('reinforce', $c) + ['tokenIds' => [$this->ids[1]]])->assertOk();
        $this->assertSame(0, $character->fresh()->hp);
        $this->assertSame('dead', $character->fresh()->lifecycle['status']);
        $this->assertDatabaseCount('combatants', 2);
    }

    public function test_reinforcement_reveal_cannot_bypass_line_of_sight_for_either_player(): void
    {
        $this->scene->update(['vision_enabled' => true]);
        $this->scene->mapWorld()->create(['structure' => ['vertices' => [
            ['id' => 'a', 'x' => 220, 'y' => 0], ['id' => 'b', 'x' => 220, 'y' => 2000]],
            'edges' => [['id' => 'wall', 'a' => 'a', 'b' => 'b', 'thickness' => 16, 'blocksMovement' => true, 'blocksVision' => true, 'blocksLight' => true, 'materialVersionId' => null]],
            'rooms' => [], 'openings' => []]]);
        $id = $this->runtime($this->intent() + ['playerTokenIds' => [$this->ids[3], $this->ids[4]]])->assertOk()->json('combat.id');
        $this->runtime($this->intent('reinforce', $id) + ['tokenIds' => [$this->ids[1]]])->assertOk();
        Event::fake([TabletopEvent::class]);
        $this->patchJson('/api/tokens/'.$this->ids[1], ['is_hidden' => false])->assertOk();
        foreach ($this->players as $player) {
            $r = $this->actingAs($player)->getJson($this->path.'/snapshot')->assertOk()->json();
            $this->assertNotContains($this->ids[1], array_column($r['tokens'], 'id'));
            $this->assertNotContains($this->ids[1], array_column($r['combat']['combatants'], 'tokenId'));
            $event = Event::dispatched(TabletopEvent::class)->pluck(0)->first(fn ($e) => str_ends_with($e->channel, '.user.'.$player->id));
            $this->assertNotNull($event);
            $this->assertNotContains($this->ids[1], array_column($event->envelope['payload']['tokens'] ?? [], 'id'));
            $this->assertNotContains($this->ids[1], array_column($event->envelope['payload']['combat']['combatants'] ?? [], 'tokenId'));
        }
    }

    public function test_stale_composition_and_invalid_player_or_reserve_ids_roll_back_atomically(): void
    {
        $stale = $this->intent();
        $this->encounter['name'] = 'Changed';
        $this->postJson($this->path.'/encounters', ['id' => $this->encounter['id'], 'expected' => $stale['expected'], 'value' => $this->encounter])->assertOk();
        $this->runtime($stale)->assertConflict();
        $this->runtime($this->intent() + ['playerTokenIds' => [$this->ids[1]]])->assertUnprocessable();
        $other = $this->scene->campaign->scenes()->create(['name' => 'Other']);
        $token = $other->tokens()->create(['name' => 'Other hero', 'kind' => 'player_character', 'x' => 0, 'y' => 0]);
        $this->runtime($this->intent() + ['playerTokenIds' => [(string) $token->id]])->assertUnprocessable();
        $this->assertDatabaseCount('combats', 0);
        $this->assertDatabaseCount('scene_encounter_runs', 0);
        $c = $this->runtime($this->intent())->assertOk()->json('combat.id');
        $this->runtime($this->intent('reinforce', $c) + ['tokenIds' => [$this->ids[0]]])->assertUnprocessable();
        $this->assertDatabaseCount('combatants', 1);
    }

    public function test_deletion_and_preparation_undo_preserve_durable_runtime_identity(): void
    {
        $start = $this->intent();
        $id = $this->runtime($start)->assertOk()->json('combat.id');
        $this->deleteJson('/api/tokens/'.$this->ids[0])->assertOk()->assertJsonPath('encounters.0.groups.0.tokenIds', []);
        $this->assertDatabaseCount('combatants', 0);
        $current = $this->getJson($this->path.'/snapshot')->json('encounters.0');
        $this->postJson($this->path.'/encounters', ['id' => $current['id'], 'expected' => $current, 'value' => null])->assertOk();
        $restore = $this->postJson($this->path.'/encounters', ['id' => $current['id'], 'expected' => null, 'value' => $current])->assertOk();
        $restore->assertJsonPath('encounterRuns.0.combatId', $id);
        $this->runtime($start)->assertOk();
        $this->assertDatabaseCount('combats', 1);
        $this->assertDatabaseCount('combatants', 0);
    }

    public function test_gm_permissions_receipt_reauthorization_and_two_player_projections(): void
    {
        foreach ([false, true] as $vision) {
            $this->scene->update(['vision_enabled' => $vision]);
            Event::fake([TabletopEvent::class]);
            $start = $this->intent('start', Combat::where('status', 'active')->value('id') ? (string) Combat::first()->id : null);
            $r = $this->runtime($start)->assertOk()->json();
            $this->runtime($this->intent('reinforce', $r['combat']['id']) + ['tokenIds' => [$this->ids[1]]])->assertOk();
            foreach (Event::dispatched(TabletopEvent::class)->pluck(0)->filter(fn ($e) => str_contains($e->channel, '.user.')) as $event) {
                $this->assertArrayNotHasKey('encounters', (array) $event->envelope['payload']);
                $this->assertArrayNotHasKey('encounterRuns', (array) $event->envelope['payload']);
                $this->assertStringNotContainsString('SECRET', json_encode($event->envelope));
                $this->assertNotContains($this->ids[1], array_column($event->envelope['payload']['combat']['combatants'] ?? [], 'tokenId'));
            }
            foreach ($this->players as $player) {
                $snapshot = $this->actingAs($player)->getJson($this->path.'/snapshot')->assertOk()->assertJsonMissingPath('encounters')->assertJsonMissingPath('encounterRuns')->json();
                $this->assertNotContains($this->ids[1], array_column($snapshot['combat']['combatants'] ?? [], 'tokenId'));
                $this->assertNotContains($this->ids[1], array_column($snapshot['tokens'], 'id'));
                $this->runtime($start)->assertForbidden();
            }
            $this->actingAs($this->gm);
        }
        $this->scene->campaign->members()->updateExistingPivot($this->gm->id, ['role' => 'player']);
        $this->runtime($start)->assertForbidden();
        $this->actingAs(User::factory()->create())->runtime($start)->assertForbidden();
    }
}
