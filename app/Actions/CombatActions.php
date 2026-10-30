<?php

namespace App\Actions;

use App\Combat\AppliedConditions;
use App\Combat\CombatLog;
use App\Combat\TurnBudget;
use App\Models\Combat;
use App\Models\Scene;
use App\Models\User;
use App\Services\SceneSnapshotBuilder;
use App\Services\TriggerEvents;
use App\Spells\SpellEffects;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class CombatActions
{
    public function __construct(private SceneTransaction $transaction) {}

    public function execute(User $user, Scene $scene, string $command, array $data): array
    {
        return $this->transaction->run($scene, function (Scene $scene) use ($user, $command, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $combat = Combat::where('scene_id', $scene->id)->whereIn('status', ['preparing', 'active'])->first();
            $previousStatus = $combat?->status;
            $previousRound = $combat?->round;
            if ($command === 'prepare') {
                abort_if($combat !== null, 409, 'This scene already has a combat. Reload its current state.');
                Combat::create(['scene_id' => $scene->id, 'created_by' => $user->id]);
            } else {
                abort_unless($combat && (string) $combat->id === $data['combatId'], 409, 'Combat changed. Reload its current state.');
                $this->change($combat, $scene, $command, $data);
                $type = $previousStatus === 'preparing' && $combat->status === 'active' ? 'combat.started'
                    : ($previousStatus === 'active' && $combat->round > $previousRound ? 'combat.round' : null);
                if ($type) {
                    app(TriggerEvents::class)->event($scene, $type, 'scene:'.$scene->id.':revision:'.($scene->revision + 1).':combat:'.$combat->id, ['round' => $combat->round]);
                }
            }

            return ['charactersChanged' => true, '_combatChanged' => true, 'tokens' => $scene->tokens()->get()->map(fn ($t) => app(SceneSnapshotBuilder::class)->token($t, true, $user))->all()];
        }, 'combat.updated');
    }

    private function change(Combat $combat, Scene $scene, string $command, array $data): void
    {
        $entries = $combat->combatants()->get();
        $ids = $entries->pluck('id')->map(fn ($id) => (string) $id)->all();
        switch ($command) {
            case 'add':
                $tokenIds = $data['tokenIds'];
                if ($scene->tokens()->whereIn('id', $tokenIds)->count() !== count($tokenIds)) {
                    throw ValidationException::withMessages(['tokenIds' => 'Choose tokens from this scene.']);
                }
                $position = ($entries->max('position') ?? -1) + 1;
                foreach ($tokenIds as $tokenId) {
                    $combat->combatants()->firstOrCreate(['token_id' => $tokenId], ['position' => $position++]);
                }
                break;
            case 'remove':
                $this->remove($combat, $data['combatantId']);
                break;
            case 'initiative':
                $entry = $entries->firstWhere('id', $data['combatantId']);
                abort_unless($entry, 422, 'This combatant is no longer in combat.');
                $entry->update(['initiative' => $data['initiative']]);
                if ($combat->status === 'preparing') {
                    $this->sort($combat);
                }
                break;
            case 'sort':
                $this->sort($combat);
                break;
            case 'reorder':
                $order = $data['combatantIds'];
                abort_unless(count($order) === count($ids) && ! array_diff($order, $ids), 409, 'Combat order changed. Reload before reordering.');
                foreach ($order as $position => $id) {
                    $combat->combatants()->whereKey($id)->update(['position' => $position]);
                }
                break;
            case 'begin':
                abort_unless($combat->status === 'preparing' && $entries->isNotEmpty(), 422, 'Add combatants before beginning combat.');
                $combat->update(['status' => 'active', 'round' => 1, 'current_combatant_id' => $entries->first()->id, 'started_at' => now()]);
                foreach ($entries as $entry) {
                    $c = $entry->token->character;
                    if ($c && ($c->rest_state['status'] ?? '') === 'spending') {
                        $c->update(['rest_state' => array_replace($c->rest_state, ['status' => 'interrupted', 'interruption' => 'initiative'])]);
                    }
                }
                $combat->combatants()->update(['action_available' => true, 'bonus_available' => true, 'reaction_available' => true, 'movement_spent' => 0]);
                app(TurnBudget::class)->start($combat, $entries->first()->id);
                break;
            case 'next':
            case 'previous':
                abort_unless($combat->status === 'active', 422, 'Begin combat first.');
                abort_unless($combat->round === $data['expectedRound'] && (string) $combat->current_combatant_id === (string) $data['expectedCurrentCombatantId'], 409, 'The turn already changed in another window. Current combat has been restored.');
                abort_if($entries->isEmpty(), 422, 'Add a combatant or end combat.');
                $index = array_search((string) $combat->current_combatant_id, $ids, true);
                $round = $combat->round;
                if ($index === false) {
                    $index = 0;
                } elseif ($command === 'next') {
                    $index++;
                    if ($index === count($ids)) {
                        $index = 0;
                        $round++;
                    }
                } elseif ($index > 0) {
                    $index--;
                } elseif ($round > 1) {
                    $index = count($ids) - 1;
                    $round--;
                }
                if ((string) $combat->current_combatant_id !== $ids[$index] || $combat->round !== $round || $command === 'next') {
                    app(TurnBudget::class)->end($combat);
                    $combat->update(['round' => $round, 'current_combatant_id' => $ids[$index]]);
                    app(TurnBudget::class)->start($combat, (int) $ids[$index]);
                }
                break;
            case 'current':
                abort_unless($combat->status === 'active' && in_array($data['combatantId'], $ids, true), 422, 'Choose a current combatant from this active combat.');
                if ((string) $combat->current_combatant_id !== $data['combatantId']) {
                    app(TurnBudget::class)->end($combat);
                    $combat->update(['current_combatant_id' => $data['combatantId']]);
                    app(TurnBudget::class)->start($combat, (int) $data['combatantId']);
                }
                break;
            case 'override':
                $entry = $combat->combatants()->findOrFail($data['combatantId']);
                $entry->update(array_intersect_key($data, array_flip(['action_available', 'bonus_available', 'reaction_available', 'movement_spent'])));
                app(CombatLog::class)->write($combat, 'budget.override', ['combatantId' => (string) $entry->id, 'tokenId' => (string) $entry->token_id, 'changes' => array_intersect_key($data, array_flip(['action_available', 'bonus_available', 'reaction_available', 'movement_spent']))]);
                break;
            case 'end':
                app(AppliedConditions::class)->finish($combat);
                app(SpellEffects::class)->finish($combat);
                $combat->update(['status' => 'ended', 'ended_at' => now(), 'current_combatant_id' => null]);
                break;
        }
    }

    private function sort(Combat $combat): void
    {
        $entries = $combat->combatants()->get()->sort(function ($a, $b) {
            if ($a->initiative === null || $b->initiative === null) {
                return ($a->initiative === null) <=> ($b->initiative === null) ?: $a->position <=> $b->position;
            }

            return (float) $b->initiative <=> (float) $a->initiative ?: $a->position <=> $b->position;
        });
        foreach ($entries->values() as $position => $entry) {
            $entry->update(['position' => $position]);
        }
    }

    /** Called under the scene lock, also by token deletion in its same transaction. */
    public function remove(Combat $combat, string $id): void
    {
        $entries = $combat->combatants()->get();
        $index = $entries->search(fn ($entry) => (string) $entry->id === $id);
        abort_if($index === false, 422, 'This combatant is no longer in combat.');
        app(AppliedConditions::class)->removeActor($combat, $entries[$index]->token_id);
        if ((string) $combat->current_combatant_id === $id) {
            $next = $entries->count() > 1 ? $entries[($index + 1) % $entries->count()]->id : null;
            $combat->update(['current_combatant_id' => $next]);
            if ($next && $combat->status === 'active') {
                app(TurnBudget::class)->start($combat, $next);
            }
        }
        $entries[$index]->delete();
    }
}
