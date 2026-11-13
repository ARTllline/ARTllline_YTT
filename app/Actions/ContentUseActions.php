<?php

namespace App\Actions;

use App\Combat\CombatLog;
use App\Combat\LifeCycle;
use App\Combat\TurnBudget;
use App\Compendium\BasicExecutionProfiles;
use App\Items\ItemActions;
use App\Models\AbilityExecution;
use App\Models\CampaignMember;
use App\Models\Character;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Services\SceneVisibility;
use App\Spells\SpellCasting;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/** Reference content creates a durable GM request, never an executable recipe. */
class ContentUseActions
{
    public function source(Character $character, array $data): array
    {
        if (! empty($data['inventoryItemId'])) {
            $item = $character->inventory()->with('definition')->where('quantity', '>', 0)->findOrFail($data['inventoryItemId']);
            $d = $item->definition;
            abort_unless(data_get($d->content, 'gates.execute') === false || BasicExecutionProfiles::allowed($d), 422, 'Используйте штатное действие предмета.');

            return ['name' => $d->name, 'icon' => $d->icon, 'description' => $d->description, 'content' => $d->content,
                'fingerprint' => hash('sha256', json_encode($d->getAttributes())), 'costs' => [], 'level' => 0, 'automated' => BasicExecutionProfiles::allowed($d)];
        }
        $ability = collect($character->abilities ?? [])->firstWhere('id', $data['abilityId']);
        abort_unless($ability && $ability['enabled'] && ($ability['spell']['known'] ?? false), 403);
        abort_unless(data_get($ability, 'spell.content.gates.execute') === false || BasicExecutionProfiles::allowed($ability), 422, 'Используйте штатное действие заклинания.');
        abort_unless($ability['spell']['prepared'] && ($ability['spell']['available'] ?? true), 422, 'Заклинание не подготовлено или закрыто GM.');

        return ['name' => $ability['name'], 'icon' => $ability['icon'], 'description' => $ability['description'], 'content' => $ability['spell']['content'],
            'fingerprint' => hash('sha256', json_encode($ability)), 'costs' => $ability['costs'], 'level' => $ability['spell']['level'], 'activation' => $ability['activation'] ?? 'action', 'automated' => BasicExecutionProfiles::allowed($ability)];
    }

    public function request(User $user, Scene $scene, array $data): array
    {
        $execution = null;
        $response = app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $data, &$execution) {
            Gate::forUser($user)->authorize('view', $scene);
            $character = app(AbilityActions::class)->authorize($user, $scene->campaign, $data['characterId']);
            abort_unless($scene->campaign->active_scene_id === $scene->id && $scene->campaign->live_revision === $data['epoch'], 409, 'Сцена изменилась.');
            if ($scene->campaign->roleFor($user) !== 'gm') {
                abort_unless((int) CampaignMember::where('campaign_id', $scene->campaign_id)->where('user_id', $user->id)->value('active_character_id') === $character->id, 409, 'Выберите действующего персонажа.');
            }
            abort_if(app(LifeCycle::class)->blocked($character), 422, 'Персонаж не может действовать.');
            $source = $this->source($character, $data);
            $level = $data['castLevel'] ?? $source['level'];
            abort_unless($source['level'] ? $level >= $source['level'] && $level <= 9 : $level === 0, 422, 'Недопустимый круг.');
            $target = $this->target($user, $scene, $data['targetId'] ?? null);
            $automatic = $source['automated'] ? app(BasicContentExecution::class)->roll($user, $scene, $character, $data + ['castLevel' => $level]) : null;
            $id = (string) Str::uuid();
            $actor = $scene->tokens()->where('character_id', $character->id)->where('is_hidden', false)->first();
            $result = ['id' => $id, 'abilityId' => $data['abilityId'] ?? app(ItemActions::class)->key($data['inventoryItemId']),
                'abilityName' => $source['name'], 'actorId' => (string) $character->id, 'actorName' => $character->name,
                'category' => 'utility', 'coverage' => 'MANUAL', 'manualResolution' => 'pending', 'castLevel' => $level,
                'target' => isset($target) ? ['kind' => 'token', 'id' => (string) $target->id] : null,
                'roll' => null, 'damage' => null, 'healing' => null, 'outcomes' => [], 'success' => true,
                'preview' => $automatic ? ['attack' => $automatic['rolls']['roll'] ? array_intersect_key($automatic['rolls']['roll'], array_flip(['rawDice', 'natural', 'modifier', 'total', 'rollMode'])) : null, 'healing' => $automatic['rolls']['healingRoll'], 'damage' => array_map(fn ($r) => $r['roll'], $automatic['rolls']['damageRolls'])] : null,
                'mutationId' => app(CommandContext::class)->id(),
                'gmContext' => ['sourceTokenId' => $actor ? (string) $actor->id : null, 'description' => $source['content']['reference'] ?? $source['description'],
                    'remaining' => 'Проверьте цель, итоговый эффект и отдельно подтвердите расход. Текст не исполняется.',
                    'appliedSummary' => 'только запрос; HP и ресурсы не изменены', 'activation' => 'pending', 'slotSpent' => 0,
                    'contentUse' => $source + ['inventoryItemId' => $data['inventoryItemId'] ?? null, 'abilityId' => $data['abilityId'] ?? null, 'castLevel' => $level, 'automatic' => $automatic]]];
            AbilityExecution::create(['id' => $id, 'campaign_id' => $scene->campaign_id, 'character_id' => $character->id,
                'user_id' => $user->id, 'mutation_id' => app(CommandContext::class)->id(), 'ability_key' => $result['abilityId'],
                'context' => ['sceneId' => (string) $scene->id, 'epoch' => $data['epoch']], 'result' => $result, 'created_at' => now()]);
            app(CombatLog::class)->write(app(TurnBudget::class)->active($scene->id), 'ability.resolved', ['executionId' => $id, 'result' => $result], $scene->id);

            // GM-only request data never enters scene incremental payloads.
            $execution = array_diff_key($result, ['gmContext' => true]);

            return [];
        }, 'combat.session');

        return $response + ['execution' => $execution];
    }

    public function target(User $user, Scene $scene, ?int $id): ?Token
    {
        Gate::forUser($user)->authorize('view', $scene);
        if (! $id) {
            return null;
        }
        $target = $scene->tokens()->findOrFail($id);
        if ($scene->campaign->roleFor($user) !== 'gm') {
            abort_if($target->is_hidden, 404);
            if ($scene->vision_enabled) {
                abort_unless(app(SceneVisibility::class)->view($scene, $user)['tokens']->contains('id', $target->id), 404);
            }
        }

        return $target;
    }

    /** Called under the existing campaign/scene transaction and GM authorization. */
    public function confirm(User $user, Scene $scene, AbilityExecution $execution, array $data): array
    {
        Gate::forUser($user)->authorize('update', $scene);
        $prepared = $execution->result['gmContext']['contentUse'];
        if (! empty($prepared['automatic'])) {
            return app(BasicContentExecution::class)->confirm($scene, $execution);
        }
        $character = $scene->campaign->characters()->findOrFail($execution->character_id);
        $source = $this->source($character, $prepared);
        abort_unless(hash_equals($prepared['fingerprint'], $source['fingerprint']), 409, 'Источник изменился. Закройте запрос и подготовьте новый.');
        $summary = [];
        if ($data['spendItem'] ?? false) {
            abort_unless($prepared['inventoryItemId'], 422);
            $item = $character->inventory()->findOrFail($prepared['inventoryItemId']);
            app(ItemActions::class)->spendStack($item);
            $summary[] = 'предмет −1';
        }
        if ($data['spendSlot'] ?? false) {
            $level = $prepared['castLevel'];
            abort_unless(! $prepared['inventoryItemId'] && $level > 0, 422);
            $state = app(SpellCasting::class)->state($character);
            abort_unless(($state['slots'][$level]['current'] ?? 0) > 0, 422, 'Нет ячейки выбранного круга.');
            if ($combat = app(TurnBudget::class)->active($scene->id)) {
                abort_if(DB::table('spell_turn_slots')->where('combat_id', $combat->id)->where('character_id', $character->id)->where('turn_sequence', $combat->turn_sequence)->exists(), 422, 'На этом ходу уже потрачена ячейка заклинания.');
            }
            // Spend only the explicitly confirmed slot; no material/effect inference.
            app(SpellCasting::class)->spend($character, ['spell' => ['level' => $level], '_castLevel' => $level], $scene, false);
            $summary[] = 'ячейка '.$level.' −1';
        }
        if ($data['spendCosts'] ?? false) {
            $resources = $character->resources ?? [];
            foreach ($source['costs'] as $cost) {
                $index = collect($resources)->search(fn ($r) => $r['key'] === $cost['key']);
                abort_if($index === false || $resources[$index]['current'] < $cost['amount'], 422, 'Недостаточно ресурса.');
                $resources[$index]['current'] -= $cost['amount'];
                $summary[] = $resources[$index]['label'].' −'.$cost['amount'];
            }
            $character->update(['resources' => $resources]);
        }
        if ($data['spendAction'] ?? false) {
            $actor = $scene->tokens()->where('character_id', $character->id)->first();
            $activation = $data['activation'] ?? $source['activation'] ?? 'action';
            app(TurnBudget::class)->spend($actor, $activation, $scene->id);
            $summary[] = 'действие: '.$activation;
        }
        $effect = $data['effect'] ?? 'log';
        if ($effect !== 'log') {
            $target = $scene->tokens()->findOrFail($data['targetId'] ?? 0);
            $amount = $data['amount'] ?? 0;
            abort_unless($amount > 0, 422, 'Введите подтверждённую величину.');
            $before = $target->hp;
            // Exactly the same command as the existing Damage / Heal controls.
            app(TokenCombatActions::class)->execute($user, $target, 'hp', ['delta' => $effect === 'damage' ? -$amount : $amount]);
            $scene->refresh(); // The reused HP command published its own incremental revision.
            $summary[] = $target->name.': HP '.$before.' → '.$target->fresh()->hp;
        }
        app(CharacterActions::class)->publish($user, $character->fresh(), $scene->id);

        return ['effect' => $effect, 'targetId' => $data['targetId'] ?? null, 'amount' => $data['amount'] ?? 0, 'summary' => $summary];
    }
}
