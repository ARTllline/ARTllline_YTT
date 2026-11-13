<?php

namespace Tests\Feature;

use App\Compendium\BasicExecutionProfiles;
use App\Events\TabletopEvent;
use App\Items\ItemActions;
use App\Items\ItemRules;
use App\Models\AbilityExecution;
use App\Models\Campaign;
use App\Models\Combat;
use App\Models\ItemDefinition;
use App\Models\User;
use App\Services\CharacterGameplay;
use App\Services\CharacterRules;
use App\Services\CheckRoller;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class SessionContentAutomationTest extends TestCase
{
    use DatabaseMigrations;

    private $gm;

    private $player;

    private $other;

    private $campaign;

    private $scene;

    private $hero;

    private $target;

    private array $spell;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        [$this->gm, $this->player, $this->other] = User::factory()->count(3)->create()->all();
        $this->campaign = Campaign::create(['name' => 'Isolated basic recipes']);
        foreach ([$this->gm, $this->player, $this->other] as $u) {
            $this->campaign->members()->attach($u, ['role' => $u === $this->gm ? 'gm' : 'player']);
        }
        $this->scene = $this->campaign->scenes()->create(['name' => 'Session']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->spell = BasicExecutionProfiles::spell();
        $this->spell['spell']['prepared'] = true;
        $this->spell['spell']['content'] = $this->content('cure-wounds');
        $rules = app(CharacterRules::class)->defaults();
        $rules['scores']['str'] = 16;
        $rules['scores']['wis'] = 18;
        $rules['spellcasting_ability'] = 'wis';
        $this->hero = $this->campaign->characters()->create(['name' => 'Hero', 'owner_user_id' => $this->player->id, 'kind' => 'player_character', 'hp' => 10, 'max_hp' => 50,
            'rules' => $rules, 'resources' => [['key' => 'focus', 'label' => 'Focus', 'current' => 2, 'max' => 2]], 'abilities' => [$this->spell],
            'spellcasting' => ['slots' => [1 => ['max' => 2, 'current' => 2], 2 => ['max' => 1, 'current' => 1]]]]);
        $this->scene->tokens()->create(['name' => 'Hero', 'character_id' => $this->hero->id, 'x' => 0, 'y' => 0]);
        $this->target = $this->scene->tokens()->create(['name' => 'Target', 'hp' => 10, 'max_hp' => 50, 'ac' => 10, 'x' => 50, 'y' => 0]);
        DB::table('campaign_members')->where('campaign_id', $this->campaign->id)->where('user_id', $this->player->id)->update(['active_character_id' => $this->hero->id]);
    }

    private function content(string $id): array
    {
        return ['gates' => ['browse' => true, 'copy' => true, 'execute' => true], 'execution_profile' => BasicExecutionProfiles::reference($id)];
    }

    private function item(string $id)
    {
        $d = (new ItemDefinition)->forceFill(BasicExecutionProfiles::item($id) + ['campaign_id' => $this->campaign->id, 'name' => $id, 'icon' => 'potion', 'rarity' => 'common',
            'width' => 1, 'height' => 1, 'modifiers' => [], 'content' => $this->content($id)]);
        $d->save();

        return $this->hero->inventory()->create(['item_definition_id' => $d->id, 'quantity' => 2, 'x' => 0, 'y' => 0,
            'equipped_slot' => $id === 'longsword' ? 'main_hand' : null, 'grip' => 'one', 'weapon_proficient' => true, 'attack_ability' => 'auto']);
    }

    private function initiate(array $data = [], $user = null)
    {
        return $this->actingAs($user ?? $this->player)->postJson('/api/scenes/'.$this->scene->id.'/content-use', $data + ['characterId' => $this->hero->id, 'abilityId' => $this->spell['id'],
            'targetId' => $this->target->id, 'epoch' => 0, 'clientMutationId' => (string) Str::uuid()]);
    }

    private function resolve(string $id, array $data = [], $user = null)
    {
        return $this->actingAs($user ?? $this->gm)->postJson('/api/scenes/'.$this->scene->id.'/combat/session', $data + ['action' => 'resolve', 'executionId' => $id,
            'status' => 'resolved', 'confirmed' => true, 'clientMutationId' => (string) Str::uuid()]);
    }

    protected function tearDown(): void
    {
        DB::table('item_definitions')->update(['content' => null]);
        parent::tearDown();
    }

    public function test_cure_wounds_roll_is_held_then_confirmed_with_scaling_and_slot_once(): void
    {
        $d = ['castLevel' => 2, 'clientMutationId' => (string) Str::uuid()];
        $r = $this->initiate($d)->assertOk()->assertJsonMissingPath('execution.gmContext');
        $id = $r->json('execution.id');
        $this->initiate($d)->assertOk()->assertJsonPath('execution.id', $id);
        $roll = AbilityExecution::find($id)->result['gmContext']['contentUse']['automatic']['rolls']['healingRoll'];
        $this->assertSame('4d8+4', $roll['expression']);
        $this->assertCount(4, $roll['rawDice']);
        $this->assertSame(10, $this->target->fresh()->hp);
        $this->assertSame(1, $this->hero->fresh()->spellcasting['slots'][2]['current']);
        $this->resolve($id, [], $this->player)->assertForbidden();
        $d = ['clientMutationId' => (string) Str::uuid(), 'amount' => 9999, 'effect' => 'damage'];
        $this->resolve($id, $d)->assertOk();
        $this->resolve($id, $d)->assertOk();
        $this->assertSame(10 + $roll['total'], $this->target->fresh()->hp);
        $this->assertSame(0, $this->hero->fresh()->spellcasting['slots'][2]['current']);
        $this->resolve($id)->assertConflict();
        $this->assertSame(1, DB::table('combat_events')->where('type', 'manual.resolved')->count());
    }

    public function test_potion_uses_stored_roll_consumes_one_and_caps_healing(): void
    {
        $item = $this->item('potion_of_healing');
        $this->target->update(['hp' => 49]);
        $id = $this->initiate(['abilityId' => null, 'inventoryItemId' => $item->id])->assertOk()->json('execution.id');
        $roll = AbilityExecution::find($id)->result['gmContext']['contentUse']['automatic']['rolls']['healingRoll'];
        $this->assertSame('2d4+2', $roll['expression']);
        $this->assertSame(2, $item->fresh()->quantity);
        $this->resolve($id)->assertOk();
        $this->assertSame(50, $this->target->fresh()->hp);
        $this->assertSame(1, $item->fresh()->quantity);
    }

    public function test_longsword_natural_twenty_crit_doubles_dice_and_does_not_apply_sap(): void
    {
        $item = $this->item('longsword');
        $item->update(['grip' => 'two']);
        $this->mock(CheckRoller::class, function ($mock) {
            $mock->shouldReceive('roll')->once()->andReturn(['rawDice' => [20], 'natural' => 20, 'modifier' => 5, 'total' => 25, 'dc' => 10, 'success' => true, 'rollMode' => 'normal', 'selectedDie' => 0]);
        });
        $id = $this->initiate(['abilityId' => null, 'inventoryItemId' => $item->id])->assertOk()->json('execution.id');
        $r = AbilityExecution::find($id)->result['gmContext']['contentUse']['automatic']['rolls'];
        $this->assertTrue($r['critical']);
        $this->assertCount(2, $r['damageRolls'][0]['roll']['rawDice']);
        $this->assertStringContainsString('d10', $r['damageRolls'][0]['roll']['expression']);
        $this->assertSame(10, $this->target->fresh()->hp);
        $this->resolve($id)->assertOk();
        $this->assertSame(max(0, 10 - $r['damageRolls'][0]['amount']), $this->target->fresh()->hp);
        $this->assertSame(2, $item->fresh()->quantity);
        $this->assertSame(0, $this->target->conditions()->count());
    }

    public function test_longsword_natural_one_misses_even_against_low_ac(): void
    {
        $item = $this->item('longsword');
        $this->target->update(['ac' => 1]);
        $this->mock(CheckRoller::class, function ($mock) {
            $mock->shouldReceive('roll')->once()->andReturn(['rawDice' => [1], 'natural' => 1, 'modifier' => 5, 'total' => 6, 'dc' => 1, 'success' => true, 'rollMode' => 'normal', 'selectedDie' => 0]);
        });
        $id = $this->initiate(['abilityId' => null, 'inventoryItemId' => $item->id])->assertOk()->json('execution.id');
        $this->resolve($id)->assertOk();
        $this->assertSame(10, $this->target->fresh()->hp);
    }

    public function test_resources_are_checked_and_spent_by_existing_engine(): void
    {
        $a = $this->spell;
        $a['costs'] = [['key' => 'focus', 'amount' => 1]];
        $this->hero->update(['abilities' => [$a]]);
        $id = $this->initiate()->assertOk()->json('execution.id');
        $this->resolve($id)->assertOk();
        $this->assertSame(1, $this->hero->fresh()->resources[0]['current']);
        $a['costs'][0]['amount'] = 3;
        $this->hero->update(['abilities' => [$a]]);
        $this->initiate()->assertUnprocessable();
    }

    public function test_permissions_visibility_range_stats_and_slot_are_required(): void
    {
        $this->initiate([], $this->other)->assertForbidden();
        $this->initiate(['epoch' => 123])->assertConflict();
        $this->target->update(['is_hidden' => true]);
        $this->initiate()->assertNotFound();
        $this->target->update(['is_hidden' => false, 'x' => 5000]);
        $this->initiate()->assertUnprocessable();
        $this->target->update(['x' => 50]);
        $this->hero->update(['rules' => null]);
        $this->initiate()->assertUnprocessable();
    }

    public function test_changed_hp_or_ac_after_roll_is_rejected_without_costs(): void
    {
        $id = $this->initiate()->assertOk()->json('execution.id');
        $this->target->update(['ac' => 19]);
        $this->resolve($id)->assertConflict();
        $this->assertSame(2, $this->hero->fresh()->spellcasting['slots'][1]['current']);
        $this->assertSame('pending', AbilityExecution::find($id)->result['manualResolution']);
        $this->resolve($id, ['status' => 'dismissed'])->assertOk();
    }

    public function test_removed_slot_or_revoked_owner_blocks_confirmation_and_preserves_hp(): void
    {
        $id = $this->initiate()->assertOk()->json('execution.id');
        $this->hero->update(['spellcasting' => ['slots' => []]]);
        $this->resolve($id)->assertUnprocessable();
        $this->assertSame(10, $this->target->fresh()->hp);
        $this->hero->update(['owner_user_id' => $this->other->id]);
        $this->resolve($id)->assertForbidden();
    }

    public function test_cannot_bypass_confirmation_using_ability_or_inventory_endpoints(): void
    {
        $d = ['characterId' => $this->hero->id, 'epoch' => 0, 'rollMode' => 'normal', 'target' => ['kind' => 'token', 'id' => $this->target->id], 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($this->player)->postJson('/api/scenes/'.$this->scene->id.'/abilities/execute', $d + ['abilityId' => $this->spell['id']])->assertUnprocessable();
        $item = $this->item('potion_of_healing');
        $this->actingAs($this->player)->postJson('/api/scenes/'.$this->scene->id.'/inventory/use', $d + ['inventoryItemId' => $item->id])->assertUnprocessable();
        $this->assertSame(10, $this->target->fresh()->hp);
    }

    public function test_reference_gate_or_changed_mechanics_never_grant_automation(): void
    {
        $a = $this->spell;
        $a['result']['dice'] = '20d20';
        $this->hero->update(['abilities' => [$a]]);
        $this->initiate()->assertUnprocessable();
        $a = $this->spell;
        $a['spell']['content']['gates']['execute'] = false;
        $a['target'] = 'none';
        $a['result'] = ['type' => 'nothing', 'amount' => 0];
        $this->hero->update(['abilities' => [$a]]);
        $id = $this->initiate()->assertOk()->json('execution.id');
        $this->assertNull(AbilityExecution::find($id)->result['gmContext']['contentUse']['automatic']);
        $this->assertFalse($this->hero->fresh()->abilities[0]['spell']['content']['gates']['execute']);
    }

    public function test_combat_budget_is_not_spent_by_preview_and_is_spent_once_on_confirmation(): void
    {
        $combat = Combat::create(['scene_id' => $this->scene->id, 'created_by' => $this->gm->id, 'status' => 'active']);
        $actor = $this->scene->tokens()->where('character_id', $this->hero->id)->firstOrFail();
        $entry = $combat->combatants()->create(['token_id' => $actor->id, 'position' => 0, 'action_available' => true, 'bonus_available' => true]);
        $combat->update(['current_combatant_id' => $entry->id]);
        $id = $this->initiate()->assertOk()->json('execution.id');
        $this->assertTrue($entry->fresh()->action_available);
        $this->resolve($id)->assertOk();
        $this->assertFalse($entry->fresh()->action_available);
        $this->assertSame(1, DB::table('spell_turn_slots')->count());
        $this->initiate()->assertUnprocessable();
    }

    public function test_hidden_target_replay_and_confirmation_do_not_apply_result(): void
    {
        $body = ['clientMutationId' => (string) Str::uuid()];
        $id = $this->initiate($body)->assertOk()->json('execution.id');
        $this->target->update(['is_hidden' => true]);
        $this->initiate($body)->assertNotFound();
        $this->resolve($id)->assertNotFound();
        $this->assertSame(10, $this->target->fresh()->hp);
        $this->assertSame(2, $this->hero->fresh()->spellcasting['slots'][1]['current']);
    }

    public function test_approved_profiles_survive_normal_authoring_validation(): void
    {
        $ability = $this->spell;
        $ability['spell']['content'] += ['ruleset' => 'dnd-2024', 'checksum' => str_repeat('a', 64), 'projection_checksum' => str_repeat('b', 64)];
        $data = Validator::make(['abilities' => [$ability]], CharacterGameplay::rules())->validate();
        app(CharacterGameplay::class)->validate($this->campaign, $data, null);
        $this->assertTrue(BasicExecutionProfiles::allowed($data['abilities'][0]));
        foreach (['longsword', 'potion_of_healing'] as $id) {
            $definition = $this->item($id)->definition;
            app(ItemRules::class)->validateDefinition($definition);
            $this->assertTrue(BasicExecutionProfiles::allowed($definition));
        }
    }

    public function test_changed_epoch_rejects_saved_roll_without_spending_slot(): void
    {
        $id = $this->initiate()->assertOk()->json('execution.id');
        $this->campaign->increment('live_revision');
        $this->resolve($id)->assertConflict();
        $this->assertSame(2, $this->hero->fresh()->spellcasting['slots'][1]['current']);
        $this->assertSame(10, $this->target->fresh()->hp);
    }

    public function test_failure_after_effect_rolls_back_hp_slot_logs_and_request(): void
    {
        $item = $this->item('potion_of_healing');
        $id = $this->initiate(['abilityId' => null, 'inventoryItemId' => $item->id])->assertOk()->json('execution.id');
        $this->partialMock(ItemActions::class, function ($mock) {
            $mock->shouldReceive('consume')->once()->andThrow(new HttpException(422, 'Injected failure'));
        });
        Event::fake([TabletopEvent::class]);
        $this->resolve($id)->assertUnprocessable();
        Event::assertNotDispatched(TabletopEvent::class);
        $this->assertSame(10, $this->target->fresh()->hp);
        $this->assertSame(2, $item->fresh()->quantity);
        $this->assertSame(1, AbilityExecution::count());
        $this->assertSame('pending', AbilityExecution::find($id)->result['manualResolution']);
        $this->assertSame(0, DB::table('combat_events')->where('type', 'manual.resolved')->count());
    }
}
