<?php

namespace App\Http\Controllers;

use App\Actions\TokenActions;
use App\Models\Scene;
use App\Models\Token;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class TokenController extends Controller
{
    private const POSITION = ['x' => 'required|numeric|between:-1000000,1000000', 'y' => 'required|numeric|between:-1000000,1000000'];

    public function store(Request $request, Scene $scene, TokenActions $actions): array
    {
        Gate::authorize('update', $scene);

        return $actions->create($request->user(), $scene, $request->validate(self::POSITION + ['name' => 'required|string|max:80', 'token_image_asset_id' => 'sometimes|integer|min:1', 'kind' => 'sometimes|in:player_character,npc', 'disposition' => 'sometimes|in:friendly,neutral,hostile', 'hp' => 'sometimes|integer|between:0,9999', 'max_hp' => 'sometimes|integer|between:1,9999']));
    }

    public function move(Request $request, Token $token, TokenActions $actions): array
    {
        Gate::authorize('move', $token);

        return $actions->update($request->user(), $token, $request->validate(self::POSITION), true);
    }

    public function update(Request $request, Token $token, TokenActions $actions): array
    {
        Gate::authorize('update', $token);

        return $actions->update($request->user(), $token, $request->validate([
            'kind' => 'sometimes|in:player_character,npc', 'disposition' => 'sometimes|in:friendly,neutral,hostile',
            'name' => 'sometimes|required|string|max:80', 'x' => 'sometimes|numeric|between:-1000000,1000000', 'y' => 'sometimes|numeric|between:-1000000,1000000',
            'rotation' => 'sometimes|numeric|between:0,359.999', 'scale' => 'sometimes|numeric|between:0.4,3', 'size' => 'sometimes|numeric|between:20,300',
            'hp' => 'sometimes|integer|between:0,9999', 'max_hp' => 'sometimes|integer|between:1,9999',
            'ac' => 'sometimes|nullable|integer|between:0,99', 'speed' => 'sometimes|nullable|integer|between:0,999',
            'is_hidden' => 'sometimes|boolean', 'is_locked' => 'sometimes|boolean',
            'owner_user_id' => 'sometimes|nullable|integer|min:1', 'token_image_asset_id' => 'sometimes|nullable|integer|min:1',
        ]));
    }

    public function destroy(Request $request, Token $token, TokenActions $actions): array
    {
        return $actions->delete($request->user(), $token);
    }
}
