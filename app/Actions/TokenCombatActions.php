<?php

namespace App\Actions;

use App\Models\Token;
use App\Models\User;
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
            Gate::forUser($user)->authorize('update', $token);
            if ($command === 'hp') {
                $token->update(['hp' => max(0, min($token->max_hp, $token->hp + $data['delta']))]);
            } elseif ($command === 'condition-add') {
                $key = $data['key'] ?? null;
                $label = $key ? ucfirst($key) : Str::squish($data['label']);
                if ($label === '') {
                    throw ValidationException::withMessages(['label' => 'Enter a condition name.']);
                }
                $normalized = Str::lower($label);
                $existing = $token->conditions()->where('normalized_label', $normalized)->first();
                if (! $existing) {
                    abort_if($token->conditions()->count() >= 30, 422, 'A token can have up to 30 conditions.');
                    $token->conditions()->create(['key' => $key, 'label' => $label, 'normalized_label' => $normalized, 'visibility' => $data['visibility'], 'created_by' => $user->id]);
                }
            } else {
                $condition = $token->conditions()->findOrFail($data['conditionId']);
                if ($command === 'condition-remove') {
                    $condition->delete();
                } else {
                    $condition->update(['visibility' => $data['visibility']]);
                }
            }

            return ['token' => $this->snapshots->token($token->refresh(), true, $user), '_wasVisible' => ! $token->is_hidden];
        }, $command === 'hp' ? 'token.hp_changed' : 'token.conditions_changed');
    }
}
