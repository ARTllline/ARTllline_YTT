<?php

namespace Tests\Feature;

use App\Combat\TurnBudget;
use App\Events\TabletopEvent;
use App\Http\Controllers\AbilityController;
use App\Models\AbilityExecution;
use App\Models\Campaign;
use App\Models\Combat;
use App\Models\SpellEffect;
use App\Models\User;
use App\Services\D20Roller;
use App\Spells\SpellEffects;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\Support\SeedsCharacterCatalog;
use Tests\TestCase;

class GMCombatConsoleTest extends TestCase
{
    use DatabaseMigrations, SeedsCharacterCatalog;

    private $gm;

    private $player;

    private $scene;

    private $token;

    private $combat;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCharacterCatalog();
        Event::fake([TabletopEvent::class]);
        [$this->gm, $this->player] = User::factory()->count(2)->create()->all();
        $campaign = Campaign::create(['name' => 'Console']);
        $campaign->members()->attach($this->gm, ['role' => 'gm']);
        $campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $campaign->scenes()->create(['name' => 'Console']);
        $campaign->update(['active_scene_id' => $this->scene->id]);
        $this->token = $this->scene->tokens()->create(['name' => 'Goblin', 'x' => 10, 'y' => 10, 'hp' => 20, 'max_hp' => 30, 'ac' => 15, 'speed' => 30, 'combat_profile' => ['ability_scores' => ['dex' => 14]], 'check_stats' => [['key' => 'perception', 'label' => 'Perception', 'modifier' => 3]]]);
        $this->combat = Combat::create(['scene_id' => $this->scene->id, 'created_by' => $this->gm->id, 'status' => 'active', 'round' => 1]);
        $entry = $this->combat->combatants()->create(['token_id' => $this->token->id, 'position' => 0]);
        $this->combat->update(['current_combatant_id' => $entry->id]);
        app(TurnBudget::class)->start($this->combat, $entry->id);
    }

    private function sessionCommand(array $d, $user = null)
    {
        return $this->actingAs($user ?? $this->gm)->postJson('/api/scenes/'.$this->scene->id.'/combat/session', ['clientMutationId' => $d['clientMutationId'] ?? (string) Str::uuid()] + $d);
    }

    private function tokenCommand(string $command, array $d)
    {
        return $this->actingAs($this->gm)->postJson('/api/tokens/'.$this->token->id.'/'.$command, ['clientMutationId' => $d['clientMutationId'] ?? (string) Str::uuid()] + $d);
    }

    private function cast(): AbilityExecution
    {
        return AbilityExecution::create(['id' => (string) Str::uuid(), 'campaign_id' => $this->scene->campaign_id, 'token_id' => $this->token->id, 'user_id' => $this->player->id, 'mutation_id' => (string) Str::uuid(), 'ability_key' => (string) Str::uuid(), 'context' => ['sceneId' => (string) $this->scene->id], 'result' => ['abilityName' => 'Command', 'coverage' => 'MANUAL', 'manualResolution' => 'pending'], 'created_at' => now()]);
    }

    public function test_player_cannot_read_or_operate_gm_console_or_replay_a_receipt(): void
    {
        $url = '/api/scenes/'.$this->scene->id.'/combat/session';
        $this->actingAs($this->player)->getJson($url)->assertForbidden();
        $this->sessionCommand(['action' => 'check', 'tokenIds' => [$this->token->id], 'stat' => 'save_dex', 'visibility' => 'gm_only'], $this->player)->assertForbidden();
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->scene->id.'/combat/history')->assertForbidden();
        $this->actingAs($this->player)->postJson('/api/tokens/'.$this->token->id.'/hp-set', ['value' => 30])->assertForbidden();
        $this->actingAs($this->player)->postJson('/api/scenes/'.$this->scene->id.'/combat/next', [])->assertForbidden();
    }

    public function test_hp_correction_is_logged_realtime_and_can_be_undone_once(): void
    {
        $r = $this->tokenCommand('hp', ['delta' => -8])->assertOk()->assertJsonPath('token.hp', 12);
        $id = $this->actingAs($this->gm)->getJson('/api/scenes/'.$this->scene->id.'/combat/session')->assertOk()->json('undoId');
        $this->assertNotNull($id);
        $this->sessionCommand(['action' => 'undo', 'correctionId' => $id])->assertOk()->assertJsonPath('token.hp', 20);
        $this->sessionCommand(['action' => 'undo', 'correctionId' => $id])->assertConflict();
        $this->assertDatabaseHas('combat_events', ['type' => 'gm.correction']);
        $this->assertDatabaseHas('combat_events', ['type' => 'gm.undo']);
        Event::assertDispatched(TabletopEvent::class, fn ($e) => ($e->envelope['revision'] ?? null) === $r->json('revision'));
    }

    public function test_condition_add_remove_and_undo_preserve_duration_and_source(): void
    {
        $this->tokenCommand('condition-add', ['key' => 'poisoned', 'visibility' => 'public', 'duration_mode' => 'until_end_of_target_turn'])->assertOk();
        $condition = $this->token->conditions()->firstOrFail();
        $this->tokenCommand('condition-remove', ['conditionId' => (string) $condition->id])->assertOk();
        $id = $this->actingAs($this->gm)->getJson('/api/scenes/'.$this->scene->id.'/combat/session')->json('undoId');
        $this->sessionCommand(['action' => 'undo', 'correctionId' => $id])->assertOk();
        $this->assertSame('until_end_of_target_turn', $this->token->conditions()->firstOrFail()->duration_mode);
    }

    public function test_intervening_turn_invalidates_undo_and_expires_condition(): void
    {
        $this->tokenCommand('condition-add', ['key' => 'poisoned', 'visibility' => 'public', 'duration_mode' => 'until_end_of_target_turn'])->assertOk();
        $id = $this->actingAs($this->gm)->getJson('/api/scenes/'.$this->scene->id.'/combat/session')->json('undoId');
        $this->actingAs($this->gm)->postJson('/api/scenes/'.$this->scene->id.'/combat/next', ['combatId' => (string) $this->combat->id, 'expectedRound' => 1, 'expectedCurrentCombatantId' => (string) $this->combat->current_combatant_id])->assertOk();
        $this->sessionCommand(['action' => 'undo', 'correctionId' => $id])->assertConflict();
        $this->assertSame(0, $this->token->conditions()->count());
    }

    public function test_set_hp_is_exact_and_preserves_temporary_hp(): void
    {
        $this->token->update(['temporary_hp' => 10]);
        $this->tokenCommand('hp-set', ['value' => 7])->assertOk()->assertJsonPath('token.hp', 7)->assertJsonPath('token.temporaryHp', 10);
    }

    public function test_manual_tasks_survive_reconnect_and_close_once_without_changing_coverage(): void
    {
        $cast = $this->cast();
        $url = '/api/scenes/'.$this->scene->id.'/combat/session';
        $this->actingAs($this->gm)->getJson($url)->assertOk()->assertJsonPath('pending.0.id', $cast->id);
        $this->sessionCommand(['action' => 'resolve', 'executionId' => $cast->id, 'status' => 'resolved', 'note' => 'Guard retreats'], $this->player)->assertForbidden();
        $this->sessionCommand(['action' => 'resolve', 'executionId' => $cast->id, 'status' => 'resolved', 'note' => 'Guard retreats'])->assertOk();
        $this->assertSame('MANUAL', $cast->fresh()->result['coverage']);
        $this->assertSame('Guard retreats', $cast->fresh()->result['resolution']['note']);
        $this->actingAs($this->gm)->getJson($url)->assertJsonCount(0, 'pending');
        $this->sessionCommand(['action' => 'resolve', 'executionId' => $cast->id, 'status' => 'dismissed'])->assertConflict();
        $this->assertDatabaseHas('combat_events', ['type' => 'manual.resolved']);
    }

    public function test_resolver_is_scoped_to_scene_and_uuid_retries_are_idempotent(): void
    {
        $cast = $this->cast();
        $d = ['action' => 'resolve', 'executionId' => $cast->id, 'status' => 'dismissed', 'clientMutationId' => (string) Str::uuid()];
        $first = $this->sessionCommand($d)->assertOk()->json();
        $this->sessionCommand($d)->assertOk()->assertExactJson($first);
        $this->assertSame(1, DB::table('combat_events')->where('type', 'manual.resolved')->count());
        $cast->update(['context' => ['sceneId' => '99999'], 'result' => ['manualResolution' => 'pending']]);
        $this->sessionCommand(['action' => 'resolve', 'executionId' => $cast->id, 'status' => 'resolved'])->assertNotFound();
    }

    public function test_batch_saves_reuse_modifiers_and_secret_results_never_broadcast(): void
    {
        $other = $this->token->replicate();
        $other->name = 'Hidden';
        $other->is_hidden = true;
        $other->save();
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(12);
        $d = ['action' => 'check', 'tokenIds' => [$this->token->id, $other->id], 'stat' => 'save_dex', 'dc' => 15, 'visibility' => 'gm_only'];
        $this->sessionCommand($d)->assertOk()->assertJsonPath('outcomes.0.roll.total', 14)->assertJsonCount(2, 'outcomes')->assertJsonPath('gameplayFeedbacks', []);
        Event::assertNotDispatched(TabletopEvent::class, fn ($e) => str_contains($e->channel, '.epoch.') && str_contains(json_encode($e->envelope), 'outcomes'));
    }

    public function test_batch_rejection_is_atomic_and_checks_have_optional_dc(): void
    {
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(12);
        $this->sessionCommand(['action' => 'check', 'tokenIds' => [$this->token->id], 'stat' => 'perception', 'visibility' => 'public'])->assertOk()->assertJsonPath('outcomes.0.roll.total', 15)->assertJsonMissingPath('outcomes.0.roll.success')->assertJsonMissingPath('outcomes.0.roll.dc');
        $n = DB::table('combat_events')->count();
        $this->sessionCommand(['action' => 'check', 'tokenIds' => [$this->token->id, 999999], 'stat' => 'save_dex', 'visibility' => 'gm_only'])->assertUnprocessable();
        $this->assertSame($n, DB::table('combat_events')->count());
    }

    public function test_receipt_replay_rechecks_current_gm_role(): void
    {
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(12);
        $d = ['action' => 'check', 'tokenIds' => [$this->token->id], 'stat' => 'save_dex', 'dc' => 19, 'visibility' => 'gm_only', 'clientMutationId' => (string) Str::uuid()];
        $this->sessionCommand($d)->assertOk();
        DB::table('campaign_members')->where('campaign_id', $this->scene->campaign_id)->where('user_id', $this->gm->id)->update(['role' => 'player']);
        $this->sessionCommand($d)->assertForbidden();
    }

    public function test_concentration_side_effect_prevents_correction_undo(): void
    {
        $character = $this->scene->campaign->characters()->create(['name' => 'Caster', 'hp' => 20, 'max_hp' => 30, 'ac' => 15]);
        $this->token->update(['character_id' => $character->id]);
        $effect = SpellEffect::create(['id' => (string) Str::uuid(), 'scene_id' => $this->scene->id, 'character_id' => $character->id, 'source_token_id' => $this->token->id, 'ability_id' => (string) Str::uuid(), 'name' => 'Bless', 'concentration' => true, 'targets' => [(string) $this->token->id], 'payload' => ['effects' => [], 'conditions' => []]]);
        $this->tokenCommand('hp-set', ['value' => 0])->assertOk();
        $this->assertNotNull($effect->fresh()->ended_at);
        $this->actingAs($this->gm)->getJson('/api/scenes/'.$this->scene->id.'/combat/session')->assertOk()->assertJsonPath('undoId', null);
    }

    public function test_player_result_redacts_new_gm_context_and_resolution_note(): void
    {
        $this->actingAs($this->player);
        $request = Request::create('/api/scenes/'.$this->scene->id.'/abilities/execute');
        $request->setUserResolver(fn () => $this->player);
        $route = new Route('POST', 'api/scenes/{scene}/abilities/execute', fn () => null);
        $route->bind($request);
        $route->setParameter('scene', $this->scene);
        $request->setRouteResolver(fn () => $route);
        $this->app->instance('request', $request);
        $safe = AbilityController::present(['execution' => ['gmContext' => ['remaining' => 'secret'], 'resolution' => ['note' => 'secret GM note'], 'outcomes' => [['hpBefore' => 10, 'hpAfter' => 1, 'damageDetail' => [], 'conditionsApplied' => [], 'tokenId' => '1', 'damage' => 9]]]]);
        $this->assertArrayNotHasKey('gmContext', $safe['execution']);
        $this->assertArrayNotHasKey('resolution', $safe['execution']);
        $this->assertArrayNotHasKey('hpBefore', $safe['execution']['outcomes'][0]);
    }

    public function test_undo_compares_json_objects_independently_of_mysql_key_order(): void
    {
        $this->tokenCommand('hp', ['delta' => -4])->assertOk();
        $event = DB::table('combat_events')->where('type', 'gm.correction')->latest('id')->first();
        $data = json_decode($event->data, true);
        ksort($data['after']);
        DB::table('combat_events')->where('id', $event->id)->update(['data' => json_encode($data)]);
        $this->sessionCommand(['action' => 'undo', 'correctionId' => (string) $event->id])->assertOk()->assertJsonPath('token.hp', 20);
    }

    public function test_effect_projection_reads_are_bounded_and_do_not_survive_mutations(): void
    {
        $character = $this->scene->campaign->characters()->create(['name' => 'Effect target', 'hp' => 20, 'max_hp' => 30, 'ac' => 15]);
        $this->token->update(['character_id' => $character->id]);
        $effect = SpellEffect::create(['id' => (string) Str::uuid(), 'scene_id' => $this->scene->id, 'character_id' => $character->id, 'source_token_id' => $this->token->id, 'ability_id' => (string) Str::uuid(), 'name' => 'Shield of Faith', 'concentration' => true, 'targets' => [(string) $this->token->id], 'payload' => ['effects' => [['type' => 'modifier', 'key' => 'ac', 'value' => 2, 'when' => 'always']], 'conditions' => []]]);
        $effects = app(SpellEffects::class);
        DB::enableQueryLog();
        DB::flushQueryLog();
        $effects->project(function () use ($effects, $character) {
            for ($i = 0; $i < 50; $i++) {
                $this->assertSame(2, $effects->flat($character, 'ac')[0]['value']);
            }
        });
        $this->assertLessThan(6, count(DB::getQueryLog()), 'DTO stat count must not multiply effect/token-link SQL queries.');
        DB::disableQueryLog();
        $effects->end($effect, 'test');
        $this->assertSame([], $effects->project(fn () => $effects->flat($character, 'ac')));
        $this->assertSame([], $effects->flat($character, 'ac'));
    }

    public function test_failed_projection_cannot_leave_a_stale_effect_snapshot(): void
    {
        $effects = app(SpellEffects::class);
        try {
            $effects->project(function () use ($effects) {
                $effects->forSubject($this->token);
                throw new \RuntimeException('interrupted projection');
            });
        } catch (\RuntimeException) {
        }
        $caster = $this->scene->campaign->characters()->create(['name' => 'Caster', 'hp' => 20, 'max_hp' => 20]);
        $effect = SpellEffect::create(['id' => (string) Str::uuid(), 'scene_id' => $this->scene->id, 'character_id' => $caster->id, 'source_token_id' => $this->token->id, 'ability_id' => (string) Str::uuid(), 'name' => 'New effect', 'concentration' => false, 'targets' => [(string) $this->token->id], 'payload' => ['effects' => [['type' => 'modifier', 'key' => 'ac', 'value' => 3, 'when' => 'always']], 'conditions' => []]]);
        $this->assertSame(3, $effects->flat($this->token, 'ac')[0]['value']);
    }
}
