<?php

namespace Tests\Feature;

use App\Actions\TokenCombatActions;
use App\Combat\AppliedConditions;
use App\Combat\ConditionRules;
use App\Combat\LifeCycle;
use App\Combat\TurnBudget;
use App\Events\TabletopEvent;
use App\Models\AbilityExecution;
use App\Models\Campaign;
use App\Models\Combat;
use App\Models\SpellEffect;
use App\Models\User;
use App\Services\CharacterRules;
use App\Services\D20Roller;
use App\Services\DamageRoller;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\SeedsCharacterCatalog;
use Tests\TestCase;

class AdventuringLifecycleTest extends TestCase
{
    use DatabaseMigrations, SeedsCharacterCatalog;

    private $gm;

    private $player;

    private $other;

    private $campaign;

    private $scene;

    private $hero;

    private $token;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCharacterCatalog();
        Event::fake([TabletopEvent::class]);
        [$this->gm, $this->player, $this->other] = User::factory()->count(3)->create()->all();
        $this->campaign = Campaign::create(['name' => 'Adventuring']);
        foreach ([$this->gm, $this->player, $this->other] as $i => $u) {
            $this->campaign->members()->attach($u, ['role' => $i === 0 ? 'gm' : 'player']);
        }
        $this->scene = $this->campaign->scenes()->create(['name' => 'Arena', 'grid_size' => 50, 'distance_per_cell' => 5]);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $rules = app(CharacterRules::class)->defaults();
        $rules['scores']['con'] = 14;
        $this->hero = $this->campaign->characters()->create(['name' => 'Kern', 'kind' => 'player_character', 'owner_user_id' => $this->player->id, 'hp' => 10, 'max_hp' => 30, 'speed' => 30, 'rules' => $rules, 'hit_point_dice' => [['die' => 'd10', 'max' => 4, 'current' => 2], ['die' => 'd6', 'max' => 2, 'current' => 1]]]);
        $this->token = $this->scene->tokens()->create(['character_id' => $this->hero->id, 'name' => 'Kern', 'x' => 0, 'y' => 0]);
    }

    private function command(array $d, $user = null)
    {
        return $this->actingAs($user ?? $this->gm)->postJson('/api/scenes/'.$this->scene->id.'/adventuring', $d + ['clientMutationId' => (string) Str::uuid()]);
    }

    private function damage(int $amount, bool $critical = false): void
    {
        app(TokenCombatActions::class)->adjustHp($this->gm, $this->token->fresh(), -$amount, $critical);
    }

    private function state(): array
    {
        return app(LifeCycle::class)->state($this->hero->fresh());
    }

    private function turn(): Combat
    {
        $combat = Combat::where('scene_id', $this->scene->id)->first() ?? Combat::create(['scene_id' => $this->scene->id, 'created_by' => $this->gm->id, 'status' => 'active', 'round' => 1]);
        $entry = $combat->combatants()->firstOrCreate(['token_id' => $this->token->id], ['position' => 0]);
        $combat->update(['current_combatant_id' => $entry->id]);
        app(TurnBudget::class)->start($combat, $entry->id);

        return $combat;
    }

    private function roll(int $natural): void
    {
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn($natural);
    }

    private function rest(string $kind = 'short-rest', array $extra = [])
    {
        return $this->command(['action' => $kind, 'characterIds' => [$this->hero->id], 'confirmWorldTime' => true] + $extra);
    }

    public function test_zero_hp_is_persistent_unconscious_and_cannot_move_or_act_outside_combat(): void
    {
        $this->damage(10);
        $this->assertSame('dying', $this->state()['status']);
        $this->assertTrue(app(ConditionRules::class)->inactive($this->token->fresh()));
        $this->assertDatabaseHas('token_conditions', ['token_id' => $this->token->id, 'key' => 'unconscious']);
        $snapshot = app(SceneSnapshotBuilder::class)->build($this->scene, $this->player);
        $this->assertSame('dying', $snapshot['characters'][0]['lifecycle']['status']);
        $this->expectException(HttpException::class);
        app(TurnBudget::class)->move($this->token->fresh(), 5, 0);
    }

    public function test_success_failure_and_once_per_turn_death_save_with_durable_uuid(): void
    {
        $this->damage(10);
        $this->turn();
        $this->roll(14);
        $id = (string) Str::uuid();
        $d = ['action' => 'death-save', 'tokenId' => $this->token->id, 'clientMutationId' => $id];
        $this->command($d, $this->player)->assertOk()->assertJsonPath('lifecycle.successes', 1)->assertJsonMissingPath('tokens.0.isHidden');
        $this->command(['action' => 'death-save', 'tokenId' => $this->token->id], $this->player)->assertUnprocessable();
        DB::table('scene_mutation_receipts')->delete();
        $this->command($d, $this->player)->assertOk();
        $this->assertSame(1, $this->state()['successes']);
        $this->turn();
        $this->roll(8);
        $this->command(['action' => 'death-save', 'tokenId' => $this->token->id], $this->player)->assertOk()->assertJsonPath('lifecycle.failures', 1);
    }

    public function test_natural_one_counts_two_failures_and_natural_twenty_heals_one(): void
    {
        $this->damage(10);
        $this->turn();
        $this->roll(1);
        $this->command(['action' => 'death-save', 'tokenId' => $this->token->id])->assertOk()->assertJsonPath('lifecycle.failures', 2);
        $this->turn();
        $this->roll(20);
        $this->command(['action' => 'death-save', 'tokenId' => $this->token->id])->assertOk();
        $this->assertSame(1, $this->hero->fresh()->hp);
        $this->assertSame('alive', $this->state()['status']);
        $this->assertSame(0, $this->state()['failures']);
        $this->assertFalse($this->token->conditions()->where('key', 'unconscious')->exists());
        $this->assertTrue($this->token->conditions()->where('key', 'prone')->exists());
    }

    public function test_three_successes_reset_both_counters_and_stable_stops_saves(): void
    {
        $this->damage(10);
        $this->roll(12);
        for ($i = 0; $i < 3; $i++) {
            $this->turn();
            $this->command(['action' => 'death-save', 'tokenId' => $this->token->id])->assertOk();
        }
        $this->assertSame('stable', $this->state()['status']);
        $this->assertSame(0, $this->state()['successes']);
        $this->turn();
        $this->command(['action' => 'death-save', 'tokenId' => $this->token->id])->assertUnprocessable();
        $this->damage(1);
        $this->assertSame('dying', $this->state()['status']);
        $this->assertSame(1, $this->state()['failures']);
    }

    public function test_three_failures_die_and_ordinary_healing_cannot_revive(): void
    {
        $this->damage(10);
        $this->roll(2);
        for ($i = 0; $i < 3; $i++) {
            $this->turn();
            $this->command(['action' => 'death-save', 'tokenId' => $this->token->id])->assertOk();
        }
        $this->assertSame('dead', $this->state()['status']);
        app(TokenCombatActions::class)->adjustHp($this->gm, $this->token->fresh(), 20);
        $this->assertSame(0, $this->hero->fresh()->hp);
        $this->command(['action' => 'revive', 'tokenId' => $this->token->id, 'hp' => 5])->assertOk();
        $this->assertSame('alive', $this->state()['status']);
    }

    public function test_normal_critical_and_massive_damage_use_exact_thresholds(): void
    {
        $this->damage(39); // 29 remaining < maximum 30
        $this->assertSame('dying', $this->state()['status']);
        $this->damage(1, true);
        $this->assertSame(2, $this->state()['failures']);
        $this->damage(1);
        $this->assertSame('dead', $this->state()['status']);
        $this->command(['action' => 'revive', 'tokenId' => $this->token->id, 'hp' => 10])->assertOk();
        $this->damage(40);
        $this->assertSame('dead', $this->state()['status']);
        $this->assertSame('massive_damage', $this->state()['cause']);
    }

    public function test_massive_damage_while_at_zero_and_temp_hp_do_not_restore_consciousness(): void
    {
        $this->damage(10);
        $this->hero->update(['temporary_hp' => 5]);
        $this->damage(2);
        $this->assertSame(3, $this->hero->fresh()->temporary_hp);
        $this->assertSame(0, $this->hero->fresh()->hp);
        $this->assertSame('dying', $this->state()['status']);
        $this->assertSame(1, $this->state()['failures']);
        $this->damage(30);
        $this->assertSame('dead', $this->state()['status']);
    }

    public function test_healing_resets_saves_and_only_removes_lifecycle_unconscious(): void
    {
        $this->damage(10);
        $this->damage(1);
        app(AppliedConditions::class)->apply($this->gm, $this->token->fresh(), ['key' => 'poisoned']);
        app(TokenCombatActions::class)->adjustHp($this->gm, $this->token->fresh(), 100);
        $this->assertSame(30, $this->hero->fresh()->hp);
        $this->assertSame(0, $this->state()['failures']);
        $this->assertSame('alive', $this->state()['status']);
        $this->assertTrue($this->token->conditions()->where('key', 'poisoned')->exists());
    }

    public function test_help_uses_medicine_check_action_and_range(): void
    {
        $ally = $this->campaign->characters()->create(['name' => 'Ally', 'kind' => 'player_character', 'hp' => 0, 'max_hp' => 10]);
        $target = $this->scene->tokens()->create(['character_id' => $ally->id, 'name' => 'Ally', 'x' => 50, 'y' => 0]);
        $this->roll(1);
        $d = ['action' => 'stabilize', 'tokenId' => $this->token->id, 'targetId' => $target->id];
        $this->command($d, $this->player)->assertOk()->assertJsonPath('roll.success', false);
        $this->assertSame('dying', app(LifeCycle::class)->state($ally->fresh())['status']);
        $this->roll(15);
        $this->command($d, $this->player)->assertOk()->assertJsonPath('roll.success', true);
        $this->assertSame('stable', app(LifeCycle::class)->state($ally->fresh())['status']);
        $target->update(['x' => 500]);
        $this->command($d, $this->player)->assertUnprocessable();
    }

    public function test_npc_default_death_manual_policy_and_death_saves_need_no_character(): void
    {
        foreach (['immediate_death' => 'dead', 'manual' => 'defeated', 'death_saves' => 'dying'] as $policy => $expected) {
            $t = $this->scene->tokens()->create(['x' => 0, 'y' => 0, 'name' => 'NPC', 'kind' => 'npc', 'hp' => 4, 'max_hp' => 10, 'combat_profile' => ['zero_hp_policy' => $policy]]);
            app(TokenCombatActions::class)->adjustHp($this->gm, $t, -4);
            $this->assertSame($expected, app(LifeCycle::class)->state($t->fresh())['status']);
        }
        $this->assertSame(1, $this->campaign->characters()->count());
    }

    public function test_npc_prepared_death_text_enters_existing_queue_once_and_is_private(): void
    {
        $t = $this->scene->tokens()->create(['x' => 0, 'y' => 0, 'name' => 'Magma', 'kind' => 'npc', 'hp' => 4, 'max_hp' => 10, 'combat_profile' => ['lifecycle_consequences' => [['name' => 'Burst', 'trigger' => 'on_death', 'description' => 'Secret prepared text']]]]);
        app(TokenCombatActions::class)->adjustHp($this->gm, $t, -4);
        app(TokenCombatActions::class)->adjustHp($this->gm, $t->fresh(), -1);
        $this->assertSame(1, AbilityExecution::count());
        $url = '/api/scenes/'.$this->scene->id.'/combat/session';
        $r = $this->actingAs($this->gm)->getJson($url)->assertOk()->assertJsonPath('pending.0.result.abilityName', 'Burst');
        $this->actingAs($this->player)->getJson($url)->assertForbidden();
        $this->actingAs($this->gm)->postJson($url, ['action' => 'resolve', 'executionId' => $r->json('pending.0.id'), 'status' => 'resolved', 'note' => 'Applied'])->assertOk();
        $this->assertSame('resolved_by_gm', AbilityExecution::first()->result['manualResolution']);
    }

    public function test_hit_point_dice_spending_is_persistent_capped_and_retry_safe(): void
    {
        $this->rest()->assertOk();
        $rest = $this->hero->fresh()->rest_state;
        $this->mock(DamageRoller::class)->shouldReceive('roll')->with('1d10')->once()->andReturn(['total' => 7]);
        $id = (string) Str::uuid();
        $d = ['action' => 'spend-die', 'tokenId' => $this->token->id, 'die' => 'd10', 'restId' => $rest['id'], 'clientMutationId' => $id];
        $this->command($d, $this->player)->assertOk()->assertJsonPath('healing', 9);
        $this->command($d, $this->player)->assertOk();
        DB::table('scene_mutation_receipts')->delete();
        $this->command($d, $this->player)->assertOk();
        $this->assertSame(19, $this->hero->fresh()->hp);
        $this->assertSame(1, $this->hero->fresh()->hit_point_dice[0]['current']);
        $this->command(['action' => 'finish-rest', 'tokenId' => $this->token->id, 'restId' => $rest['id']], $this->player)->assertOk();
        $this->command($d + [], $this->other)->assertForbidden();
    }

    public function test_hit_die_minimum_one_and_hp_maximum(): void
    {
        $rules = $this->hero->rules;
        $rules['scores']['con'] = 1;
        $this->hero->update(['rules' => $rules, 'hp' => 29]);
        $this->rest()->assertOk();
        $this->mock(DamageRoller::class)->shouldReceive('roll')->andReturn(['total' => 1]);
        $this->command(['action' => 'spend-die', 'tokenId' => $this->token->id, 'die' => 'd10', 'restId' => $this->hero->fresh()->rest_state['id']], $this->player)->assertOk()->assertJsonPath('healing', 1);
        $this->assertSame(30, $this->hero->fresh()->hp);
    }

    public function test_long_rest_restores_all_dice_slots_hp_temp_and_one_exhaustion_only(): void
    {
        $this->hero->update(['temporary_hp' => 9, 'spellcasting' => ['slots' => [1 => ['max' => 4, 'current' => 1]]], 'exhaustion' => 3]);
        app(AppliedConditions::class)->apply($this->gm, $this->token->fresh(), ['key' => 'poisoned']);
        $id = (string) Str::uuid();
        $this->rest('long-rest', ['clientMutationId' => $id])->assertOk();
        $this->rest('long-rest', ['clientMutationId' => $id])->assertOk();
        $c = $this->hero->fresh();
        $this->assertSame(30, $c->hp);
        $this->assertSame(0, $c->temporary_hp);
        $this->assertSame(2, $c->exhaustion);
        $this->assertSame([4, 2], array_column($c->hit_point_dice, 'current'));
        $this->assertSame(4, $c->spellcasting['slots'][1]['current']);
        $this->assertTrue($this->token->conditions()->where('key', 'poisoned')->exists());
        $this->assertDatabaseCount('lifecycle_commands', 1);
    }

    public function test_recovery_policies_are_explicit_and_short_rest_does_not_restore_normal_slots(): void
    {
        $resources = [];
        foreach (['manual', 'short_rest', 'long_rest'] as $key) {
            $resources[] = ['key' => $key, 'label' => $key, 'current' => 0, 'max' => 3, 'recovery' => $key];
        }
        $this->hero->update(['resources' => $resources, 'spellcasting' => ['slots' => [1 => ['max' => 4, 'current' => 0]]]]);
        $this->rest()->assertOk();
        $this->assertSame([0, 3, 0], array_column($this->hero->fresh()->resources, 'current'));
        $this->assertSame(0, $this->hero->fresh()->spellcasting['slots'][1]['current']);
        $this->rest('long-rest')->assertOk();
        $this->assertSame([0, 3, 3], array_column($this->hero->fresh()->resources, 'current'));
    }

    public function test_exhaustion_affects_character_rules_speed_and_death_save_and_six_kills(): void
    {
        $this->command(['action' => 'exhaustion', 'tokenId' => $this->token->id, 'level' => 2])->assertOk();
        $c = $this->hero->fresh();
        $this->assertSame(20, $c->speed);
        $this->assertSame(-2, app(CharacterRules::class)->stat($c, 'save_con')['modifier']);
        $this->damage(10);
        $this->turn();
        $this->roll(12);
        $this->command(['action' => 'death-save', 'tokenId' => $this->token->id])->assertOk()->assertJsonPath('roll.total', 8)->assertJsonPath('roll.success', false);
        $this->command(['action' => 'exhaustion', 'tokenId' => $this->token->id, 'level' => 6])->assertOk();
        $this->assertSame('dead', $this->state()['status']);
        $this->assertSame('exhaustion', $this->state()['cause']);
        $this->command(['action' => 'revive', 'tokenId' => $this->token->id, 'hp' => 1])->assertOk();
        $this->assertSame(5, $this->hero->fresh()->exhaustion);
        $this->assertSame(5, $this->token->conditions()->where('key', 'exhaustion')->firstOrFail()->metadata['level']);
    }

    public function test_applying_canonical_exhaustion_is_cumulative(): void
    {
        for ($i = 0; $i < 2; $i++) {
            app(AppliedConditions::class)->apply($this->gm, $this->token->fresh(), ['key' => 'exhaustion']);
        }
        $this->assertSame(2, $this->hero->fresh()->exhaustion);
        $this->assertSame(1, $this->token->conditions()->where('key', 'exhaustion')->count());
    }

    public function test_rest_requires_gm_world_time_positive_hp_and_no_active_combat(): void
    {
        $this->command(['action' => 'short-rest', 'characterIds' => [$this->hero->id]], $this->player)->assertForbidden();
        $this->command(['action' => 'long-rest', 'characterIds' => [$this->hero->id]])->assertUnprocessable();
        $this->turn();
        $this->rest()->assertUnprocessable();
        $this->rest('short-rest', ['combatOverride' => true])->assertOk()->assertJsonPath('override', true);
        $this->damage(10);
        $this->rest('long-rest', ['combatOverride' => true])->assertUnprocessable();
    }

    public function test_party_rest_rolls_back_every_character_on_partial_failure(): void
    {
        $bad = $this->campaign->characters()->create(['name' => 'Bad', 'kind' => 'player_character', 'hp' => 0, 'max_hp' => 10]);
        $this->command(['action' => 'long-rest', 'characterIds' => [$this->hero->id, $bad->id], 'confirmWorldTime' => true])->assertUnprocessable();
        $this->assertSame(10, $this->hero->fresh()->hp);
        $this->assertNull($this->hero->fresh()->rest_state);
        $this->assertDatabaseCount('lifecycle_commands', 0);
    }

    public function test_players_cannot_forge_lifecycle_dice_exhaustion_or_replay_after_revocation(): void
    {
        foreach (['stable', 'revive', 'exhaustion', 'configure-dice', 'reset-saves'] as $action) {
            $this->command(['action' => $action, 'tokenId' => $this->token->id, 'hp' => 3, 'level' => 3, 'pools' => []], $this->player)->assertForbidden();
        }
        $this->rest()->assertOk();
        $id = (string) Str::uuid();
        $d = ['action' => 'finish-rest', 'tokenId' => $this->token->id, 'restId' => $this->hero->fresh()->rest_state['id'], 'clientMutationId' => $id];
        $this->command($d, $this->player)->assertOk();
        $this->hero->update(['owner_user_id' => $this->other->id]);
        $this->command($d, $this->player)->assertForbidden();
    }

    public function test_damage_closes_die_spending_and_reconnect_preserves_rest(): void
    {
        $this->rest()->assertOk();
        $id = $this->hero->fresh()->rest_state['id'];
        $snapshot = app(SceneSnapshotBuilder::class)->build($this->scene, $this->player);
        $this->assertSame($id, $snapshot['characters'][0]['rest']['id']);
        $this->damage(1);
        $this->command(['action' => 'spend-die', 'tokenId' => $this->token->id, 'die' => 'd10', 'restId' => $id], $this->player)->assertUnprocessable();
    }

    public function test_long_rest_restores_recorded_max_hp_and_ability_reductions(): void
    {
        $this->command(['action' => 'reduction', 'tokenId' => $this->token->id, 'maxHpLoss' => 8, 'scoreLoss' => ['con' => 4]])->assertOk();
        $this->assertSame(22, $this->hero->fresh()->max_hp);
        $this->assertSame(10, $this->hero->fresh()->rules['scores']['con']);
        $this->rest('long-rest')->assertOk();
        $this->assertSame(30, $this->hero->fresh()->hp);
        $this->assertSame(14, $this->hero->fresh()->rules['scores']['con']);
        $this->command(['action' => 'reduction', 'tokenId' => $this->token->id, 'maxHpLoss' => 30])->assertOk();
        $this->assertSame('dead', $this->state()['status']);
    }

    public function test_rest_advances_finite_effects_once_per_party_and_preserves_indefinite_effects(): void
    {
        $this->travelTo(now()->startOfSecond());
        $other = $this->campaign->characters()->create(['name' => 'Ally', 'kind' => 'player_character', 'hp' => 5, 'max_hp' => 10]);
        $target = $this->scene->tokens()->create(['character_id' => $other->id, 'name' => 'Ally', 'x' => 50, 'y' => 0]);
        $base = ['id' => (string) Str::uuid(), 'scene_id' => $this->scene->id, 'character_id' => $this->hero->id, 'source_token_id' => $this->token->id, 'ability_id' => (string) Str::uuid(), 'name' => 'Finite', 'concentration' => false, 'targets' => [(string) $target->id, (string) $this->token->id], 'payload' => ['conditions' => [], 'effects' => []], 'expires_at' => now()->addHours(3)];
        $finite = SpellEffect::create($base);
        $indefinite = SpellEffect::create(array_replace($base, ['id' => (string) Str::uuid(), 'name' => 'Indefinite', 'expires_at' => null]));
        $this->command(['action' => 'short-rest', 'characterIds' => [$this->hero->id, $other->id], 'confirmWorldTime' => true])->assertOk();
        $this->assertEquals(7200, now()->diffInSeconds($finite->fresh()->expires_at));
        $this->assertNull($indefinite->fresh()->ended_at);
        $this->rest('long-rest')->assertOk();
        $this->assertSame('rest_elapsed', $finite->fresh()->end_reason);
        $this->assertNull($indefinite->fresh()->ended_at);
    }

    public function test_stable_recovery_requires_gm_confirmation_of_server_rolled_hours(): void
    {
        $this->damage(10);
        $this->command(['action' => 'stable', 'tokenId' => $this->token->id])->assertOk();
        $state = $this->state();
        $this->assertGreaterThanOrEqual(1, $state['recoveryHours']);
        $this->assertLessThanOrEqual(4, $state['recoveryHours']);
        $d = ['action' => 'stable-recovery', 'tokenId' => $this->token->id];
        $this->command($d)->assertUnprocessable();
        $this->command($d + ['confirmWorldTime' => true], $this->player)->assertForbidden();
        $this->command($d + ['confirmWorldTime' => true])->assertOk();
        $this->assertSame(1, $this->hero->fresh()->hp);
        $this->assertSame('alive', $this->state()['status']);
    }

    public function test_legacy_weapon_exhaustion_affects_attack_once_and_never_damage(): void
    {
        $this->hero->update(['rules' => null, 'check_stats' => [['key' => 'str', 'label' => 'STR', 'modifier' => 3]], 'exhaustion' => 2]);
        $c = $this->hero->fresh();
        $this->assertSame(-1, app(CharacterRules::class)->weaponStat($c, 'str', false)['modifier']);
        $this->assertSame(3, app(CharacterRules::class)->weaponStat($c, 'str', false, 0, true)['modifier']);
    }

    public function test_linked_npc_consequence_belongs_to_edited_scene_not_an_active_mirror(): void
    {
        $otherScene = $this->campaign->scenes()->create(['name' => 'Prepared']);
        $npc = $this->campaign->characters()->create(['name' => 'NPC', 'kind' => 'npc', 'hp' => 4, 'max_hp' => 10, 'combat_profile' => ['lifecycle_consequences' => [['name' => 'Consequence', 'trigger' => 'on_death', 'description' => 'Prepared text']]]]);
        $this->scene->tokens()->create(['character_id' => $npc->id, 'name' => 'Active mirror', 'x' => 50, 'y' => 0]);
        $source = $otherScene->tokens()->create(['character_id' => $npc->id, 'name' => 'Prepared source', 'x' => 0, 'y' => 0]);
        app(TokenCombatActions::class)->execute($this->gm, $source, 'hp-set', ['value' => 0]);
        $this->assertSame(1, AbilityExecution::count());
        $this->assertSame((string) $otherScene->id, AbilityExecution::first()->context['sceneId']);
    }
}
