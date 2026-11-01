<?php

namespace Tests\Feature;

use App\Actions\SpellLibrary;
use App\Compendium\CompendiumSync;
use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\User;
use App\Services\CharacterRules;
use App\Spells\SpellCasting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class SpellLibraryTest extends TestCase
{
    use RefreshDatabase, \Tests\Support\SeedsCharacterCatalog;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCharacterCatalog();
        Event::fake([TabletopEvent::class]);
        app(CompendiumSync::class)->import(CompendiumSource::firstOrFail(), json_decode(file_get_contents(base_path('tests/Fixtures/compendium/spells-2024.json')), true), ['spells']);
    }

    private function command(Character $c, array $data)
    {
        return $this->postJson('/api/library/characters/'.$c->id.'/spells', ['clientMutationId' => (string) Str::uuid(), ...$data]);
    }

    private function entry(string $key): CompendiumEntry
    {
        return CompendiumEntry::where('entity_type', 'spells')->where('external_key', $key)->firstOrFail();
    }

    private function hero(User $user): Character
    {
        return tap((new Character)->forceFill(['library_user_id' => $user->id, 'name' => 'Mage', 'kind' => 'player_character', 'hp' => 5, 'max_hp' => 50, 'abilities' => [], 'resources' => [], 'rules' => [...app(CharacterRules::class)->defaults(), 'spellcasting_ability' => 'int']]), fn ($c) => $c->save());
    }

    public function test_catalog_and_assignment_work_without_campaign_and_snapshots_are_independent(): void
    {
        $gm = User::factory()->create();
        $this->actingAs($gm);
        $this->getJson('/api/library/spells?search=Fire%20Bolt&level=0&school=evocation')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('entries.0.ability.spell.level', 0);
        $this->get('/control/spells')->assertOk();
        $c = $this->hero($gm);
        $other = $this->hero($gm);
        $entry = $this->entry('fire-bolt');
        $before = $entry->normalized_data;
        $command = ['action' => 'add', 'entryId' => $entry->id, 'clientMutationId' => (string) Str::uuid()];
        $first = $this->command($c, $command)->assertOk()->json();
        $this->command($c, $command)->assertOk()->assertExactJson($first);
        $this->command($c, ['action' => 'add', 'entryId' => $entry->id])->assertOk();
        $this->assertCount(1, $c->fresh()->abilities);
        $this->command($other, ['action' => 'add', 'entryId' => $entry->id])->assertOk();
        $a = $c->fresh()->abilities[0];
        $this->command($c, ['action' => 'configure', 'abilityId' => $a['id'], 'prepared' => true])->assertOk();
        $this->assertTrue($c->fresh()->abilities[0]['spell']['prepared']);
        $this->assertFalse($other->fresh()->abilities[0]['spell']['prepared']);
        $entry->update(['normalized_data' => [...$before, 'name' => 'Changed template']]);
        $this->assertSame('Fire Bolt', $c->fresh()->abilities[0]['name']);
        $this->assertNotSame($a['id'], $other->fresh()->abilities[0]['id']);
        $this->getJson('/api/library/characters')->assertOk()->assertJsonFragment(['name' => 'Fire Bolt']);
        $this->command($c, ['action' => 'remove', 'abilityId' => $a['id']])->assertOk();
        $this->assertCount(0, $c->fresh()->abilities);
        $this->assertCount(1, $other->fresh()->abilities);
    }

    public function test_only_library_owner_or_campaign_gm_can_mutate_and_invalid_sources_are_atomic(): void
    {
        $gm = User::factory()->create();
        $stranger = User::factory()->create();
        $c = $this->hero($gm);
        $entry = $this->entry('fire-bolt');
        $this->actingAs($stranger);
        $this->command($c, ['action' => 'add', 'entryId' => $entry->id])->assertNotFound();
        $campaign = Campaign::create(['name' => 'A']);
        $campaign->members()->attach($gm, ['role' => 'player']);
        $c->forceFill(['campaign_id' => $campaign->id])->save();
        $this->actingAs($gm);
        $this->command($c, ['action' => 'add', 'entryId' => $entry->id])->assertForbidden();
        $campaign->members()->updateExistingPivot($gm, ['role' => 'gm']);
        $this->command($c, ['action' => 'add', 'entryId' => 999999])->assertNotFound();
        $this->command($c, ['action' => 'configure', 'abilityId' => (string) Str::uuid(), 'prepared' => true])->assertNotFound();
        $this->assertCount(0, $c->fresh()->abilities);
        $receipt = ['action' => 'add', 'entryId' => $entry->id, 'clientMutationId' => (string) Str::uuid()];
        $this->command($c, $receipt)->assertOk();
        $campaign->members()->updateExistingPivot($gm, ['role' => 'player']);
        $this->command($c, $receipt)->assertForbidden();
        $campaign->members()->updateExistingPivot($gm, ['role' => 'gm']);
        $c->update(['abilities' => array_map(fn ($i) => [...app(SpellLibrary::class)->template($entry), 'id' => (string) Str::uuid()], range(1, 24))]);
        $this->command($c, ['action' => 'add', 'entryId' => $this->entry('healing-word')->id])->assertUnprocessable();
        $this->assertCount(24, $c->fresh()->abilities);
    }

    public function test_assignment_reload_prepare_and_session_cast_use_existing_slots_and_realtime(): void
    {
        $gm = User::factory()->create();
        $player = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Session']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $c = $this->hero($gm);
        $c->forceFill(['campaign_id' => $campaign->id, 'owner_user_id' => $player->id])->save();
        $scene = $campaign->scenes()->create(['name' => 'Room', 'width' => 1000, 'height' => 1000, 'grid_size' => 50, 'distance_per_cell' => 5]);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $token = $scene->tokens()->create(['name' => 'Mage', 'character_id' => $c->id, 'x' => 0, 'y' => 0]);
        $campaign->members()->updateExistingPivot($player, ['active_character_id' => $c->id]);
        $slots = app(SpellCasting::class)->state($c);
        $slots['slots'][1] = ['max' => 2, 'current' => 2];
        $c->update(['spellcasting' => $slots]);
        $this->actingAs($gm);
        $source = $this->entry('healing-word');
        $ability = app(SpellLibrary::class)->template($source);
        $ability['name'] = 'Custom healing';
        $custom = $this->postJson('/api/library/spells', ['copyFrom' => $source->id, 'ability' => $ability, 'clientMutationId' => (string) Str::uuid()])
            ->assertOk()->assertJsonPath('entry.custom', true)->json('entry.id');
        $this->command($c, ['action' => 'add', 'entryId' => $custom])->assertOk();
        $ability['name'] = 'Edited after assignment';
        $this->postJson('/api/library/spells', ['id' => $custom, 'ability' => $ability, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->assertSame('Custom healing', $c->fresh()->abilities[0]['name']);
        $a = $c->fresh()->abilities[0];
        $cast = ['characterId' => $c->id, 'abilityId' => $a['id'], 'castLevel' => 1, 'epoch' => 0, 'target' => ['kind' => 'token', 'id' => $token->id], 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($player)->postJson('/api/scenes/'.$scene->id.'/abilities/execute', $cast)->assertForbidden();
        $this->actingAs($gm);
        $this->command($c, ['action' => 'configure', 'abilityId' => $a['id'], 'prepared' => true])->assertOk();
        $this->assertSame($slots, $c->fresh()->spellcasting);
        $this->getJson('/api/campaigns/'.$campaign->id.'/characters')->assertOk()->assertJsonFragment(['id' => $a['id']]);
        $this->actingAs($player);
        $cast['clientMutationId'] = (string) Str::uuid();
        $response = $this->postJson('/api/scenes/'.$scene->id.'/abilities/execute', $cast);
        $result = $response->assertOk()->json();
        $this->postJson('/api/scenes/'.$scene->id.'/abilities/execute', $cast)->assertOk()->assertExactJson($result);
        $this->assertSame(1, $c->fresh()->spellcasting['slots'][1]['current']);
        $this->assertGreaterThan(5, $c->fresh()->hp);
        Event::assertDispatched(TabletopEvent::class);
        $this->command($c, ['action' => 'remove', 'abilityId' => $a['id']])->assertNotFound();
    }

    public function test_authoring_is_private_srd_is_read_only_and_duplicate_retains_attribution(): void
    {
        $gm = User::factory()->create();
        $other = User::factory()->create();
        $this->actingAs($gm);
        $this->getJson('/api/library/character-rules/catalog')->assertOk()->assertJsonStructure(['damageTypes', 'conditions', 'skills', 'defaults']);
        $source = $this->entry('fire-bolt');
        $before = $source->normalized_data;
        $a = app(SpellLibrary::class)->template($source);
        $a['name'] = 'Blue fire';
        $payload = ['copyFrom' => $source->id, 'ability' => $a, 'clientMutationId' => (string) Str::uuid()];
        $first = $this->postJson('/api/library/spells', $payload)->assertOk()->assertJsonPath('entry.source.license', 'CC-BY-4.0')->json();
        $this->postJson('/api/library/spells', $payload)->assertOk()->assertExactJson($first);
        $id = $first['entry']['id'];
        $this->postJson('/api/library/spells', ['id' => $source->id, 'ability' => $a, 'clientMutationId' => (string) Str::uuid()])->assertNotFound();
        $this->assertSame($before, $source->fresh()->normalized_data);
        $a['spell']['level'] = 1;
        $this->postJson('/api/library/spells', ['id' => $id, 'ability' => $a, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->getJson('/api/library/spells?search=Blue&level=1')->assertOk()->assertJsonPath('total', 1);
        $this->actingAs($other);
        $this->getJson('/api/library/spells?search=Blue')->assertOk()->assertJsonPath('total', 0);
        $this->postJson('/api/library/spells', ['id' => $id, 'ability' => $a, 'clientMutationId' => (string) Str::uuid()])->assertNotFound();
        $this->postJson('/api/library/spells', ['copyFrom' => $id, 'ability' => $a, 'clientMutationId' => (string) Str::uuid()])->assertNotFound();
        $this->command($this->hero($other), ['action' => 'add', 'entryId' => $id])->assertNotFound();
        $campaign = Campaign::create(['name' => 'Private']);
        $campaign->members()->attach($other, ['role' => 'gm']);
        $this->getJson('/api/campaigns/'.$campaign->id.'/compendium?search=Blue')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/campaigns/'.$campaign->id.'/compendium/'.$id)->assertNotFound();
    }

    public function test_new_spell_uses_existing_rules_validation_and_rejects_campaign_references(): void
    {
        $this->actingAs(User::factory()->create());
        $a = app(SpellLibrary::class)->template($this->entry('healing-word'));
        $a['name'] = 'New spell';
        $this->postJson('/api/library/spells', ['ability' => $a, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $a['spell']['material_definition_id'] = 999;
        $this->postJson('/api/library/spells', ['ability' => $a, 'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
        unset($a['spell']['material_definition_id']);
        $a['range'] = ['normal' => 60, 'long' => 20];
        $this->postJson('/api/library/spells', ['ability' => $a, 'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
        $this->assertSame(1, CompendiumEntry::whereNotNull('library_user_id')->count());
    }
}
