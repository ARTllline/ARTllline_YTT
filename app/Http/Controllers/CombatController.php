<?php

namespace App\Http\Controllers;

use App\Actions\CombatActions;
use App\Actions\TokenCombatActions;
use App\Combat\AppliedConditions;
use App\Models\Combat;
use App\Models\Scene;
use App\Models\Token;
use App\Services\CharacterCatalog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class CombatController extends Controller
{
    public function history(Scene $scene): array
    {
        Gate::authorize('update', $scene);

        $combatId = Combat::where('scene_id', $scene->id)->latest('id')->value('id');

        return ['events' => DB::table('combat_events')->where('combat_id', $combatId)->orderByDesc('id')->limit(100)->get()->map(fn ($e) => ['id' => (string) $e->id, 'type' => $e->type, 'data' => json_decode($e->data, true), 'createdAt' => $e->created_at])->all()];
    }

    public function combat(Request $request, Scene $scene, CombatActions $actions): array
    {
        Gate::authorize('update', $scene);
        $command = $request->route()->defaults['command'];
        $rules = $command === 'prepare' ? [] : ['combatId' => 'required|string'];
        $rules += match ($command) {
            'add' => ['tokenIds' => 'required|array|min:1|max:200', 'tokenIds.*' => 'required|string|distinct'],
            'remove', 'current' => ['combatantId' => 'required|string'],
            'override' => ['combatantId' => 'required|integer', 'action_available' => 'sometimes|boolean', 'bonus_available' => 'sometimes|boolean', 'reaction_available' => 'sometimes|boolean', 'movement_spent' => 'sometimes|numeric|between:0,1000000'],
            'initiative' => ['combatantId' => 'required|string', 'initiative' => 'present|nullable|numeric|between:-9999,9999|decimal:0,2'],
            'reorder' => ['combatantIds' => 'present|array|max:200', 'combatantIds.*' => 'required|string|distinct'],
            'next', 'previous' => ['expectedRound' => 'required|integer|min:1', 'expectedCurrentCombatantId' => 'present|nullable|string'],
            default => [],
        };

        return $actions->execute($request->user(), $scene, $command, $request->validate($rules));
    }

    public function token(Request $request, Token $token, TokenCombatActions $actions): array
    {
        $command = $request->route()->defaults['command'];
        if ($command === 'stand-up') {
            Gate::authorize('move', $token);
        } else {
            Gate::authorize('update', $token);
        }
        $rules = match ($command) {
            'hp-set' => ['value' => 'required|integer|between:0,9999'],
            'hp' => ['delta' => 'required|integer|between:-9999,9999'],
            'stand-up' => [],
            'condition-add' => ['key' => ['nullable', Rule::in([...array_keys(app(CharacterCatalog::class)->entries('conditions')), 'concentrating'])], 'label' => 'required_without:key|nullable|string|max:40', 'visibility' => 'required|in:public,gm_only', 'duration_mode' => ['sometimes', Rule::in(AppliedConditions::DURATIONS)], 'rounds' => 'sometimes|integer|between:1,100', 'source_token_id' => 'sometimes|nullable|integer'],
            'condition-remove' => ['conditionId' => 'required|string'],
            default => ['conditionId' => 'required|string', 'visibility' => 'required|in:public,gm_only'],
        };

        return $actions->execute($request->user(), $token, $command, $request->validate($rules));
    }
}
