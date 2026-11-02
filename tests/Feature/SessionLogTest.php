<?php

namespace Tests\Feature;

use App\Combat\CombatLog;
use App\Models\Campaign;
use App\Models\Combat;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Str;
use Tests\TestCase;

class SessionLogTest extends TestCase
{
    use DatabaseMigrations;

    public function test_feed_is_gm_only_scene_scoped_paginated_and_excludes_noise(): void
    {
        [$gm, $player, $outsider] = User::factory()->count(3)->create()->all();
        $campaign = Campaign::create(['name' => 'Log']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $scene = $campaign->scenes()->create(['name' => 'Live']);
        $other = $campaign->scenes()->create(['name' => 'Other']);
        $log = app(CombatLog::class);
        $log->write(null, 'gm.check', ['stat' => 'dex', 'outcomes' => []], $other->id);
        for ($i = 0; $i < 55; $i++) {
            $log->write(null, 'gm.check', ['stat' => 'dex', 'outcomes' => []], $scene->id);
        }
        $combat = Combat::create(['scene_id' => $scene->id, 'created_by' => $gm->id]);
        $log->write($combat, 'turn.started', ['round' => 1]);
        $log->write($combat, 'movement.spent', ['distance' => 5]);
        $url = '/api/scenes/'.$scene->id.'/session-log';
        $this->actingAs($player)->getJson($url)->assertForbidden();
        $this->actingAs($outsider)->getJson($url)->assertForbidden();
        $first = $this->actingAs($gm)->getJson($url)->assertOk()->assertJsonCount(50, 'events')->assertJsonPath('hasMore', true)->json();
        $this->assertSame('turn.started', $first['events'][0]['type']);
        $this->getJson($url.'?before='.end($first['events'])['id'])->assertOk()->assertJsonCount(6, 'events')->assertJsonPath('hasMore', false);
        $this->getJson($url.'?filter=runtime')->assertOk()->assertJsonCount(50, 'events');
        $this->getJson($url.'?filter=combat')->assertOk()->assertJsonCount(1, 'events');
        $catchup = $this->getJson($url.'?after=0')->assertOk()->assertJsonCount(50, 'events')->assertJsonPath('hasMore', true)->json();
        $this->getJson($url.'?after='.end($catchup['events'])['id'])->assertOk()->assertJsonCount(6, 'events');
    }

    public function test_outside_combat_commands_are_recorded_once_with_frozen_names(): void
    {
        $gm = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Log']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $scene = $campaign->scenes()->create(['name' => 'Live']);
        $token = $scene->tokens()->create(['name' => 'Керн', 'x' => 0, 'y' => 0, 'hp' => 20, 'max_hp' => 20, 'check_stats' => [['key' => 'str', 'label' => 'Сила', 'modifier' => 2]]]);
        $command = ['action' => 'check', 'tokenIds' => [(string) $token->id], 'stat' => 'str', 'visibility' => 'gm_only', 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($gm)->postJson('/api/scenes/'.$scene->id.'/combat/session', $command)->assertOk();
        $this->postJson('/api/scenes/'.$scene->id.'/combat/session', $command)->assertOk();
        $this->postJson('/api/tokens/'.$token->id.'/hp', ['delta' => -3, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $token->update(['name' => 'Новое имя']);
        $this->getJson('/api/scenes/'.$scene->id.'/session-log')->assertOk()->assertJsonCount(2, 'events')
            ->assertJsonPath('events.0.data.names.'.$token->id, 'Керн')->assertJsonPath('events.0.data.after.hp', 17)
            ->assertJsonPath('events.1.type', 'gm.check')->assertJsonPath('events.1.combatId', null);
    }
}
