<?php

namespace App\Actions;

use App\Combat\AppliedConditions;
use App\Combat\TurnBudget;
use App\Models\Character;
use App\Models\Token;
use App\Models\User;
use App\Services\CharacterCatalog;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class TokenCombatActions
{
    public function __construct(private SceneTransaction $transaction, private SceneSnapshotBuilder $snapshots) {}

    public function execute(User $user, Token $token, string $command, array $data): array
    {
        return $this->transaction->run($token->scene, function ($scene) use ($user, $token, $command, $data) {
            $token = $scene->tokens()->findOrFail($token->id);
            $token->setRelation('scene', $scene);
            Gate::forUser($user)->authorize($command === 'stand-up' ? 'move' : 'update', $token);
            if ($command === 'hp') {
                $this->adjustHp($user, $token, $data['delta']);
            } elseif ($command === 'stand-up') {
                app(TurnBudget::class)->stand($token);
            } elseif ($command === 'condition-add') {
                $key = $data['key'] ?? null;
                $definition = $key ? (app(CharacterCatalog::class)->entries('conditions')[$key] ?? null) : null;
                if ($definition) {
                    $source = isset($data['source_token_id']) ? $scene->tokens()->findOrFail($data['source_token_id']) : null;
                    app(AppliedConditions::class)->apply($user, $token, $data, $source, null, $data['visibility']);

                    return ['token' => $this->snapshots->token($token->fresh(), true, $user), '_wasVisible' => ! $token->is_hidden, '_combatChanged' => true];
                }
                $label = $definition['name'] ?? ($key ? ucfirst($key) : Str::squish($data['label']));
                if ($label === '') {
                    throw ValidationException::withMessages(['label' => 'Enter a condition name.']);
                }
                $normalized = Str::lower($label);
                $existing = $token->conditions()->where('normalized_label', $normalized)->first();
                if (! $existing) {
                    abort_if($token->conditions()->count() >= 30, 422, 'A token can have up to 30 conditions.');
                    $token->conditions()->create(['key' => $key, 'compendium_entry_id' => $definition['compendium_entry_id'] ?? null,
                        'label' => $label, 'normalized_label' => $normalized, 'visibility' => $data['visibility'], 'created_by' => $user->id]);
                } elseif ($definition && ! $existing->compendium_entry_id) {
                    $existing->update(['key' => $key, 'compendium_entry_id' => $definition['compendium_entry_id']]);
                }
            } else {
                $condition = $token->conditions()->findOrFail($data['conditionId']);
                if ($command === 'condition-remove') {
                    app(AppliedConditions::class)->remove($condition);
                } else {
                    $condition->update(['visibility' => $data['visibility']]);
                }
            }

            return ['token' => $this->snapshots->token($token->refresh(), $scene->campaign->roleFor($user) === 'gm', $user), '_combatChanged' => true, 'charactersChanged' => $token->character_id !== null && $command === 'hp', '_wasVisible' => ! $token->is_hidden];
        }, $command === 'hp' ? 'token.hp_changed' : 'token.conditions_changed');
    }

    /** Caller holds campaign/scene locks and authorizes the command (GM or configured ability). */
    public function adjustHp(User $user, Token|Character $subject, int $delta): void
    {
        $hp = ['hp' => max(0, min($subject->max_hp, $subject->hp + $delta))];
        if ($subject instanceof Character) {
            $subject->update($hp);
            app(CharacterActions::class)->publish($user, $subject);
        } elseif ($subject->character_id) {
            app(CharacterActions::class)->updateLinked($user, $subject, $hp);
        } else {
            $subject->update($hp);
        }
    }
}
