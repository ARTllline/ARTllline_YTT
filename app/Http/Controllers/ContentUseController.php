<?php

namespace App\Http\Controllers;

use App\Actions\ContentUseActions;
use App\Models\Scene;
use Illuminate\Http\Request;

class ContentUseController extends Controller
{
    public function __invoke(Request $request, Scene $scene, ContentUseActions $actions): array
    {
        $data = $request->validate([
            'clientMutationId' => 'required|uuid', 'characterId' => 'required|integer|min:1', 'epoch' => 'required|integer|min:0',
            'inventoryItemId' => 'nullable|required_without:abilityId|prohibits:abilityId|uuid', 'abilityId' => 'nullable|required_without:inventoryItemId|prohibits:inventoryItemId|uuid',
            'rollMode' => 'sometimes|in:normal,advantage,disadvantage',
            'targetId' => 'nullable|integer|min:1', 'castLevel' => 'sometimes|integer|between:0,9',
        ]);

        return $actions->request($request->user(), $scene, $data);
    }
}
