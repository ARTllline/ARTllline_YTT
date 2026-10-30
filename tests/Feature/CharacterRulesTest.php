<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\AbilityExecution;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\CompendiumEntry;
use App\Models\ItemDefinition;
use App\Models\ObjectCheck;
use App\Models\User;
use App\Services\CharacterCatalog;
use App\Services\CharacterRules;
use App\Services\D20Roller;
use App\Services\TokenCheckStats;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\Support\SeedsCharacterCatalog;
use Tests\TestCase;

class CharacterRulesTest extends TestCase
{
    use DatabaseMigrations;
    use SeedsCharacterCatalog;

    private $gm;

    private $player;

    private $other;

    private $campaign;

    private $scene;

    private Character $hero;

    private $actor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCharacterCatalog();
        Event::fake([TabletopEvent::class]);
        [$this->gm, $this->player, $this->other] = User::factory()->count(3)->create()->all();
        $this->campaign = Campaign::create(['name' => 'Rules QA']);
        foreach ([[$this->gm, 'gm'], [$this->player, 'player'], [$this->other, 'player']] as [$u, $role]) {
            $this->campaign->members()->attach($u, ['role' => $role]);
        }
        $this->scene = $this->campaign->scenes()->create(['name' => 'Rules arena']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->hero = $this->campaign->characters()->create(['name' => 'QA Character', 'owner_user_id' => $this->player->id,
            'rules' => $this->rules(), 'hp' => 34, 'max_hp' => 41, 'ac' => 15, 'speed' => 30]);
        $this->actor = $this->scene->tokens()->create(['character_id' => $this->hero->id, 'name' => 'QA', 'x' => 100, 'y' => 100]);
        DB::table('campaign_members')->where('campaign_id', $this->campaign->id)->where('user_id', $this->player->id)->update(['active_character_id' => $this->hero->id]);
    }

    private function rules(): array
    {
        $r = app(CharacterRules::class)->defaults();
        $r['scores'] = ['str' => 16, 'dex' => 14, 'con' => 15, 'int' => 10, 'wis' => 12, 'cha' => 18];
        $r['proficiency_bonus'] = 3;
        $r['skills']['athletics']['proficient'] = true;
        $r['skills']['perception']['proficient'] = true;
        $r['skills']['persuasion']['expertise'] = true;
        $r['spellcasting_ability'] = 'cha';

        return $r;
    }

    private function equip(string $name, string $slot, array $modifiers)
    {
        $d = ItemDefinition::forceCreate(['campaign_id' => $this->campaign->id, 'name' => $name, 'icon' => 'item_ring', 'description' => '',
            'category' => 'gear', 'rarity' => 'common', 'width' => 1, 'height' => 1, 'max_stack' => 1, 'equipment_slots' => [$slot], 'modifiers' => $modifiers]);

        return $this->hero->inventory()->create(['item_definition_id' => $d->id, 'quantity' => 1, 'equipped_slot' => $slot]);
    }

    public function test_qa_character_scores_skills_saves_spellcasting_and_negative_floor(): void
    {
        $s = app(CharacterRules::class);
        $this->assertSame([3, 2, 2, 0, 1, 4], array_map(fn ($k) => $s->stat($this->hero, $k)['modifier'], array_keys(CharacterRules::ABILITIES)));
        foreach (['athletics' => 6, 'perception' => 4, 'persuasion' => 10, 'save_str' => 3, 'spell_attack' => 7] as $k => $value) {
            $this->assertSame($value, $s->stat($this->hero, $k)['modifier']);
        }
        $this->assertSame(15, $s->derived($this->hero)['spellcasting']['saveDc']);
        $r = $this->rules();
        $r['scores']['str'] = 9;
        $r['saves']['str'] = ['proficient' => true, 'bonus' => 2];
        $r['spellcasting_ability'] = null;
        $r['skills']['perception']['ability'] = 'int';
        $this->hero->update(['rules' => $r]);
        $this->assertSame(-1, $s->stat($this->hero, 'str')['modifier']);
        $this->assertSame(4, $s->stat($this->hero, 'save_str')['modifier']);
        $this->assertSame(4, $s->stat($this->hero, 'perception')['modifier']);
        $this->assertSame('wis', $s->stat($this->hero, 'perception')['ability']);
        $this->assertNull($s->derived($this->hero)['spellcasting']);
    }

    public function test_equipment_pipeline_removal_and_raw_bases_never_accumulate(): void
    {
        $shield = $this->equip('Shield', 'off_hand', ['ac' => 2]);
        $boots = $this->equip('Boots', 'boots', ['speed' => 10]);
        $amulet = $this->equip('Amulet', 'amulet', ['checks' => ['perception' => 1]]);
        $hero = $this->hero->fresh();
        $s = app(CharacterRules::class);
        $this->assertSame(17, $hero->ac);
        $this->assertSame(17, $hero->ac);
        $this->assertSame(40, $hero->speed);
        $p = $s->stat($hero, 'perception');
        $this->assertSame(5, $p['modifier']);
        $this->assertSame(['ability', 'proficiency', 'equipment'], array_column($p['breakdown'], 'source'));
        $this->assertSame('Amulet', $p['breakdown'][2]['label']);
        $this->assertSame(15, $hero->getRawOriginal('ac'));
        foreach ([$shield, $boots, $amulet] as $i) {
            $i->update(['equipped_slot' => null, 'x' => 0, 'y' => 0]);
        }
        $hero = $hero->fresh();
        $this->assertSame(15, $hero->ac);
        $this->assertSame(30, $hero->speed);
        $this->assertSame(4, $s->stat($hero, 'perception')['modifier']);
        $this->assertSame(34, $hero->hp);
    }

    public function test_legacy_conversion_aliases_custom_and_standalone_tokens_remain_usable(): void
    {
        $legacy = [['key' => 'strength', 'label' => 'Сила', 'modifier' => 3], ['key' => 'perception', 'label' => 'Внимательность', 'modifier' => 6], ['key' => 'magic', 'label' => 'Особая магия', 'modifier' => 8], ['key' => 'save_luck', 'label' => 'Удача', 'modifier' => 5]];
        $this->hero->update(['rules' => null, 'check_stats' => $legacy]);
        $s = app(CharacterRules::class);
        $this->assertSame(6, $s->stat($this->hero, 'perception')['modifier']);
        $this->hero->update(['rules' => $s->suggestion($this->hero)]);
        $this->assertSame(3, $s->stat($this->hero, 'strength')['modifier']);
        $this->assertSame(6, $s->stat($this->hero, 'perception')['modifier']);
        $this->assertSame(8, $s->stat($this->hero, 'magic')['modifier']);
        $this->assertSame(5, $s->stat($this->hero, 'save_luck')['modifier']);
        $this->assertSame(3, app(TokenCheckStats::class)->resolve($this->actor->fresh(), ['stat_key' => 'strength', 'modifier' => 99])['finalModifier']);
        $npc = $this->scene->tokens()->create(['name' => 'NPC', 'x' => 0, 'y' => 0, 'check_stats' => $legacy]);
        $this->assertSame(6, app(TokenCheckStats::class)->resolve($npc, ['stat_key' => 'perception'])['finalModifier']);
        $this->assertSame(9, app(TokenCheckStats::class)->resolve($npc, ['modifier' => 9, 'label' => 'Legacy'])['finalModifier']);
    }

    public function test_rules_are_gm_only_validated_and_preview_does_not_persist(): void
    {
        $url = '/api/campaigns/'.$this->campaign->id.'/characters';
        $data = ['id' => $this->hero->id, 'name' => 'QA', 'rules' => $this->rules(), 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($this->player)->postJson($url, $data)->assertForbidden();
        $r = $data['rules'];
        $r['scores']['str'] = 20;
        $preview = '/api/campaigns/'.$this->campaign->id.'/character-rules/preview';
        $this->postJson($preview, ['id' => $this->hero->id, 'rules' => $r])->assertForbidden();
        $this->actingAs($this->gm)->postJson($preview, ['id' => $this->hero->id, 'rules' => $r])->assertOk()->assertJsonPath('derived.checks.0.modifier', 5);
        $this->assertSame(16, $this->hero->fresh()->rules['scores']['str']);
        $this->postJson($url, $data)->assertOk()->assertJsonPath('character.derived.spellcasting.saveDc', 15);
        $data['clientMutationId'] = (string) Str::uuid();
        $data['rules']['scores']['str'] = 31;
        $this->postJson($url, $data)->assertUnprocessable();
        $data['rules'] = $this->rules();
        $data['rules']['finalModifier'] = 100;
        $this->postJson($url, $data)->assertUnprocessable();
        $this->actingAs($this->other)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertJsonCount(0, 'characters')->assertJsonMissingPath('tokens.0.checkStats');
    }

    public function test_strength_attack_ignores_forged_totals_persists_provenance_and_replays_after_equipment_change(): void
    {
        $this->mock(D20Roller::class)->shouldReceive('roll')->once()->andReturn(12);
        $enemy = $this->scene->tokens()->create(['name' => 'Enemy', 'x' => 150, 'y' => 100, 'ac' => 17]);
        $ability = ['id' => (string) Str::uuid(), 'name' => 'STR attack', 'icon' => 'sword', 'description' => '', 'category' => 'attack', 'target' => 'token',
            'check' => ['stat_key' => 'str', 'modifier' => 99, 'proficient' => true, 'bonus' => 1, 'dc' => 10, 'dc_visible' => false, 'defense' => 'ac'],
            'costs' => [], 'damage' => null, 'result' => ['type' => 'nothing', 'target' => null, 'amount' => 0], 'sort_order' => 0, 'enabled' => true];
        $this->hero->update(['abilities' => [$ability]]);
        $command = ['characterId' => $this->hero->id, 'abilityId' => $ability['id'], 'epoch' => 0, 'target' => ['kind' => 'token', 'id' => $enemy->id], 'rollMode' => 'normal',
            'modifier' => 100, 'proficient' => false, 'rules' => ['scores' => ['str' => 30]], 'clientMutationId' => (string) Str::uuid()];
        $url = '/api/scenes/'.$this->scene->id.'/abilities/execute';
        $first = $this->actingAs($this->player)->postJson($url, $command)->assertOk()->assertJsonPath('execution.roll.modifier', 7)->assertJsonPath('execution.roll.total', 19)
            ->assertJsonMissingPath('execution.roll.dc')->assertJsonPath('execution.provenance.source', 'character_rules')->json();
        $this->equip('New sword', 'main_hand', ['checks' => ['str' => 2]]);
        $this->postJson($url, $command)->assertOk()->assertExactJson($first);
        DB::table('scene_mutation_receipts')->delete();
        $this->postJson($url, $command)->assertOk()->assertExactJson($first);
        $this->assertDatabaseCount('ability_executions', 1);
        $this->assertSame(17, AbilityExecution::sole()->result['roll']['dc']);
        $this->assertSame(7, AbilityExecution::sole()->result['provenance']['finalModifier']);
    }

    public function test_object_check_uses_derived_skill_equipment_and_retains_retry_result(): void
    {
        $this->mock(D20Roller::class)->shouldReceive('roll')->once()->andReturn(10);
        $amulet = $this->equip('Amulet', 'amulet', ['checks' => ['perception' => 1]]);
        $action = ['id' => (string) Str::uuid(), 'label' => 'Осмотреть', 'icon' => 'search', 'enabled' => true, 'result_type' => 'nothing',
            'check' => ['enabled' => true, 'label' => 'Внимательность', 'stat_key' => 'perception', 'modifier' => 99, 'dc' => 15, 'retry' => 'once_per_player',
                'success' => ['result_type' => 'nothing'], 'failure' => ['result_type' => 'nothing']]];
        $prop = $this->scene->tokens()->create(['name' => 'Смотритель', 'x' => 100, 'y' => 100]);
        $base = '/api/scenes/'.$this->scene->id;
        $this->actingAs($this->gm)->postJson($base.'/object-actions', ['kind' => 'token', 'id' => $prop->id, 'actions' => [$action], 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $command = ['kind' => 'token', 'id' => $prop->id, 'actionId' => $action['id'], 'actorTokenId' => $this->actor->id, 'epoch' => 0, 'modifier' => 100, 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($this->player)->postJson($base.'/interact', $command)->assertUnprocessable();
        unset($command['modifier']);
        $first = $this->actingAs($this->player)->postJson($base.'/interact', $command)->assertOk()->assertJsonPath('check.modifier', 5)->assertJsonPath('check.total', 15)->assertJsonPath('check.provenance.breakdown.2.label', 'Amulet')->json();
        $amulet->update(['equipped_slot' => null, 'x' => 0, 'y' => 0]);
        DB::table('scene_mutation_receipts')->delete();
        $this->postJson($base.'/interact', $command)->assertOk()->assertExactJson($first);
        $command['clientMutationId'] = (string) Str::uuid();
        $this->postJson($base.'/interact', $command)->assertOk()->assertJsonPath('check.id', $first['check']['id']);
        $this->assertDatabaseCount('object_checks', 1);
        $this->assertSame(5, ObjectCheck::sole()->provenance['finalModifier']);
    }

    public function test_skills_use_local_compendium_identity_and_expertise_has_distinct_provenance(): void
    {
        $s = app(CharacterRules::class);
        $this->assertCount(18, $s->catalog()->skills());
        $entry = CompendiumEntry::where('entity_type', 'skills')->where('external_key', 'perception')->sole();
        $p = $s->stat($this->hero, 'perception');
        $this->assertSame($entry->id, $p['compendiumEntryId']);
        $this->assertSame($entry->normalized_data['ability'], $p['ability']);
        $this->assertSame('Perception', $p['label']);
        $expertise = $s->stat($this->hero, 'persuasion', true);
        $this->assertSame(10, $expertise['modifier']);
        $this->assertSame(['ability', 'proficiency', 'expertise'], array_column($expertise['breakdown'], 'source'));
        $this->assertSame([4, 3, 3], array_column($expertise['breakdown'], 'value'));
        $r = $this->rules();
        $r['skills']['perception']['ability'] = 'str'; // A client cannot replace the canonical ability.
        $r['skills']['perception']['bonus'] = 2;
        $this->hero->update(['rules' => $r]);
        $this->assertSame(6, $s->stat($this->hero, 'perception')['modifier']);
        $this->assertSame('wis', $s->stat($this->hero, 'perception')['ability']);
    }

    public function test_spell_attack_dc_and_raw_ability_bonuses_do_not_leak_into_each_other(): void
    {
        $this->equip('Focus', 'main_hand', ['checks' => ['spell_attack' => 1, 'spell_save_dc' => 2, 'cha' => 9]]);
        $s = app(CharacterRules::class);
        $d = $s->derived($this->hero->fresh());
        $this->assertSame(8, $d['spellcasting']['attackBonus']);
        $this->assertSame(17, $d['spellcasting']['saveDc']);
        $this->assertSame(4, $d['abilityModifiers']['cha']);
        $this->assertSame(13, $s->stat($this->hero, 'cha')['modifier']);
        $this->assertSame(10, $s->stat($this->hero, 'persuasion')['modifier']);
        $this->assertSame(['base', 'ability', 'proficiency', 'equipment'], array_column($d['spellcasting']['saveBreakdown'], 'source'));
    }

    public function test_core_custom_modifiers_preview_and_equipment_use_one_pipeline_with_explicit_units(): void
    {
        $this->equip('Shield', 'off_hand', ['ac' => 2]);
        $this->equip('Boots', 'boots', ['speed' => 10]);
        $r = $this->rules();
        $r['modifiers'] = ['ac' => 1, 'speed' => 5, 'spell_attack' => 2, 'spell_save_dc' => 1];
        $this->hero->update(['rules' => $r]);
        $d = app(CharacterRules::class)->derived($this->hero->fresh());
        $this->assertSame(18, $d['ac']);
        $this->assertSame(45, $d['speed']);
        $this->assertSame('ft', $d['speedUnit']);
        $this->assertSame('character', $d['hpSource']);
        $this->assertSame(34, $d['hp']);
        $this->assertSame(['base', 'custom', 'equipment'], array_column($d['coreBreakdown']['ac'], 'source'));
        $this->assertSame(9, $d['spellcasting']['attackBonus']);
        $this->assertSame(16, $d['spellcasting']['saveDc']);
        $this->actingAs($this->gm)->postJson('/api/campaigns/'.$this->campaign->id.'/character-rules/preview', ['id' => $this->hero->id, 'rules' => $r, 'ac' => 20, 'speed' => 35])
            ->assertOk()->assertJsonPath('derived.ac', 23)->assertJsonPath('derived.speed', 50);
        $this->assertSame(15, $this->hero->fresh()->getRawOriginal('ac'));
    }

    public function test_legacy_skill_override_is_converted_explicitly_and_aliases_have_one_canonical_total(): void
    {
        $r = $this->rules();
        unset($r['schema_version']);
        $r['skills']['perception']['ability'] = 'int';
        $this->hero->update(['rules' => $r, 'check_stats' => [['key' => 'strength', 'label' => 'Old STR', 'modifier' => 90], ['key' => 'str', 'label' => 'Duplicate STR', 'modifier' => 80], ['key' => 'magic', 'label' => 'Custom magic', 'modifier' => 8]]]);
        $s = app(CharacterRules::class);
        $state = $s->state($this->hero);
        $this->assertSame(-1, $state['skills']['perception']['bonus']);
        $this->assertArrayNotHasKey('ability', $state['skills']['perception']);
        $this->assertSame('int', $this->hero->fresh()->rules['skills']['perception']['ability']);
        $checks = $s->checks($this->hero);
        $this->assertSame(1, collect($checks)->where('key', 'str')->count());
        $this->assertSame(3, $s->stat($this->hero, 'perception')['modifier']);
        $this->assertSame(8, $s->stat($this->hero, 'magic')['modifier']);
        $this->actingAs($this->gm)->postJson('/api/campaigns/'.$this->campaign->id.'/characters', ['id' => $this->hero->id, 'name' => 'QA', 'rules' => $state, 'clientMutationId' => (string) Str::uuid()])
            ->assertOk()->assertJsonPath('character.rules.schema_version', 2);
        $this->assertArrayNotHasKey('ability', $this->hero->fresh()->rules['skills']['perception']);
        $this->assertSame(3, $s->stat($this->hero->fresh(), 'perception')['modifier']);
    }

    public function test_missing_catalog_is_explicit_and_never_fetches_a_remote_skill_catalogue(): void
    {
        $r = $this->rules();
        CompendiumEntry::where('entity_type', 'skills')->delete();
        $this->app->forgetInstance(CharacterCatalog::class);
        Http::preventStrayRequests();
        $s = app(CharacterRules::class);
        $this->assertFalse($s->derived($this->hero)['catalog']['ready']);
        $this->assertNull($s->suggestion($this->hero));
        $this->actingAs($this->gm)->postJson('/api/campaigns/'.$this->campaign->id.'/characters', ['id' => $this->hero->id, 'name' => 'QA', 'rules' => $r, 'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
        $this->assertSame(16, $this->hero->fresh()->rules['scores']['str']);
        Http::assertNothingSent();
    }

    public function test_raw_ability_and_save_checks_use_canonical_aliases_advantage_and_structured_history(): void
    {
        $r = $this->rules();
        $r['saves']['wis'] = ['proficient' => true, 'bonus' => 1];
        $this->hero->update(['rules' => $r]);
        $this->mock(D20Roller::class)->shouldReceive('roll')->times(4)->andReturn(4, 14, 4, 14);
        foreach (['strength' => ['str', 3], 'saving_throw_wis' => ['save_wis', 5]] as $key => [$canonical, $expected]) {
            $action = ['id' => (string) Str::uuid(), 'label' => 'Check '.$key, 'icon' => 'search', 'enabled' => true, 'result_type' => 'nothing',
                'check' => ['enabled' => true, 'label' => $key, 'stat_key' => $key, 'modifier' => 99, 'dc' => 15, 'retry' => 'repeatable',
                    'success' => ['result_type' => 'nothing'], 'failure' => ['result_type' => 'nothing']]];
            $target = $this->scene->tokens()->create(['name' => 'Check target', 'x' => 100, 'y' => 100]);
            $base = '/api/scenes/'.$this->scene->id;
            $this->actingAs($this->gm)->postJson($base.'/object-actions', ['kind' => 'token', 'id' => $target->id, 'actions' => [$action], 'clientMutationId' => (string) Str::uuid()])->assertOk();
            $this->actingAs($this->player)->postJson($base.'/interact', ['kind' => 'token', 'id' => $target->id, 'actionId' => $action['id'], 'actorTokenId' => $this->actor->id,
                'epoch' => 0, 'rollMode' => 'advantage', 'clientMutationId' => (string) Str::uuid()])
                ->assertOk()->assertJsonPath('check.provenance.statKey', $canonical)->assertJsonPath('check.modifier', $expected)
                ->assertJsonPath('check.total', 14 + $expected)->assertJsonPath('check.rollMode', 'advantage');
        }
        $this->assertDatabaseCount('object_checks', 2);
        $this->assertSame('custom', ObjectCheck::where('label', 'saving_throw_wis')->sole()->provenance['breakdown'][2]['source']);
    }

    public function test_condition_definitions_link_to_compendium_keep_custom_markers_and_do_not_apply_mechanics(): void
    {
        $path = '/api/tokens/'.$this->actor->id.'/condition-add';
        $entry = CompendiumEntry::where('entity_type', 'conditions')->where('external_key', 'poisoned')->sole();
        $command = ['key' => 'poisoned', 'visibility' => 'gm_only', 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($this->gm)->postJson($path, $command)->assertOk()->assertJsonPath('token.conditions.0.compendiumEntryId', $entry->id);
        $this->postJson($path, $command)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertSame(6, app(CharacterRules::class)->stat($this->hero, 'athletics')['modifier']);
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()->assertJsonCount(0, 'tokens.0.conditions');
        $this->postJson($path, ['key' => 'exhaustion', 'visibility' => 'public', 'clientMutationId' => (string) Str::uuid()])->assertForbidden();
        $this->actingAs($this->gm)->postJson($path, ['key' => 'exhaustion', 'visibility' => 'public', 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->postJson($path, ['key' => 'concentrating', 'visibility' => 'public', 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->assertNull($this->actor->conditions()->where('key', 'concentrating')->sole()->compendium_entry_id);
        $this->postJson($path, ['key' => 'invented_srd_key', 'visibility' => 'public', 'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
    }
}
