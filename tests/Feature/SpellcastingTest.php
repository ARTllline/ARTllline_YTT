<?php

namespace Tests\Feature;

use App\Actions\TokenCombatActions;
use App\Combat\AppliedConditions;
use App\Combat\TurnBudget;
use App\Compendium\SrdSpellMapper;
use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Combat;
use App\Models\ItemDefinition;
use App\Models\LootContainer;
use App\Models\SceneProp;
use App\Models\SpellEffect;
use App\Models\User;
use App\Services\CharacterGameplay;
use App\Services\CharacterRules;
use App\Services\D20Roller;
use App\Spells\SpellCasting;
use App\Spells\SpellEffects;
use App\Spells\SpellProjection;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\SeedsCharacterCatalog;
use Tests\TestCase;

class SpellcastingTest extends TestCase
{
    use DatabaseMigrations,SeedsCharacterCatalog;

    private $gm;

    private $a;

    private $b;

    private $campaign;

    private $scene;

    private $hero;

    private $friend;

    private $actor;

    private $enemy;

    private $loot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCharacterCatalog();
        Event::fake([TabletopEvent::class]);
        [$this->gm,$this->a,$this->b] = User::factory()->count(3)->create()->all();
        $this->campaign = Campaign::create(['name' => 'Items']);
        foreach ([$this->gm, $this->a, $this->b] as $u) {
            $this->campaign->members()->attach($u, ['role' => $u === $this->gm ? 'gm' : 'player']);
        }
        $this->scene = $this->campaign->scenes()->create(['name' => 'Arena', 'width' => 10000, 'height' => 10000, 'grid_size' => 50, 'distance_per_cell' => 5]);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $r = app(CharacterRules::class)->defaults();
        $r['scores']['str'] = 16;
        $r['scores']['dex'] = 14;
        $r['proficiency_bonus'] = 3;
        $this->hero = $this->campaign->characters()->create(['name' => 'A', 'owner_user_id' => $this->a->id, 'rules' => $r, 'ac' => 10, 'speed' => 30, 'hp' => 5, 'max_hp' => 50, 'resources' => [], 'abilities' => [], 'kind' => 'player_character']);
        $this->friend = $this->campaign->characters()->create(['name' => 'B', 'owner_user_id' => $this->b->id, 'rules' => $r, 'ac' => 10, 'speed' => 30, 'hp' => 50, 'max_hp' => 50, 'resources' => [], 'abilities' => [], 'kind' => 'player_character']);
        $this->actor = $this->scene->tokens()->create(['character_id' => $this->hero->id, 'name' => 'A', 'x' => 0, 'y' => 0]);
        $this->scene->tokens()->create(['character_id' => $this->friend->id, 'name' => 'B', 'x' => 0, 'y' => 50]);
        $this->enemy = $this->scene->tokens()->create(['name' => 'Target', 'x' => 50, 'y' => 0, 'hp' => 999, 'max_hp' => 999, 'ac' => 10]);
        foreach ([[$this->a, $this->hero], [$this->b, $this->friend]] as [$u,$c]) {
            DB::table('campaign_members')->where('campaign_id', $this->campaign->id)->where('user_id', $u->id)->update(['active_character_id' => $c->id]);
        }
        $prop = SceneProp::create(['scene_id' => $this->scene->id, 'asset_id' => null, 'name' => 'Chest', 'x' => 50, 'y' => 50]);
        $this->loot = LootContainer::create(['scene_id' => $this->scene->id, 'prop_id' => $prop->id, 'name' => 'Chest', 'created_by' => $this->gm->id, 'is_open' => true]);
        $this->actingAs($this->a);
    }

    private function spell(string $key): array
    {
        $records = json_decode(file_get_contents(base_path('tests/Fixtures/compendium/spells-2024.json')), true);
        $raw = collect($records)->first(fn ($r) => $r['data']['index'] === $key)['data'];
        $n = app(SrdSpellMapper::class)->map($raw) + ['name' => $raw['name'], 'source_key' => $key];
        $ability = app(SpellProjection::class)->ability($n, count($this->hero->abilities));
        $ability['spell']['prepared'] = true;
        $rules = $this->hero->rules;
        $rules['scores']['cha'] = 18;
        $rules['spellcasting_ability'] = 'cha';
        $state = app(SpellCasting::class)->state($this->hero);
        for ($i = 1; $i <= 9; $i++) {
            $state['slots'][$i] = ['max' => 3, 'current' => 3];
        }
        $this->hero->update(['abilities' => [...$this->hero->abilities, $ability], 'rules' => $rules, 'spellcasting' => $state]);

        return $ability;
    }

    private function cast(array $a, array $patch = [])
    {
        return $this->actingAs($this->a)->postJson('/api/scenes/'.$this->scene->id.'/abilities/execute', array_replace(['characterId' => $this->hero->id, 'abilityId' => $a['id'], 'epoch' => 0, 'target' => ['kind' => 'token', 'id' => $this->enemy->id], 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()], $patch));
    }

    public function test_spell_attack_cantrip_uses_character_rules_and_critical_typed_damage(): void
    {
        $a = $this->spell('poison-spray');
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(20);
        $this->cast($a)->assertOk()->assertJsonPath('execution.roll.modifier', 7)->assertJsonPath('execution.critical', true);
        $this->assertSame(3, $this->hero->fresh()->spellcasting['slots'][1]['current']);
    }

    public function test_spell_slots_upcasting_half_save_geometry_and_retry(): void
    {
        $a = $this->spell('fireball');
        $this->enemy->update(['check_stats' => [['key' => 'save_dex', 'label' => 'DEX', 'modifier' => 100]], 'combat_profile' => ['resistances' => ['fire']]]);
        $this->actor->update(['x' => 500]); // actor excluded by the server's circle geometry
        $uuid = (string) Str::uuid();
        $cmd = ['castLevel' => 4, 'target' => ['kind' => 'point', 'x' => 50, 'y' => 0], 'clientMutationId' => $uuid];
        $r = $this->cast($a, $cmd)->assertOk()->assertJsonPath('execution.castLevel', 4)->assertJsonPath('execution.damage.expression', '9d6')->json();
        $this->cast($a, $cmd)->assertOk()->assertExactJson($r);
        $this->assertSame(2, $this->hero->fresh()->spellcasting['slots'][4]['current']);
        $this->assertSame((int) floor(floor($r['execution']['damage']['total'] / 2) / 2), collect($r['execution']['outcomes'])->firstWhere('tokenId', (string) $this->enemy->id)['damage']);
    }

    public function test_invalid_downcast_range_ownership_and_empty_slots_roll_back(): void
    {
        $a = $this->spell('inflict-wounds');
        $this->cast($a, ['castLevel' => 0])->assertUnprocessable();
        $this->enemy->update(['x' => 2000]);
        $this->cast($a)->assertUnprocessable();
        $this->assertSame(3, $this->hero->fresh()->spellcasting['slots'][1]['current']);
        $state = $this->hero->spellcasting;
        $state['slots'][1]['current'] = 0;
        $this->hero->update(['spellcasting' => $state]);
        $this->cast($a)->assertUnprocessable();
        $this->actingAs($this->b)->postJson('/api/scenes/'.$this->scene->id.'/abilities/execute', ['characterId' => $this->hero->id, 'abilityId' => $a['id'], 'epoch' => 0, 'target' => null, 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()])->assertForbidden();
    }

    public function test_healing_upcasts_caps_hp_and_does_not_repeat(): void
    {
        $a = $this->spell('cure-wounds');
        $uuid = (string) Str::uuid();
        $cmd = ['castLevel' => 2, 'target' => ['kind' => 'token', 'id' => $this->actor->id], 'clientMutationId' => $uuid];
        $this->cast($a, $cmd)->assertOk();
        $hp = $this->hero->fresh()->hp;
        $this->assertGreaterThan(5, $hp);
        $this->assertLessThanOrEqual(50, $hp);
        $this->cast($a, $cmd)->assertOk();
        $this->assertSame($hp, $this->hero->fresh()->hp);
        $this->assertSame(2, $this->hero->fresh()->spellcasting['slots'][2]['current']);
    }

    public function test_concentration_replacement_damage_save_incapacitation_and_modifiers(): void
    {
        $a = $this->spell('shield-of-faith');
        $b = $this->spell('bless');
        $self = ['target' => ['kind' => 'token', 'id' => $this->actor->id]];
        $this->cast($a, $self)->assertOk();
        $this->assertSame(12, $this->hero->fresh()->ac);
        $this->cast($b, $self)->assertOk();
        $this->assertSame(10, $this->hero->fresh()->ac);
        $this->assertSame(1, SpellEffect::whereNull('ended_at')->where('concentration', true)->count());
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(1);
        app(TokenCombatActions::class)->adjustHp($this->gm, $this->actor, -1);
        $this->assertSame(0, SpellEffect::whereNull('ended_at')->count());
        $this->cast($a, $self)->assertOk();
        app(AppliedConditions::class)->apply($this->gm, $this->actor, ['key' => 'incapacitated']);
        $this->assertSame(0, SpellEffect::whereNull('ended_at')->count());
    }

    public function test_srd_one_slot_per_current_turn_and_slots_persist_after_combat(): void
    {
        $a = $this->spell('cure-wounds');
        $b = $this->spell('healing-word');
        $cantrip = $this->spell('poison-spray');
        $combat = Combat::create(['scene_id' => $this->scene->id, 'created_by' => $this->gm->id, 'status' => 'active', 'round' => 1]);
        $entry = $combat->combatants()->create(['token_id' => $this->actor->id, 'position' => 0]);
        $combat->update(['current_combatant_id' => $entry->id]);
        $self = ['target' => ['kind' => 'token', 'id' => $this->actor->id]];
        $this->cast($a, $self)->assertOk();
        $this->assertFalse(app(SpellCasting::class)->availability($this->hero->fresh(), $b)['available']);
        $this->cast($b, $self)->assertUnprocessable();
        $entry->update(['action_available' => true]);
        $this->cast($cantrip)->assertOk();
        $combat->update(['status' => 'ended']);
        $this->assertSame(2, $this->hero->fresh()->spellcasting['slots'][1]['current']);
    }

    public function test_gm_slot_restore_and_component_checks(): void
    {
        $a = $this->spell('healing-word');
        $url = '/api/campaigns/'.$this->campaign->id.'/spellcasting';
        $d = ['characterId' => $this->hero->id, 'action' => 'configure', 'verbal_blocked' => true, 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($this->a)->postJson($url, $d)->assertForbidden();
        $this->actingAs($this->gm)->postJson($url, $d)->assertOk();
        $this->cast($a)->assertUnprocessable();
        $this->actingAs($this->gm)->postJson($url, ['characterId' => $this->hero->id, 'action' => 'restore', 'clientMutationId' => (string) Str::uuid()])->assertOk();
    }

    public function test_all_339_spells_project_validate_and_preserve_reference_without_crashing(): void
    {
        $records = json_decode(file_get_contents(base_path('tests/Fixtures/compendium/spells-2024.json')), true);
        $this->assertCount(339, $records);
        foreach ($records as $record) {
            $raw = $record['data'];
            $n = app(SrdSpellMapper::class)->map($raw) + ['name' => $raw['name'], 'source_key' => $raw['index']];
            $a = app(SpellProjection::class)->ability($n, 0);
            $v = Validator::make(['abilities' => [$a]], CharacterGameplay::rules());
            $this->assertFalse($v->fails(), $raw['index'].': '.$v->errors()->toJson());
            $data = ['abilities' => [$a]];
            app(CharacterGameplay::class)->validate($this->campaign, $data, $this->hero);
            $this->assertContains($a['spell']['coverage'], ['FULL', 'PARTIAL', 'MANUAL']);
            $this->assertStringContainsString($n['description'], $a['spell']['reference']);
        }
    }

    public function test_scroll_uses_its_fixed_attack_no_character_slot_and_consumes_once(): void
    {
        $a = $this->spell('poison-spray');
        $state = $this->hero->spellcasting;
        $state['scroll_list'] = ['poison-spray'];
        $this->hero->update(['spellcasting' => $state]);
        $d = (new ItemDefinition)->forceFill(['campaign_id' => $this->campaign->id, 'name' => 'Scroll', 'icon' => 'item_scroll', 'category' => 'scroll', 'rarity' => 'common', 'max_stack' => 20, 'width' => 1, 'height' => 1, 'equipment_slots' => [], 'modifiers' => [], 'gameplay' => ['use' => ['scroll' => true, 'consume' => true, 'ability' => $a]]]);
        $d->save();
        $item = $this->hero->inventory()->create(['item_definition_id' => $d->id, 'quantity' => 1, 'x' => 0, 'y' => 0]);
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(15);
        $url = '/api/scenes/'.$this->scene->id.'/inventory/use';
        $data = ['inventoryItemId' => $item->id, 'characterId' => $this->hero->id, 'epoch' => 0, 'target' => ['kind' => 'token', 'id' => $this->enemy->id], 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()];
        $r = $this->postJson($url, $data)->assertOk()->assertJsonPath('execution.roll.modifier', 5)->json();
        $this->postJson($url, $data)->assertOk()->assertExactJson($r);
        $this->assertSame(0, $item->fresh()->quantity);
        $this->assertSame(3, $this->hero->fresh()->spellcasting['slots'][1]['current']);
    }

    public function test_failed_high_level_scroll_check_consumes_scroll_but_never_heals_or_spends_slot(): void
    {
        $a = $this->spell('cure-wounds');
        $state = $this->hero->spellcasting;
        $state['scroll_list'] = ['cure-wounds'];
        $state['scroll_max_level'] = 0;
        $this->hero->update(['spellcasting' => $state]);
        $d = (new ItemDefinition)->forceFill(['campaign_id' => $this->campaign->id, 'name' => 'Scroll', 'icon' => 'item_scroll', 'category' => 'scroll', 'rarity' => 'common', 'max_stack' => 20, 'width' => 1, 'height' => 1, 'equipment_slots' => [], 'modifiers' => [], 'gameplay' => ['use' => ['scroll' => true, 'consume' => true, 'ability' => $a]]]);
        $d->save();
        $item = $this->hero->inventory()->create(['item_definition_id' => $d->id, 'quantity' => 1, 'x' => 0, 'y' => 0]);
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(1);
        $this->postJson('/api/scenes/'.$this->scene->id.'/inventory/use', ['inventoryItemId' => $item->id, 'characterId' => $this->hero->id, 'epoch' => 0, 'target' => ['kind' => 'token', 'id' => $this->actor->id], 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('execution.scrollCheck.dc', 11)->assertJsonPath('execution.success', false);
        $this->assertSame(0, $item->fresh()->quantity);
        $this->assertSame(5, $this->hero->fresh()->hp);
        $this->assertSame(3, $this->hero->fresh()->spellcasting['slots'][1]['current']);
    }

    public function test_round_effect_expires_and_a_miss_never_grants_speed_modifier(): void
    {
        $a = $this->spell('ray-of-frost');
        $this->enemy->update(['speed' => 30]);
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(1, 20);
        $this->cast($a)->assertOk();
        $this->assertSame(30, (int) $this->enemy->fresh()->speed);
        $combat = Combat::create(['scene_id' => $this->scene->id, 'created_by' => $this->gm->id, 'status' => 'active', 'round' => 1]);
        $entry = $combat->combatants()->create(['token_id' => $this->actor->id, 'position' => 0]);
        $combat->update(['current_combatant_id' => $entry->id]);
        $this->cast($a)->assertOk();
        $this->assertSame(20, (int) $this->enemy->fresh()->speed);
        app(TurnBudget::class)->start($combat, $entry->id);
        $this->assertSame(30, (int) $this->enemy->fresh()->speed);
    }

    public function test_spell_condition_and_timestamp_expiry_remove_only_linked_condition(): void
    {
        $a = $this->spell('blindness-deafness');
        $this->enemy->update(['check_stats' => [['key' => 'save_con', 'label' => 'CON', 'modifier' => 0]]]);
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(1);
        $this->cast($a)->assertOk();
        $this->assertTrue($this->enemy->conditions()->where('key', 'blinded')->exists());
        $effect = SpellEffect::where('ability_id', $a['id'])->firstOrFail();
        $effect->update(['expires_at' => now()->subSecond()]);
        app(SpellEffects::class)->expire();
        $this->assertFalse($this->enemy->conditions()->where('key', 'blinded')->exists());
    }

    public function test_concentration_dc_has_srd_cap_30_and_temporary_hp_damage_counts(): void
    {
        $a = $this->spell('shield-of-faith');
        $this->hero->update(['hp' => 999, 'max_hp' => 999, 'temporary_hp' => 100]);
        $combat = Combat::create(['scene_id' => $this->scene->id, 'created_by' => $this->gm->id, 'status' => 'active', 'round' => 1]);
        $entry = $combat->combatants()->create(['token_id' => $this->actor->id, 'position' => 0]);
        $combat->update(['current_combatant_id' => $entry->id]);
        $this->cast($a, ['target' => ['kind' => 'token', 'id' => $this->actor->id]])->assertOk();
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(1);
        app(TokenCombatActions::class)->adjustHp($this->gm, $this->actor->fresh(), -80);
        $this->assertSame(999, $this->hero->fresh()->hp);
        $this->assertSame(20, $this->hero->fresh()->temporary_hp);
        $event = DB::table('combat_events')->where('type', 'concentration.save')->first();
        $this->assertSame(30, json_decode($event->data, true)['dc']);
        $this->assertSame(0, SpellEffect::whereNull('ended_at')->count());
    }

    public function test_reaction_on_another_turn_and_spell_slots_do_not_use_2014_bonus_action_rule(): void
    {
        $a = $this->spell('healing-word');
        $shield = $this->spell('shield');
        $cantrip = $this->spell('poison-spray');
        $combat = Combat::create(['scene_id' => $this->scene->id, 'created_by' => $this->gm->id, 'status' => 'active', 'round' => 1]);
        $entry = $combat->combatants()->create(['token_id' => $this->actor->id, 'position' => 0]);
        $enemy = $combat->combatants()->create(['token_id' => $this->enemy->id, 'position' => 1]);
        $combat->update(['current_combatant_id' => $entry->id]);
        $this->cast($a, ['target' => ['kind' => 'token', 'id' => $this->actor->id]])->assertOk();
        $this->cast($cantrip)->assertOk(); // Bonus slotted spell + Action cantrip is legal.
        $combat->update(['current_combatant_id' => $enemy->id]);
        app(TurnBudget::class)->start($combat, $enemy->id);
        $this->cast($shield, ['target' => null])->assertOk();
        $this->assertFalse($entry->fresh()->reaction_available);
        $this->assertSame(15, $this->hero->fresh()->ac);
    }

    public function test_manual_spells_require_gm_permission_and_long_cast_completion_is_gm_only(): void
    {
        $a = $this->spell('identify');
        $this->cast($a, ['target' => null])->assertUnprocessable();
        $a['spell']['manual_allowed'] = true;
        $this->hero->update(['abilities' => [$a]]);
        $this->cast($a, ['target' => null, 'manualComplete' => true])->assertForbidden();
        $this->actingAs($this->gm)->postJson('/api/scenes/'.$this->scene->id.'/abilities/execute', ['characterId' => $this->hero->id, 'abilityId' => $a['id'], 'epoch' => 0, 'target' => null, 'manualComplete' => true, 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('execution.manualResolution', 'pending');
    }

    public function test_linked_consumed_material_is_authoritative_and_uuid_safe(): void
    {
        $a = $this->spell('healing-word');
        $d = (new ItemDefinition)->forceFill(['campaign_id' => $this->campaign->id, 'name' => 'Reviewed material', 'icon' => 'item_scroll', 'category' => 'other', 'rarity' => 'common', 'max_stack' => 20, 'width' => 1, 'height' => 1, 'equipment_slots' => [], 'modifiers' => []]);
        $d->save();
        $a['spell']['material_definition_id'] = $d->id;
        $a['spell']['material_quantity'] = 1;
        $a['spell']['consume_material'] = true;
        $this->hero->update(['abilities' => [$a]]);
        $self = ['target' => ['kind' => 'token', 'id' => $this->actor->id]];
        $this->cast($a, $self)->assertUnprocessable();
        $item = $this->hero->inventory()->create(['item_definition_id' => $d->id, 'quantity' => 2, 'x' => 0, 'y' => 0]);
        $self['clientMutationId'] = (string) Str::uuid();
        $this->cast($a, $self)->assertOk();
        $this->cast($a, $self)->assertOk();
        $this->assertSame(1, $item->fresh()->quantity);
        $this->assertSame(2, $this->hero->fresh()->spellcasting['slots'][1]['current']);
    }

    public function test_fixed_healing_upcasts_over_99_and_cannot_forge_removed_condition(): void
    {
        $a = $this->spell('heal');
        $this->enemy->update(['hp' => 1, 'max_hp' => 200]);
        app(AppliedConditions::class)->apply($this->gm, $this->enemy, ['key' => 'blinded']);
        app(AppliedConditions::class)->apply($this->gm, $this->enemy, ['key' => 'incapacitated']);
        $this->cast($a, ['castLevel' => 9, 'effectChoice' => 'incapacitated'])->assertOk()->assertJsonPath('execution.healing', 100)->assertJsonPath('execution.healingRoll.expression', '100');
        $this->assertSame(101, $this->enemy->fresh()->hp);
        $this->assertFalse($this->enemy->conditions()->where('key', 'blinded')->exists());
        $this->assertTrue($this->enemy->conditions()->where('key', 'incapacitated')->exists());
    }

    public function test_cantrip_scaling_uses_explicit_gm_tier_and_scroll_rejects_free_upcast(): void
    {
        $a = $this->spell('poison-spray');
        $state = $this->hero->spellcasting;
        $state['cantrip_tier'] = 3;
        $this->hero->update(['spellcasting' => $state]);
        $scaled = app(SpellCasting::class)->scale($this->hero, $a, 0);
        $this->assertSame('3d12', $scaled['damage_components'][0]['dice']);
        $this->expectException(HttpException::class);
        app(SpellCasting::class)->validate($this->hero, $a, 4, true);
    }

    public function test_effect_branches_distinguish_attack_hit_from_successful_and_failed_saves(): void
    {
        $a = $this->spell('inflict-wounds');
        $a['spell']['duration'] = ['mode' => 'seconds', 'amount' => 60];
        $a['spell']['effects'] = [
            ['type' => 'modifier', 'key' => 'ac', 'value' => 99, 'when' => 'hit'],
            ['type' => 'modifier', 'key' => 'speed', 'value' => -10, 'when' => 'failed_save'],
            ['type' => 'modifier', 'key' => 'ac', 'value' => 1, 'when' => 'successful_save'],
        ];
        $this->hero->update(['abilities' => [$a]]);
        $this->enemy->update(['speed' => 30, 'check_stats' => [['key' => 'save_con', 'label' => 'CON', 'modifier' => 100]]]);
        $this->cast($a)->assertOk();
        $this->assertSame(11, (int) $this->enemy->fresh()->ac);
        $this->assertSame(30, (int) $this->enemy->fresh()->speed);
    }

    public function test_flat_attack_effect_uses_the_same_roll_context_as_bonus_dice(): void
    {
        $a = $this->spell('bless');
        $attack = $this->spell('poison-spray');
        $a['spell']['effects'] = [['type' => 'modifier', 'key' => 'attack', 'value' => 2, 'when' => 'always']];
        $this->hero->update(['abilities' => [$a, $attack]]);
        $this->cast($a, ['target' => ['kind' => 'token', 'id' => $this->actor->id]])->assertOk();
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(10);
        $this->cast($attack)->assertOk()->assertJsonPath('execution.roll.modifier', 9)->assertJsonPath('execution.roll.bonusRolls.0.roll.total', 2);
    }

    public function test_former_gm_cannot_replay_privileged_spellcasting_character_projection(): void
    {
        $a = $this->spell('shield-of-faith');
        $this->cast($a, ['target' => ['kind' => 'token', 'id' => $this->actor->id]])->assertOk();
        $effect = SpellEffect::whereNull('ended_at')->firstOrFail();
        $this->hero->update(['owner_user_id' => $this->gm->id]);
        $uuid = (string) Str::uuid();
        $data = ['characterId' => $this->hero->id, 'action' => 'end-effect', 'effectId' => $effect->id, 'clientMutationId' => $uuid];
        $url = '/api/campaigns/'.$this->campaign->id.'/spellcasting';
        $this->actingAs($this->gm)->postJson($url, $data)->assertOk();
        $receipt = DB::table('scene_mutation_receipts')->where('client_mutation_id', $uuid)->first();
        $result = json_decode($receipt->result, true);
        $result['character']['rulesSuggestion'] = null;
        DB::table('scene_mutation_receipts')->where('id', $receipt->id)->update(['result' => json_encode($result)]);
        $this->campaign->members()->updateExistingPivot($this->gm->id, ['role' => 'player']);
        $this->postJson($url, $data)->assertForbidden();
    }

    public function test_sight_required_healing_rejects_blinded_caster_before_spending_slot(): void
    {
        $a = $this->spell('healing-word');
        app(AppliedConditions::class)->apply($this->gm, $this->actor, ['key' => 'blinded']);
        $this->cast($a, ['target' => ['kind' => 'token', 'id' => $this->actor->id]])->assertUnprocessable();
        $this->assertSame(3, $this->hero->fresh()->spellcasting['slots'][1]['current']);
    }
}
