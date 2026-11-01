<?php

namespace Tests\Feature;

use App\Compendium\CompendiumSync;
use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\ItemDefinition;
use App\Models\User;
use App\Services\CharacterRules;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\Support\SeedsCharacterCatalog;
use Tests\TestCase;

class ControlCenterTest extends TestCase
{
    use DatabaseMigrations;
    use SeedsCharacterCatalog;

    private User $gm;

    private User $player;

    private Campaign $campaign;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCharacterCatalog();
        Event::fake([TabletopEvent::class]);
        [$this->gm, $this->player] = User::factory()->count(2)->create()->all();
        $this->campaign = Campaign::create(['name' => 'Preparation']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
    }

    private function url(string $suffix = ''): string
    {
        return '/api/campaigns/'.$this->campaign->id.$suffix;
    }

    public function test_control_pages_require_the_campaign_gm_and_scope_character_links(): void
    {
        $root = '/campaigns/'.$this->campaign->id.'/control';
        $this->actingAs($this->gm)->get($root)->assertRedirect('/control/characters?campaign='.$this->campaign->id);
        $this->get($root.'/characters')->assertRedirect('/control/characters?campaign='.$this->campaign->id);
        $this->get($root.'/characters/new')->assertRedirect('/control/characters/new?campaign='.$this->campaign->id);
        $foreign = Campaign::create(['name' => 'Foreign']);
        $hero = $foreign->characters()->create(['name' => 'Foreign']);
        $this->get($root.'/characters/'.$hero->id)->assertNotFound();
        $this->get('/campaigns/'.$foreign->id.'/control')->assertForbidden();
        $this->actingAs($this->player)->get($root.'/characters')->assertForbidden();
        $this->postJson($this->url('/characters'), ['name' => 'Forbidden'])->assertForbidden();
        $this->postJson($this->url('/character-rules/preview'), [])->assertForbidden();
        $this->actingAs(User::factory()->create())->get($root)->assertForbidden();
    }

    public function test_create_preview_edit_and_reconnect_use_the_runtime_character(): void
    {
        $scene = $this->campaign->scenes()->create(['name' => 'Runtime']);
        $this->campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $rules = app(CharacterRules::class)->defaults();
        $rules['scores']['str'] = 16;
        $rules['proficiency_bonus'] = 3;
        $rules['skills']['athletics']['proficient'] = true;
        $rules['saves']['str']['proficient'] = true;
        $this->actingAs($this->gm)->postJson($this->url('/character-rules/preview'), ['rules' => $rules, 'ac' => 15, 'speed' => 30])->assertOk()->assertJsonPath('derived.abilityModifiers.str', 3);
        $this->assertDatabaseCount('characters', 0);
        $payload = ['name' => 'Prepared Hero', 'owner_user_id' => $this->player->id, 'rules' => $rules,
            'hp' => 24, 'max_hp' => 30, 'ac' => 15, 'speed' => 30, 'exhaustion' => 1,
            'hit_point_dice' => [['die' => 'd10', 'max' => 4, 'current' => 3]], 'clientMutationId' => (string) Str::uuid()];
        $id = $this->postJson($this->url('/characters'), $payload)->assertOk()->assertJsonPath('character.hp', 24)->assertJsonPath('character.exhaustion', 1)->json('character.id');
        $this->postJson($this->url('/characters'), $payload)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertDatabaseCount('characters', 1);
        $this->get('/campaigns/'.$this->campaign->id.'/control/characters/'.$id)->assertRedirect('/control/characters/'.$id.'?campaign='.$this->campaign->id);
        $token = $this->postJson('/api/scenes/'.$scene->id.'/tokens', ['character_id' => $id, 'x' => 100, 'y' => 100])->assertOk()->json('token.id');
        $rules['scores']['str'] = 18;
        $this->postJson($this->url('/characters'), ['id' => $id, 'name' => 'Edited Hero', 'hp' => 28, 'max_hp' => 35, 'rules' => $rules])->assertOk();
        Event::assertDispatched(TabletopEvent::class, fn ($e) => ($e->envelope['payload']['scene']['characters'][0]['name'] ?? null) === 'Edited Hero');
        $this->actingAs($this->player)->putJson($this->url('/active-character'), ['character_id' => $id])->assertOk()->assertJsonPath('activeCharacterId', $id);
        for ($i = 0; $i < 2; $i++) {
            $snapshot = $this->getJson('/api/scenes/'.$scene->id.'/snapshot')->assertOk()->assertJsonPath('characters.0.name', 'Edited Hero')->assertJsonPath('characters.0.hp', 28)->assertJsonPath('characters.0.hitPointDice.0.current', 3)->assertJsonPath('tokens.0.characterId', $id)->assertJsonMissingPath('characters.0.rulesSuggestion');
            $athletics = collect($snapshot->json('characters.0.derived.checks'))->firstWhere('key', 'athletics');
            $this->assertSame(5, $athletics['modifier']); // STR 4 + proficiency 3 - exhaustion 2.
        }
        $this->actingAs($this->gm)->deleteJson($this->url('/characters/'.$id), ['clientMutationId' => (string) Str::uuid()])->assertConflict();
        $this->assertDatabaseHas('tokens', ['id' => $token, 'character_id' => $id]);
    }

    public function test_ownership_validation_and_safe_delete_boundaries(): void
    {
        $outsider = User::factory()->create();
        $this->actingAs($this->gm)->postJson($this->url('/characters'), ['name' => 'Bad owner', 'owner_user_id' => $outsider->id])->assertUnprocessable();
        $this->postJson($this->url('/characters'), ['name' => 'Bad dice', 'hit_point_dice' => [['die' => 'd6', 'max' => 1, 'current' => 2]]])->assertUnprocessable();
        $id = $this->postJson($this->url('/characters'), ['name' => 'Owned', 'owner_user_id' => $this->player->id])->assertOk()->json('character.id');
        $this->actingAs($outsider)->getJson($this->url('/characters'))->assertForbidden();
        $this->actingAs($this->player)->getJson($this->url('/characters'))->assertOk()->assertJsonCount(1, 'characters');
        $this->deleteJson($this->url('/characters/'.$id))->assertForbidden();
        $this->actingAs($this->gm)->postJson($this->url('/characters'), ['id' => $id, 'name' => 'Private', 'owner_user_id' => null])->assertOk();
        $this->actingAs($this->player)->getJson($this->url('/characters'))->assertJsonCount(0, 'characters');
        $foreign = Campaign::create(['name' => 'Other']);
        $other = $foreign->characters()->create(['name' => 'Other']);
        $this->actingAs($this->gm)->postJson($this->url('/characters'), ['id' => $other->id, 'name' => 'Cross campaign'])->assertNotFound();
        $this->deleteJson($this->url('/characters/'.$other->id))->assertNotFound();
        $this->deleteJson($this->url('/characters/'.$id), ['clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->assertNull(Character::find($id));
    }

    public function test_editor_exhaustion_uses_lifecycle_and_cannot_revive_a_dead_character(): void
    {
        $this->actingAs($this->gm);
        $id = $this->postJson($this->url('/characters'), ['name' => 'Exhausted', 'exhaustion' => 6])->assertOk()
            ->assertJsonPath('character.hp', 0)->assertJsonPath('character.lifecycle.status', 'dead')->json('character.id');
        $this->postJson($this->url('/characters'), ['id' => $id, 'name' => 'Still dead', 'hp' => 10, 'exhaustion' => 0])->assertUnprocessable();
        $this->assertDatabaseHas('characters', ['id' => $id, 'hp' => 0, 'exhaustion' => 6]);
        $this->postJson($this->url('/characters'), ['id' => $id, 'name' => 'Still dead', 'exhaustion' => 0])->assertOk()
            ->assertJsonPath('character.lifecycle.status', 'dead');
    }

    public function test_builder_origin_and_multiple_starting_items_are_atomic_and_replay_safe(): void
    {
        $this->actingAs($this->gm);
        $items = collect(['Rope', 'Torch'])->map(fn ($name) => tap((new ItemDefinition)->forceFill([
            'campaign_id' => $this->campaign->id, 'name' => $name, 'icon' => 'book', 'category' => 'misc', 'rarity' => 'common',
            'width' => 1, 'height' => 1, 'max_stack' => 10, 'equipment_slots' => [], 'modifiers' => [],
        ]), fn ($item) => $item->save()));
        $payload = ['name' => 'Builder Hero', 'origin' => ['species' => 'Elf', 'background' => 'Explorer'],
            'starting_items' => $items->map(fn ($item) => ['definitionId' => $item->id, 'quantity' => 2])->all(),
            'clientMutationId' => (string) Str::uuid()];
        $id = $this->postJson($this->url('/characters'), $payload)->assertOk()
            ->assertJsonPath('character.origin.species', 'Elf')->json('character.id');
        $this->postJson($this->url('/characters'), $payload)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertDatabaseCount('characters', 1);
        $this->assertSame(4, (int) Character::findOrFail($id)->inventory()->sum('quantity'));
        $this->getJson($this->url('/characters'))->assertOk()->assertJsonPath('characters.0.origin.background', 'Explorer');
        $payload['clientMutationId'] = (string) Str::uuid();
        $payload['starting_items'][1]['definitionId'] = (string) Str::uuid();
        $this->postJson($this->url('/characters'), $payload)->assertNotFound();
        $this->assertDatabaseCount('characters', 1);
        $this->assertDatabaseCount('inventory_items', 2);
        $foreign = Campaign::create(['name' => 'Foreign']);
        $items[1]->forceFill(['campaign_id' => $foreign->id])->save();
        $payload['starting_items'][1]['definitionId'] = $items[1]->id;
        $payload['clientMutationId'] = (string) Str::uuid();
        $this->postJson($this->url('/characters'), $payload)->assertNotFound();
        $this->assertDatabaseCount('characters', 1);
        $this->postJson($this->url('/characters'), ['id' => $id, ...$payload])->assertUnprocessable();
        $this->postJson($this->url('/characters'), ['name' => 'Bad metadata', 'origin' => ['classes' => 'Wizard']])->assertUnprocessable();
        $this->postJson($this->url('/characters'), ['name' => 'Bad spell', 'starting_spells' => [999999]])->assertNotFound();
        $this->assertDatabaseCount('characters', 1);
    }

    public function test_builder_spell_assignment_preserves_provenance_and_rolls_back_a_partial_copy(): void
    {
        $raw = json_decode(file_get_contents(base_path('tests/Fixtures/compendium/spells-fire-bolt.json')), true);
        app(CompendiumSync::class)->import(CompendiumSource::firstOrFail(), [['endpoint' => 'spells', 'data' => $raw]], ['spells']);
        $spell = CompendiumEntry::where('external_key', 'fire-bolt')->firstOrFail();
        $this->actingAs($this->gm);
        $payload = ['name' => 'Spell Hero', 'starting_spells' => [$spell->id], 'clientMutationId' => (string) Str::uuid()];
        $id = $this->postJson($this->url('/characters'), $payload)->assertOk()->assertJsonCount(1, 'character.abilities')->json('character.id');
        $this->assertDatabaseHas('compendium_copies', ['character_id' => $id, 'compendium_entry_id' => $spell->id]);
        $this->postJson($this->url('/characters'), $payload)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertDatabaseCount('compendium_copies', 1);
        $payload['clientMutationId'] = (string) Str::uuid();
        $payload['starting_spells'][] = 999999;
        $this->postJson($this->url('/characters'), $payload)->assertNotFound();
        $this->assertDatabaseCount('characters', 1);
        $this->assertDatabaseCount('compendium_copies', 1);
        $this->actingAs($this->player)->postJson($this->url('/characters'), $payload)->assertForbidden();
    }
}
