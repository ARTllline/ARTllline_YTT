<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\AbilityExecution;
use App\Models\Campaign;
use App\Models\ItemDefinition;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class SessionContentUseTest extends TestCase
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
        $this->campaign = Campaign::create(['name' => 'Content use']);
        foreach ([$this->gm, $this->player, $this->other] as $u) {
            $this->campaign->members()->attach($u, ['role' => $u === $this->gm ? 'gm' : 'player']);
        }
        $this->scene = $this->campaign->scenes()->create(['name' => 'Session']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->spell = ['id' => (string) Str::uuid(), 'name' => 'Cure Wounds', 'icon' => 'heart', 'description' => 'Reference only; not executable.',
            'category' => 'effect', 'target' => 'none', 'check' => null, 'damage' => null, 'result' => ['type' => 'nothing', 'amount' => 0, 'target' => null], 'sort_order' => 0,
            'enabled' => true, 'costs' => [['key' => 'focus', 'amount' => 1]], 'activation' => 'action',
            'spell' => ['known' => true, 'prepared' => true, 'level' => 1, 'school' => 'evocation', 'classes' => [], 'coverage' => 'MANUAL', 'manual_allowed' => false, 'concentration' => false, 'content' => $this->content()]];
        $this->hero = $this->campaign->characters()->create(['name' => 'Hero', 'owner_user_id' => $this->player->id, 'kind' => 'player_character', 'hp' => 10, 'max_hp' => 20,
            'resources' => [['key' => 'focus', 'label' => 'Focus', 'current' => 2, 'max' => 2]], 'abilities' => [$this->spell],
            'spellcasting' => ['slots' => [1 => ['max' => 2, 'current' => 2]]]]);
        $this->scene->tokens()->create(['name' => 'Hero', 'character_id' => $this->hero->id, 'x' => 0, 'y' => 0]);
        $this->target = $this->scene->tokens()->create(['name' => 'Target', 'hp' => 10, 'max_hp' => 20, 'x' => 50, 'y' => 0]);
        DB::table('campaign_members')->where('campaign_id', $this->campaign->id)->where('user_id', $this->player->id)->update(['active_character_id' => $this->hero->id]);
    }

    private function content(): array
    {
        return ['gates' => ['browse' => true, 'copy' => true, 'execute' => false], 'reference' => 'Reference: GM decides all effects.'];
    }

    protected function tearDown(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::table('item_definitions')->update(['content' => null]);
        }
        parent::tearDown();
    }

    private function item(string $name)
    {
        $d = (new ItemDefinition)->forceFill(['campaign_id' => $this->campaign->id, 'name' => $name, 'icon' => 'item_potion', 'category' => 'adventuring_gear', 'rarity' => 'common',
            'width' => 1, 'height' => 1, 'max_stack' => 10, 'equipment_slots' => [], 'modifiers' => [], 'gameplay' => [], 'content' => $this->content()]);
        $d->save();

        return $this->hero->inventory()->create(['item_definition_id' => $d->id, 'quantity' => 2, 'x' => 0, 'y' => 0]);
    }

    private function initiate(array $data = [], $user = null)
    {
        return $this->actingAs($user ?? $this->player)->postJson('/api/scenes/'.$this->scene->id.'/content-use', $data + ['characterId' => $this->hero->id, 'abilityId' => $this->spell['id'], 'targetId' => $this->target->id, 'epoch' => 0, 'clientMutationId' => (string) Str::uuid()]);
    }

    private function resolve(string $id, array $data = [], $user = null)
    {
        return $this->actingAs($user ?? $this->gm)->postJson('/api/scenes/'.$this->scene->id.'/combat/session', $data + ['action' => 'resolve', 'executionId' => $id, 'status' => 'resolved', 'clientMutationId' => (string) Str::uuid()]);
    }

    public function test_cure_wounds_is_pending_without_costs_then_gm_confirms_existing_heal_command_once(): void
    {
        $body = ['clientMutationId' => (string) Str::uuid()];
        $first = $this->initiate($body)->assertOk()->assertJsonPath('execution.manualResolution', 'pending')->assertJsonMissingPath('execution.gmContext');
        $this->initiate($body)->assertOk()->assertJsonPath('execution.id', $first->json('execution.id'));
        $this->assertSame(1, AbilityExecution::count());
        $this->assertSame(10, $this->target->fresh()->hp);
        $this->assertSame(2, $this->hero->fresh()->spellcasting['slots'][1]['current']);
        $id = $first->json('execution.id');
        $this->resolve($id, ['confirmed' => true, 'effect' => 'heal', 'amount' => 8, 'targetId' => $this->target->id], $this->player)->assertForbidden();
        $this->resolve($id)->assertUnprocessable();
        $d = ['confirmed' => true, 'effect' => 'heal', 'amount' => 50, 'targetId' => $this->target->id, 'spendSlot' => true, 'spendCosts' => true, 'clientMutationId' => (string) Str::uuid()];
        $this->resolve($id, $d)->assertOk();
        $this->resolve($id, $d)->assertOk();
        $this->assertSame(20, $this->target->fresh()->hp);
        $this->assertSame(1, $this->hero->fresh()->spellcasting['slots'][1]['current']);
        $this->assertSame(1, $this->hero->fresh()->resources[0]['current']);
        $this->assertFalse($this->hero->fresh()->abilities[0]['spell']['content']['gates']['execute']);
        $this->assertSame('resolved_by_gm', AbilityExecution::find($id)->result['manualResolution']);
        $this->assertSame(1, DB::table('combat_events')->where('type', 'gm.correction')->count());
        $this->assertSame(1, DB::table('combat_events')->where('type', 'manual.resolved')->count());
        $this->resolve($id, ['confirmed' => true])->assertConflict();
        $log = $this->actingAs($this->gm)->getJson('/api/scenes/'.$this->scene->id.'/session-log')->assertOk()->json('events');
        $this->assertStringContainsString('HP 10 → 20', collect($log)->firstWhere('type', 'manual.resolved')['data']['note']);
        Event::assertDispatched(TabletopEvent::class, fn ($e) => ($e->envelope['type'] ?? '') === 'combat.session');
    }

    public function test_longsword_gm_can_initiate_and_apply_damage_without_consuming_weapon(): void
    {
        $item = $this->item('Longsword');
        $id = $this->initiate(['abilityId' => null, 'inventoryItemId' => $item->id], $this->gm)->assertOk()->json('execution.id');
        $this->resolve($id, ['confirmed' => true, 'effect' => 'damage', 'targetId' => $this->target->id, 'amount' => 4])->assertOk();
        $this->assertSame(6, $this->target->fresh()->hp);
        $this->assertSame(2, $item->fresh()->quantity);
        $this->assertFalse($item->definition->fresh()->content['gates']['execute']);
    }

    public function test_potion_needs_explicit_consumption_and_atomic_failure_keeps_request_pending(): void
    {
        $item = $this->item('Potion of Healing');
        $id = $this->initiate(['abilityId' => null, 'inventoryItemId' => $item->id])->assertOk()->json('execution.id');
        $this->assertSame(2, $item->fresh()->quantity);
        $this->resolve($id, ['confirmed' => true, 'effect' => 'heal', 'targetId' => 999999, 'amount' => 6, 'spendItem' => true])->assertNotFound();
        $this->assertSame(2, $item->fresh()->quantity);
        $this->assertSame('pending', AbilityExecution::find($id)->result['manualResolution']);
        $this->resolve($id, ['confirmed' => true, 'effect' => 'heal', 'targetId' => $this->target->id, 'amount' => 6, 'spendItem' => true])->assertOk();
        $this->assertSame(16, $this->target->fresh()->hp);
        $this->assertSame(1, $item->fresh()->quantity);
    }

    public function test_ownership_hidden_targets_epoch_and_changed_sources_are_checked(): void
    {
        $this->initiate([], $this->other)->assertForbidden();
        $this->initiate(['epoch' => 999])->assertConflict();
        $this->target->update(['is_hidden' => true]);
        $this->initiate()->assertNotFound();
        $this->target->update(['is_hidden' => false]);
        $id = $this->initiate()->assertOk()->json('execution.id');
        $a = $this->spell;
        $a['description'] = 'Changed';
        $this->hero->update(['abilities' => [$a]]);
        $this->resolve($id, ['confirmed' => true])->assertConflict();
        $this->resolve($id, ['status' => 'dismissed'])->assertOk();
        $this->assertSame(2, $this->hero->fresh()->spellcasting['slots'][1]['current']);
    }

    public function test_replay_rechecks_revoked_ownership_and_conflicting_uuid_payload(): void
    {
        $d = ['clientMutationId' => (string) Str::uuid()];
        $this->initiate($d)->assertOk();
        $this->initiate($d + ['castLevel' => 2])->assertConflict();
        $this->hero->update(['owner_user_id' => $this->other->id]);
        $this->initiate($d)->assertForbidden();
    }

    public function test_log_only_confirmation_and_dismissal_do_not_spend_anything(): void
    {
        $id = $this->initiate()->assertOk()->json('execution.id');
        $this->actingAs($this->gm)->getJson('/api/scenes/'.$this->scene->id.'/combat/session')->assertJsonPath('pending.0.id', $id);
        $this->resolve($id, ['confirmed' => true, 'effect' => 'log', 'note' => 'No effect; GM ruling'])->assertOk();
        $this->assertSame(10, $this->target->fresh()->hp);
        $this->assertSame(2, $this->hero->fresh()->spellcasting['slots'][1]['current']);
        $this->assertSame(2, $this->hero->fresh()->resources[0]['current']);
    }

    public function test_insufficient_confirmed_slot_rolls_back_and_unchecked_costs_do_not_block_manual_ruling(): void
    {
        $id = $this->initiate()->assertOk()->json('execution.id');
        $this->hero->update(['spellcasting' => ['slots' => [1 => ['max' => 2, 'current' => 0]]]]);
        $this->resolve($id, ['confirmed' => true, 'effect' => 'heal', 'targetId' => $this->target->id, 'amount' => 6, 'spendSlot' => true])->assertUnprocessable();
        $this->assertSame(10, $this->target->fresh()->hp);
        $this->assertSame('pending', AbilityExecution::find($id)->result['manualResolution']);
        $this->resolve($id, ['confirmed' => true, 'effect' => 'heal', 'targetId' => $this->target->id, 'amount' => 6])->assertOk();
        $this->assertSame(16, $this->target->fresh()->hp);
        $this->assertSame(0, $this->hero->fresh()->spellcasting['slots'][1]['current']);
    }

    public function test_receipt_replay_does_not_disclose_a_target_hidden_after_request(): void
    {
        $d = ['clientMutationId' => (string) Str::uuid()];
        $this->initiate($d)->assertOk();
        $this->target->update(['is_hidden' => true]);
        $this->initiate($d)->assertNotFound();
    }
}
