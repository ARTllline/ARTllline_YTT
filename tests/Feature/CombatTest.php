<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Scene;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class CombatTest extends TestCase
{
    use DatabaseMigrations;

    private User $gm;

    private User $player;

    private Campaign $campaign;

    private Scene $scene;

    private array $tokens;

    private ?string $combatId = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Combat QA']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Arena']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->tokens = [];
        foreach (['Kern', 'Mira', 'Goblin', 'SECRET DRAGON'] as $index => $name) {
            $this->tokens[] = $this->scene->tokens()->create(['name' => $name, 'x' => 30 + $index * 60, 'y' => 90, 'hp' => 20, 'max_hp' => 30, 'is_hidden' => $index === 3, 'owner_user_id' => $index === 0 ? $this->player->id : null]);
        }
        Event::fake([TabletopEvent::class]);
        $this->actingAs($this->gm);
    }

    private function path(string $action): string
    {
        return '/api/scenes/'.$this->scene->id.'/combat/'.$action;
    }

    private function payload(array $data = []): array
    {
        return $data + ['combatId' => $this->combatId, 'clientMutationId' => (string) Str::uuid()];
    }

    private function command(string $action, array $data = []): ?array
    {
        $result = $this->postJson($this->path($action), $this->payload($data))->assertOk()->json();
        if ($action === 'prepare') {
            $this->combatId = $result['combat']['id'];
        }

        return $result['combat'];
    }

    private function prepare(): array
    {
        $this->command('prepare');

        return $this->command('add', ['tokenIds' => array_map(fn ($t) => (string) $t->id, $this->tokens)]);
    }

    private function turn(array $combat): array
    {
        return ['expectedRound' => $combat['round'], 'expectedCurrentCombatantId' => $combat['currentTurn']['combatantId'] ?? null];
    }

    private function snapshot(User $user): array
    {
        return $this->actingAs($user)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()->json();
    }

    private function playerEvents()
    {
        return Event::dispatched(TabletopEvent::class)->pluck(0)->filter(fn ($event) => str_contains($event->channel, '.user.'.$this->player->id))->values();
    }

    public function test_lifecycle_rounds_jump_retry_and_two_gm_stale_turn_conflict(): void
    {
        $this->command('prepare');
        $this->postJson($this->path('begin'), $this->payload())->assertUnprocessable();
        $this->postJson($this->path('prepare'), $this->payload())->assertConflict();
        $combat = $this->command('add', ['tokenIds' => array_map(fn ($t) => (string) $t->id, $this->tokens)]);
        $combat = $this->command('begin');
        $first = $combat['currentTurn'];
        $combat = $this->command('previous', $this->turn($combat));
        $this->assertSame(1, $combat['round']);
        $this->assertSame($first, $combat['currentTurn']);
        $payload = $this->payload($this->turn($combat));
        $accepted = $this->postJson($this->path('next'), $payload)->assertOk()->json();
        $this->postJson($this->path('next'), $payload)->assertOk()->assertExactJson($accepted);
        $secondGm = User::factory()->create();
        $this->campaign->members()->attach($secondGm, ['role' => 'gm']);
        $payload['clientMutationId'] = (string) Str::uuid();
        $this->actingAs($secondGm)->postJson($this->path('next'), $payload)->assertConflict();
        $this->assertSame($accepted['revision'], $this->scene->fresh()->revision);
        $combat = $accepted['combat'];
        for ($i = 0; $i < 3; $i++) {
            $combat = $this->command('next', $this->turn($combat));
        }
        $this->assertSame(2, $combat['round']);
        $this->assertSame($first, $combat['currentTurn']);
        $combat = $this->command('previous', $this->turn($combat));
        $this->assertSame(1, $combat['round']);
        $this->assertSame($combat['combatants'][3]['id'], $combat['currentTurn']['combatantId']);
        $combat = $this->command('current', ['combatantId' => $combat['combatants'][1]['id']]);
        $this->assertSame($combat['combatants'][1]['id'], $combat['currentTurn']['combatantId']);
        $end = $this->payload();
        $response = $this->postJson($this->path('end'), $end)->assertOk()->assertJsonPath('combat', null)->json();
        $this->postJson($this->path('end'), $end)->assertExactJson($response);
        $this->assertDatabaseHas('combats', ['id' => $this->combatId, 'status' => 'ended', 'current_combatant_id' => null]);
        $this->assertNull($this->snapshot($this->player)['combat']);
        $this->actingAs($this->gm);
        $this->command('prepare');
        $this->assertDatabaseCount('combats', 2);
    }

    public function test_initiative_ties_manual_order_active_edit_sort_and_add(): void
    {
        $combat = $this->prepare();
        $ids = array_column($combat['combatants'], 'id');
        foreach ([0 => 10, 1 => 20, 2 => 20] as $i => $value) {
            $combat = $this->command('initiative', ['combatantId' => $ids[$i], 'initiative' => $value]);
        }
        $this->assertSame([$ids[1], $ids[2], $ids[0], $ids[3]], array_column($combat['combatants'], 'id'));
        $order = [$ids[2], $ids[1], $ids[3], $ids[0]];
        $combat = $this->command('reorder', ['combatantIds' => $order]);
        $this->assertSame($order, array_column($combat['combatants'], 'id'));
        $combat = $this->command('begin');
        $current = $combat['currentTurn'];
        $combat = $this->command('initiative', ['combatantId' => $ids[0], 'initiative' => 30.25]);
        $this->assertSame($order, array_column($combat['combatants'], 'id'));
        $combat = $this->command('sort');
        $this->assertSame([$ids[0], $ids[2], $ids[1], $ids[3]], array_column($combat['combatants'], 'id'));
        $this->assertSame($current, $combat['currentTurn']);
        $new = $this->scene->tokens()->create(['name' => 'New', 'x' => 0, 'y' => 0]);
        $combat = $this->command('add', ['tokenIds' => [(string) $new->id, (string) $this->tokens[0]->id]]);
        $this->assertCount(5, $combat['combatants']);
        $this->assertSame((string) $new->id, $combat['combatants'][4]['tokenId']);
        $this->assertSame($current, $combat['currentTurn']);
        $this->postJson($this->path('reorder'), $this->payload(['combatantIds' => $order]))->assertConflict();
    }

    public function test_preparing_inactive_hidden_turn_reveal_and_composite_deletion(): void
    {
        $combat = $this->prepare();
        $this->assertNull($this->snapshot($this->player)['combat']);
        $this->actingAs($this->gm);
        $this->command('begin');
        $hidden = $combat['combatants'][3];
        $combat = $this->command('current', ['combatantId' => $hidden['id']]);
        $safe = $this->snapshot($this->player);
        $this->assertSame(['gmHiddenTurn' => true], $safe['combat']['currentTurn']);
        $this->assertCount(3, $safe['combat']['combatants']);
        $this->assertNotContains($hidden['id'], array_column($safe['combat']['combatants'], 'id'));
        $this->assertStringNotContainsString('SECRET DRAGON', json_encode($safe));
        $this->assertStringNotContainsString('SECRET DRAGON', json_encode($this->playerEvents()));
        $this->actingAs($this->gm)->patchJson('/api/tokens/'.$this->tokens[3]->id, $this->payload(['is_hidden' => false]))->assertOk();
        $event = $this->playerEvents()->last()->envelope;
        $this->assertSame($hidden['tokenId'], $event['payload']['token']['id']);
        $this->assertSame(['combatantId' => $hidden['id']], $event['payload']['combat']['currentTurn']);
        $this->patchJson('/api/tokens/'.$this->tokens[3]->id, $this->payload(['is_hidden' => true]))->assertOk();
        $event = $this->playerEvents()->last()->envelope;
        $this->assertSame($hidden['tokenId'], $event['payload']['deletedId']);
        $this->assertSame(['gmHiddenTurn' => true], $event['payload']['combat']['currentTurn']);
        $before = $this->scene->fresh()->revision;
        $events = $this->playerEvents()->count();
        $result = $this->deleteJson('/api/tokens/'.$this->tokens[3]->id, $this->payload())->assertOk()->assertJsonPath('revision', $before + 1)->json();
        $this->assertSame($combat['combatants'][0]['id'], $result['combat']['currentTurn']['combatantId']);
        $this->assertCount($events + 1, $this->playerEvents());
        $this->assertArrayNotHasKey('deletedId', $this->playerEvents()->last()->envelope['payload']);
        $this->assertSame($result['combat'], $this->playerEvents()->last()->envelope['payload']['combat']);
        foreach ($result['combat']['combatants'] as $entry) {
            $result['combat'] = $this->command('remove', ['combatantId' => $entry['id']]);
        }
        $this->assertNull($result['combat']['currentTurn']);
        $this->assertSame('active', $result['combat']['status']);
        $this->campaign->forceFill(['active_scene_id' => null])->save();
        $events = $this->playerEvents()->count();
        $this->command('end');
        $this->command('prepare');
        $this->assertCount($events, $this->playerEvents());
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertForbidden();
    }

    public function test_hp_deltas_retry_bounds_maximum_and_owner_transfer_are_safe(): void
    {
        $token = $this->tokens[0];
        $path = '/api/tokens/'.$token->id.'/hp';
        $damage = $this->payload(['delta' => -5]);
        $first = $this->postJson($path, $damage)->assertOk()->assertJsonPath('token.hp', 15)->json();
        $this->postJson($path, $damage)->assertExactJson($first);
        $this->postJson($path, $this->payload(['delta' => -7]))->assertOk()->assertJsonPath('token.hp', 8);
        $this->postJson($path, $this->payload(['delta' => 999]))->assertOk()->assertJsonPath('token.hp', 30);
        $this->patchJson('/api/tokens/'.$token->id, $this->payload(['max_hp' => 10]))->assertOk()->assertJsonPath('token.hp', 10);
        $this->postJson($path, $this->payload(['delta' => -999]))->assertOk()->assertJsonPath('token.hp', 0);
        $safe = $this->snapshot($this->player);
        $this->assertSame(0, $safe['tokens'][0]['hp']);
        $this->assertArrayNotHasKey('hp', $safe['tokens'][1]);
        $this->assertArrayNotHasKey('maxHp', $safe['tokens'][1]);
        $other = User::factory()->create();
        $this->campaign->members()->attach($other, ['role' => 'player']);
        $this->actingAs($this->gm)->patchJson('/api/tokens/'.$token->id, $this->payload(['owner_user_id' => $other->id]))->assertOk();
        $this->assertArrayNotHasKey('hp', $this->playerEvents()->last()->envelope['payload']['token']);
        $this->assertSame(0, $this->snapshot($other)['tokens'][0]['hp']);
        $this->assertArrayNotHasKey('hp', $this->snapshot($this->player)['tokens'][0]);
    }

    public function test_conditions_duplicates_visibility_and_move_receipt_filtering(): void
    {
        $token = $this->tokens[0];
        $path = '/api/tokens/'.$token->id;
        $add = $this->payload(['key' => 'poisoned', 'visibility' => 'public']);
        $first = $this->postJson($path.'/condition-add', $add)->assertOk()->json();
        $this->postJson($path.'/condition-add', $add)->assertExactJson($first);
        $this->postJson($path.'/condition-add', $this->payload(['label' => '  POISONED  ', 'visibility' => 'public']))->assertOk();
        $this->postJson($path.'/condition-add', $this->payload(['label' => 'Secret Mark', 'visibility' => 'gm_only']))->assertOk();
        $this->assertDatabaseCount('token_conditions', 2);
        $safe = $this->snapshot($this->player);
        $this->assertCount(1, $safe['tokens'][0]['conditions']);
        $this->assertStringNotContainsString('Secret Mark', json_encode($safe));
        $this->assertStringNotContainsString('Secret Mark', json_encode($this->playerEvents()));
        $move = $this->payload(['x' => 10, 'y' => 20]);
        $this->postJson($path.'/move', $move)->assertOk();
        $conditionId = $first['token']['conditions'][0]['id'];
        $this->actingAs($this->gm)->postJson($path.'/condition-visibility', $this->payload(['conditionId' => $conditionId, 'visibility' => 'gm_only']))->assertOk();
        $this->actingAs($this->player)->postJson($path.'/move', $move)->assertOk()->assertJsonPath('token.conditions', []);
        $remove = $this->payload(['conditionId' => $conditionId]);
        $first = $this->actingAs($this->gm)->postJson($path.'/condition-remove', $remove)->assertOk()->json();
        $this->postJson($path.'/condition-remove', $remove)->assertExactJson($first);
        $this->assertDatabaseCount('token_conditions', 1);
    }

    public function test_all_combat_writes_are_gm_only_and_cross_scene_tokens_are_rejected(): void
    {
        $combat = $this->prepare();
        $before = $this->scene->fresh()->revision;
        $this->actingAs($this->player);
        foreach (['prepare', 'add', 'remove', 'initiative', 'sort', 'reorder', 'begin', 'next', 'previous', 'current', 'end'] as $action) {
            $this->postJson($this->path($action), $this->payload())->assertForbidden();
        }
        foreach (['hp', 'condition-add', 'condition-remove', 'condition-visibility'] as $action) {
            $this->postJson('/api/tokens/'.$this->tokens[0]->id.'/'.$action, $this->payload())->assertForbidden();
        }
        $this->assertSame($before, $this->scene->fresh()->revision);
        $foreign = $this->campaign->scenes()->create(['name' => 'Other'])->tokens()->create(['name' => 'Foreign', 'x' => 0, 'y' => 0]);
        $this->actingAs($this->gm)->postJson($this->path('add'), $this->payload(['tokenIds' => [(string) $foreign->id]]))->assertUnprocessable();
        $this->postJson($this->path('reorder'), $this->payload(['combatantIds' => array_fill(0, 4, $combat['combatants'][0]['id'])]))->assertUnprocessable();
        $this->assertDatabaseCount('combatants', 4);
        $this->assertSame($before, $this->scene->fresh()->revision);
    }
}
