<?php

namespace Tests\Feature;

use App\Combat\AppliedConditions;
use App\Combat\ConditionRules;
use App\Combat\TypedDamage;
use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Combat;
use App\Models\User;
use App\Services\CharacterRules;
use App\Services\D20Roller;
use App\Services\DamageRoller;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\Support\SeedsCharacterCatalog;
use Tests\TestCase;

class CombatGameplayTest extends TestCase
{
    use DatabaseMigrations, SeedsCharacterCatalog;

    private $gm;

    private $player;

    private $campaign;

    private $scene;

    private $hero;

    private $actor;

    private $npc;

    private $combat;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCharacterCatalog();
        Event::fake([TabletopEvent::class]);
        [$this->gm,$this->player] = User::factory()->count(2)->create()->all();
        $this->campaign = Campaign::create(['name' => 'Combat rules']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Arena', 'grid_size' => 50, 'distance_per_cell' => 5]);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $r = app(CharacterRules::class)->defaults();
        $r['scores']['str'] = 16;
        $r['scores']['dex'] = 14;
        $r['scores']['cha'] = 18;
        $r['spellcasting_ability'] = 'cha';
        $r['proficiency_bonus'] = 3;
        $this->hero = $this->campaign->characters()->create(['name' => 'Hero', 'owner_user_id' => $this->player->id, 'rules' => $r, 'speed' => 30, 'hp' => 50, 'max_hp' => 50, 'ac' => 16, 'resources' => [], 'abilities' => []]);
        $this->actor = $this->scene->tokens()->create(['character_id' => $this->hero->id, 'name' => 'Hero', 'x' => 0, 'y' => 0]);
        $this->npc = $this->scene->tokens()->create(['name' => 'NPC', 'x' => 50, 'y' => 0, 'speed' => 30, 'ac' => 15, 'hp' => 100, 'max_hp' => 100, 'combat_profile' => ['ability_scores' => ['dex' => 14, 'str' => 16], 'saving_throws' => ['dex' => 2], 'proficiency_bonus' => 3], 'check_stats' => [['key' => 'str', 'label' => 'STR', 'modifier' => 3]]]);
        DB::table('campaign_members')->where('campaign_id', $this->campaign->id)->where('user_id', $this->player->id)->update(['active_character_id' => $this->hero->id]);
        $this->combat = Combat::create(['scene_id' => $this->scene->id, 'created_by' => $this->gm->id]);
        foreach ([$this->actor, $this->npc] as $i => $t) {
            $this->combat->combatants()->create(['token_id' => $t->id, 'position' => $i]);
        }
    }

    private function command(string $cmd, array $data = [])
    {
        return $this->actingAs($this->gm)->postJson('/api/scenes/'.$this->scene->id.'/combat/'.$cmd, ['combatId' => (string) $this->combat->id, 'clientMutationId' => (string) Str::uuid()] + $data);
    }

    private function begin()
    {
        $this->command('begin')->assertOk();
        $this->combat->refresh();
    }

    private function next()
    {
        $this->combat->refresh();
        $this->command('next', ['expectedRound' => $this->combat->round, 'expectedCurrentCombatantId' => (string) $this->combat->current_combatant_id])->assertOk();
        $this->combat->refresh();
    }

    private function ability(array $patch = []): array
    {
        return array_replace(['id' => (string) Str::uuid(), 'name' => 'Test', 'icon' => 'sword', 'description' => '', 'category' => 'attack', 'target' => 'token', 'check' => null, 'attack' => ['ability' => 'str', 'proficient' => true, 'bonus' => 0], 'activation' => 'action', 'damage' => null, 'damage_components' => [['dice' => '1d8', 'type' => 'fire']], 'costs' => [], 'result' => ['type' => 'nothing', 'target' => null, 'amount' => 0], 'enabled' => true, 'sort_order' => 0], $patch);
    }

    private function execute(array $a, ?array $command = null, $as = null)
    {
        $this->hero->update(['abilities' => [$a]]);

        return $this->actingAs($as ?? $this->player)->postJson('/api/scenes/'.$this->scene->id.'/abilities/execute', $command ?? ['characterId' => $this->hero->id, 'abilityId' => $a['id'], 'target' => ['kind' => 'token', 'id' => $this->npc->id], 'epoch' => 0, 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()]);
    }

    public function test_action_bonus_reaction_and_uuid_are_atomic_and_reset_at_own_turn_start(): void
    {
        $this->begin();
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(15);
        $a = $this->ability();
        $cmd = ['characterId' => $this->hero->id, 'abilityId' => $a['id'], 'target' => ['kind' => 'token', 'id' => $this->npc->id], 'epoch' => 0, 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid(), 'modifier' => 100, 'remainingAction' => 99];
        $first = $this->execute($a, $cmd)->assertOk()->assertJsonPath('execution.roll.modifier', 6)->json();
        $hp = $this->npc->fresh()->hp;
        $this->execute($a, $cmd)->assertOk()->assertExactJson($first);
        $this->assertSame($hp, $this->npc->fresh()->hp);
        DB::table('scene_mutation_receipts')->delete();
        $this->execute($a, $cmd)->assertOk()->assertExactJson($first);
        $this->execute($a)->assertUnprocessable();
        $this->assertSame($hp, $this->npc->fresh()->hp);
        $this->execute($this->ability(['activation' => 'bonus_action']))->assertOk();
        $reaction = $this->ability(['activation' => 'reaction']);
        $this->execute($reaction)->assertOk();
        $this->execute($reaction)->assertUnprocessable();
        $this->next();
        $this->execute($reaction)->assertUnprocessable();
        $this->next();
        $this->execute($reaction)->assertOk();
        $this->execute($a)->assertOk();
        $this->assertDatabaseCount('ability_executions', 5);
    }

    public function test_movement_consumes_world_distance_rejects_forgery_and_reconnect_restores_budget(): void
    {
        $this->begin();
        $url = '/api/tokens/'.$this->actor->id.'/move';
        $cmd = ['x' => 100, 'y' => 0, 'clientMutationId' => (string) Str::uuid(), 'remainingMovement' => 1000];
        $this->actingAs($this->player)->postJson($url, $cmd)->assertOk();
        $this->postJson($url, $cmd)->assertOk();
        $entry = $this->combat->combatants()->where('token_id', $this->actor->id)->first();
        $this->assertEquals(10, $entry->movement_spent);
        $this->postJson($url, ['x' => 400, 'y' => 0, 'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
        $this->assertEquals(100, $this->actor->fresh()->x);
        $snapshot = $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk();
        $snapshot->assertJsonPath('combat.combatants.0.budget.movementRemaining', 20)->assertJsonMissingPath('combat.combatants.1.budget');
        $this->next();
        $this->actingAs($this->player)->postJson($url, ['x' => 150, 'y' => 0, 'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
        $this->next();
        $this->assertEquals(0, $entry->fresh()->movement_spent);
    }

    public function test_typed_damage_order_same_type_grouping_and_immunity(): void
    {
        $damage = app(TypedDamage::class);
        $roll = [['type' => 'fire', 'amount' => 9], ['type' => 'fire', 'amount' => 2], ['type' => 'slashing', 'amount' => 3]];
        foreach ([['resistances' => ['fire']], ['vulnerabilities' => ['fire']], ['immunities' => ['fire']], ['resistances' => ['fire'], 'vulnerabilities' => ['fire']]] as $i => $profile) {
            $this->npc->update(['combat_profile' => $profile]);
            $r = $damage->apply($roll, $this->npc->fresh());
            $this->assertSame([8, 25, 3, 13][$i], $r['total']);
        }
        $this->npc->update(['combat_profile' => ['resistances' => ['fire']]]);
        $this->assertSame(3, $damage->apply($roll, $this->npc->fresh(), 'half')['total']);
    }

    public function test_target_saves_use_authoritative_dc_and_half_damage_and_keep_private_provenance(): void
    {
        $this->begin();
        $a = $this->ability(['category' => 'effect', 'attack' => null, 'activation' => 'free', 'save' => ['ability' => 'dex', 'dc_source' => 'spellcasting', 'dc' => 99, 'on_success' => 'half', 'on_failure' => 'full']]);
        $this->mock(DamageRoller::class)->shouldReceive('roll')->andReturn(['expression' => '1d8', 'rawDice' => [7], 'modifier' => 0, 'total' => 7]);
        $this->mock(D20Roller::class)->shouldReceive('roll')->twice()->andReturn(1, 20);
        $this->execute($a)->assertOk()->assertJsonPath('execution.outcomes.0.damage', 7)->assertJsonMissingPath('execution.outcomes.0.save.provenance')->assertJsonMissingPath('execution.outcomes.0.damageDetail');
        $this->execute($a, null, $this->gm)->assertOk()->assertJsonPath('execution.outcomes.0.damage', 3)->assertJsonPath('execution.outcomes.0.save.dc', 15)->assertJsonPath('execution.outcomes.0.save.modifier', 2);
        $this->assertSame(90, $this->npc->fresh()->hp);
    }

    public function test_conditions_apply_from_hits_immune_expire_and_combat_end_cleans_encounter_state(): void
    {
        $this->begin();
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(15);
        $a = $this->ability(['activation' => 'free', 'condition_effects' => [['key' => 'poisoned', 'when' => 'hit', 'duration_mode' => 'until_start_of_source_turn']]]);
        $this->execute($a)->assertOk();
        $this->assertSame(1, $this->npc->conditions()->where('key', 'poisoned')->count());
        $this->next();
        $this->assertSame(1, $this->npc->conditions()->count());
        $this->next();
        $this->assertSame(0, $this->npc->conditions()->count());
        $this->npc->update(['combat_profile' => ['condition_immunities' => ['poisoned']]]);
        $this->execute($a)->assertOk();
        $this->assertSame(0, $this->npc->conditions()->count());
        app(AppliedConditions::class)->apply($this->gm, $this->actor, ['key' => 'prone', 'duration_mode' => 'rounds', 'rounds' => 1]);
        $this->next();
        $this->assertSame(1, $this->actor->conditions()->count());
        $this->next();
        $this->next();
        $this->assertSame(0, $this->actor->conditions()->count());
        app(AppliedConditions::class)->apply($this->gm, $this->actor, ['key' => 'blinded']);
        $this->command('end')->assertOk();
        $this->assertSame('blinded', $this->actor->conditions()->firstOrFail()->key);
    }

    public function test_poison_prone_restraint_stun_and_blind_contexts_follow_srd_2024(): void
    {
        $this->begin();
        $rules = app(ConditionRules::class);
        $effects = app(AppliedConditions::class);
        $c = $effects->apply($this->gm, $this->actor, ['key' => 'poisoned']);
        $this->assertSame('disadvantage', $rules->context($this->actor, 'attack')['mode']);
        $this->assertSame('normal', $rules->context($this->actor, 'save', 'normal', null, 0, 'dex')['mode']);
        $this->assertSame('normal', $rules->context($this->actor, 'attack', 'advantage')['mode']);
        $effects->remove($c);
        $effects->apply($this->gm, $this->actor, ['key' => 'prone']);
        $this->actingAs($this->player)->postJson('/api/tokens/'.$this->actor->id.'/move', ['x' => 50, 'y' => 0, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->assertEquals(10, $this->combat->combatants()->where('token_id', $this->actor->id)->first()->movement_spent);
        $this->postJson('/api/tokens/'.$this->actor->id.'/stand-up', ['clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->assertSame(0, $this->actor->conditions()->count());
        $this->assertEquals(25, $this->combat->combatants()->where('token_id', $this->actor->id)->first()->movement_spent);
        $effects->apply($this->gm, $this->npc, ['key' => 'restrained']);
        $this->assertEquals(0, $rules->speed($this->npc));
        $this->assertSame('disadvantage', $rules->context($this->npc, 'save', 'normal', null, 0, 'dex')['mode']);
        $effects->apply($this->gm, $this->actor, ['key' => 'stunned']);
        $this->assertTrue($rules->inactive($this->actor));
        $this->assertEquals(30, $rules->speed($this->actor));
        $this->assertNotEmpty($rules->context($this->actor, 'save', 'normal', null, 0, 'str')['automaticFailure']);
        $effects->apply($this->gm, $this->npc, ['key' => 'blinded']);
        $this->assertNotEmpty($rules->context($this->npc, 'check', 'normal', null, 0, null, true)['automaticFailure']);
    }

    public function test_standalone_npc_executes_and_player_cannot_spend_or_override_it(): void
    {
        $this->begin();
        $this->next();
        $a = $this->ability();
        $this->npc->update(['abilities' => [$a]]);
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(15);
        $cmd = ['actorTokenId' => $this->npc->id, 'abilityId' => $a['id'], 'epoch' => 0, 'target' => ['kind' => 'token', 'id' => $this->actor->id], 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()];
        $url = '/api/scenes/'.$this->scene->id.'/abilities/execute';
        $this->actingAs($this->player)->postJson($url, $cmd)->assertForbidden();
        $this->actingAs($this->gm)->postJson($url, $cmd)->assertOk()->assertJsonPath('execution.roll.modifier', 6);
        $this->postJson($url, $cmd)->assertOk();
        $this->assertEquals(1, DB::table('ability_executions')->where('token_id', $this->npc->id)->count());
        $entry = $this->combat->combatants()->where('token_id', $this->npc->id)->first();
        $this->actingAs($this->player)->postJson('/api/scenes/'.$this->scene->id.'/combat/override', ['combatId' => $this->combat->id, 'combatantId' => $entry->id, 'action_available' => true, 'clientMutationId' => (string) Str::uuid()])->assertForbidden();
    }

    public function test_each_turn_boundary_duration_and_source_removal(): void
    {
        $this->begin();
        $effects = app(AppliedConditions::class);
        foreach (['until_end_of_source_turn', 'until_start_of_source_turn', 'until_end_of_target_turn', 'until_start_of_target_turn'] as $mode) {
            $c = $effects->apply($this->gm, $this->npc, ['key' => 'poisoned', 'duration_mode' => $mode], $this->actor);
            $this->next();
            $this->assertSame(in_array($mode, ['until_end_of_source_turn', 'until_start_of_target_turn']) ? 0 : 1, $this->npc->conditions()->count(), $mode);
            $this->next();
            $this->assertSame(0, $this->npc->conditions()->count(), $mode);
        }
        $legacy = $effects->apply($this->gm, $this->actor, ['key' => 'poisoned']);
        $legacy->update(['combat_id' => null]);
        $effects->apply($this->gm, $this->npc, ['key' => 'blinded', 'duration_mode' => 'until_start_of_source_turn'], $this->actor);
        $entry = $this->combat->combatants()->where('token_id', $this->actor->id)->first();
        $this->command('remove', ['combatantId' => (string) $entry->id])->assertOk();
        $this->assertSame(0, $this->npc->conditions()->count());
        $this->command('end')->assertOk();
        $this->assertSame(1, $this->actor->conditions()->count());
    }

    public function test_rejected_action_does_not_consume_resources_or_roll_and_hidden_reasons_are_redacted(): void
    {
        $this->begin();
        $this->hero->update(['resources' => [['key' => 'focus', 'current' => 3, 'max' => 3]]]);
        $a = $this->ability(['costs' => [['key' => 'focus', 'amount' => 1]]]);
        app(AppliedConditions::class)->apply($this->gm, $this->actor, ['key' => 'poisoned'], null, null, 'gm_only');
        $this->mock(D20Roller::class)->shouldReceive('roll')->twice()->andReturn(15);
        $r = $this->execute($a)->assertOk();
        $r->assertJsonPath('execution.roll.rollMode', 'disadvantage')->assertJsonPath('execution.roll.context.disadvantage.0.label', 'Модификатор ГМ')->assertJsonMissingPath('execution.roll.context.disadvantage.0.key');
        $hp = $this->npc->fresh()->hp;
        $this->execute($a)->assertUnprocessable();
        $this->assertSame(2, $this->hero->fresh()->resources[0]['current']);
        $this->assertSame($hp, $this->npc->fresh()->hp);
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->scene->id.'/combat/history')->assertForbidden();
        $this->actingAs($this->gm)->getJson('/api/scenes/'.$this->scene->id.'/combat/history')->assertOk()->assertJsonFragment(['type' => 'attack.roll']);
    }

    public function test_nat_one_twenty_and_critical_dice_do_not_double_flat_bonus(): void
    {
        $this->begin();
        $this->npc->update(['ac' => 99]);
        $this->mock(D20Roller::class)->shouldReceive('roll')->twice()->andReturn(1, 20);
        $a = $this->ability(['activation' => 'free', 'damage_components' => [['dice' => '1d4+3', 'type' => 'slashing']]]);
        $this->execute($a)->assertOk()->assertJsonPath('execution.success', false)->assertJsonPath('execution.outcomes.0.damage', 0);
        $r = $this->execute($a)->assertOk()->assertJsonPath('execution.critical', true)->json('execution.damage');
        $this->assertCount(2, $r['rawDice']);
        $this->assertSame(array_sum($r['rawDice']) + 3, $r['total']);
    }

    public function test_unconscious_auto_fails_saves_leaves_prone_and_blocks_spending(): void
    {
        $this->begin();
        $effects = app(AppliedConditions::class);
        $c = $effects->apply($this->gm, $this->npc, ['key' => 'unconscious']);
        $this->mock(D20Roller::class)->shouldNotReceive('roll');
        $a = $this->ability(['category' => 'effect', 'attack' => null, 'activation' => 'free', 'save' => ['ability' => 'dex', 'dc_source' => 'fixed', 'dc' => 1, 'on_success' => 'negates', 'on_failure' => 'full']]);
        $this->execute($a)->assertOk()->assertJsonPath('execution.outcomes.0.save.automaticFailure', true);
        $effects->remove($c);
        $this->assertTrue(app(ConditionRules::class)->prone($this->npc));
        $this->assertEquals(30, app(ConditionRules::class)->speed($this->npc));
        $this->actingAs($this->player)->postJson('/api/tokens/'.$this->npc->id.'/condition-remove', ['conditionId' => $this->npc->conditions()->first()->id, 'clientMutationId' => (string) Str::uuid()])->assertForbidden();
        $effects->apply($this->gm, $this->actor, ['key' => 'stunned']);
        $this->execute($this->ability())->assertUnprocessable();
    }

    public function test_aoe_rolls_damage_once_and_resolves_each_targets_own_save(): void
    {
        $this->begin();
        $this->mock(D20Roller::class)->shouldReceive('roll')->twice()->andReturn(1, 20);
        $this->mock(DamageRoller::class)->shouldReceive('roll')->once()->andReturn(['expression' => '1d8', 'rawDice' => [7], 'modifier' => 0, 'total' => 7]);
        $a = $this->ability(['category' => 'effect', 'attack' => null, 'target' => 'point', 'area' => ['shape' => 'circle', 'size' => 20, 'width' => 5], 'save' => ['ability' => 'dex', 'dc_source' => 'fixed', 'dc' => 15, 'on_success' => 'half', 'on_failure' => 'full']]);
        $r = $this->execute($a, ['characterId' => $this->hero->id, 'abilityId' => $a['id'], 'target' => ['kind' => 'point', 'x' => 0, 'y' => 0], 'epoch' => 0, 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->assertSame([7, 3], array_column($r->json('execution.outcomes'), 'damage'));
    }

    public function test_gm_authors_standalone_combat_metadata_and_validates_local_keys(): void
    {
        $a = $this->ability();
        $url = '/api/tokens/'.$this->npc->id;
        $this->actingAs($this->gm)->patchJson($url, ['abilities' => [$a], 'combat_profile' => ['resistances' => ['fire']], 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->assertSame($a['id'], $this->npc->fresh()->abilities[0]['id']);
        $this->patchJson($url, ['combat_profile' => ['immunities' => ['invented']], 'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
        $this->actingAs($this->player)->patchJson($url, ['combat_profile' => ['immunities' => ['fire']], 'clientMutationId' => (string) Str::uuid()])->assertForbidden();
        $this->begin();
        $entry = $this->combat->combatants()->where('token_id', $this->actor->id)->first();
        $this->command('override', ['combatantId' => $entry->id, 'action_available' => false, 'movement_spent' => 12])->assertOk();
        $this->assertFalse($entry->fresh()->action_available);
        $this->assertEquals(12, $entry->fresh()->movement_spent);
    }

    public function test_source_deletion_broadcasts_expired_instances_and_character_speed_updates_budget(): void
    {
        $this->begin();
        app(AppliedConditions::class)->apply($this->gm, $this->npc, ['key' => 'poisoned', 'duration_mode' => 'until_start_of_source_turn'], $this->actor);
        $this->actingAs($this->gm)->patchJson('/api/tokens/'.$this->actor->id, ['speed' => 40, 'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('combat.combatants.0.budget.speed', 40);
        $this->deleteJson('/api/tokens/'.$this->actor->id, ['clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->assertSame(0, $this->npc->conditions()->count());
        Event::assertDispatched(TabletopEvent::class, function ($e) {
            $p = (array) ($e->envelope['payload'] ?? []);

            return str_ends_with($e->channel, '.user.'.$this->player->id) && isset($p['deletedId']) && collect($p['tokens'] ?? [])->contains(fn ($t) => $t['id'] === (string) $this->npc->id && $t['conditions'] === []);
        });
    }
}
