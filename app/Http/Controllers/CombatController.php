<?php

namespace App\Http\Controllers;

use App\Actions\CombatActions;
use App\Actions\TokenCombatActions;
use App\Models\Scene;
use App\Models\Token;
use App\Models\TokenCondition;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class CombatController extends Controller
{
    public function combat(Request $request, Scene $scene, CombatActions $actions): array
    {
        Gate::authorize('update', $scene);
        $command = $request->route()->defaults['command'];
        $rules = $command === 'prepare' ? [] : ['combatId' => 'required|string'];
        $rules += match ($command) {
            'add' => ['tokenIds' => 'required|array|min:1|max:200', 'tokenIds.*' => 'required|string|distinct'],
            'remove', 'current' => ['combatantId' => 'required|string'],
            'initiative' => ['combatantId' => 'required|string', 'initiative' => 'present|nullable|numeric|between:-9999,9999|decimal:0,2'],
            'reorder' => ['combatantIds' => 'present|array|max:200', 'combatantIds.*' => 'required|string|distinct'],
            'next', 'previous' => ['expectedRound' => 'required|integer|min:1', 'expectedCurrentCombatantId' => 'present|nullable|string'],
            default => [],
        };

        return $actions->execute($request->user(), $scene, $command, $request->validate($rules));
    }

    public function token(Request $request, Token $token, TokenCombatActions $actions): array
    {
        Gate::authorize('update', $token);
        $command = $request->route()->defaults['command'];
        $rules = match ($command) {
            'hp' => ['delta' => 'required|integer|between:-9999,9999'],
            'condition-add' => ['key' => ['nullable', Rule::in(TokenCondition::PRESETS)], 'label' => 'required_without:key|nullable|string|max:40', 'visibility' => 'required|in:public,gm_only'],
            'condition-remove' => ['conditionId' => 'required|string'],
            default => ['conditionId' => 'required|string', 'visibility' => 'required|in:public,gm_only'],
        };

        return $actions->execute($request->user(), $token, $command, $request->validate($rules));
    }
}
