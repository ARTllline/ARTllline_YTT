<?php

namespace App\Http\Controllers;

use App\Actions\AbilityActions;
use App\Models\Campaign;
use App\Models\Scene;
use Illuminate\Http\Request;

class AbilityController extends Controller
{
    public function execute(Request $request, Scene $scene, AbilityActions $actions): array
    {
        $data = $request->validate(self::commandRules());

        return self::present($actions->execute($request->user(), $scene, $data));
    }

    public static function commandRules(): array
    {
        return [
            'clientMutationId' => 'required|uuid', 'characterId' => 'required|integer|min:1',
            'abilityId' => 'required|uuid', 'epoch' => 'required|integer|min:0',
            'rollMode' => 'required|in:normal,advantage,disadvantage',
            'target' => 'present|nullable|array:kind,id,x,y', 'target.kind' => 'required_with:target|in:token,prop,point',
            'target.id' => 'sometimes|integer|min:1', 'target.x' => 'sometimes|numeric', 'target.y' => 'sometimes|numeric',
        ];
    }

    public static function present(array $response): array
    {
        if (! $response['execution']['dcVisible'] && isset($response['execution']['roll'])) {
            unset($response['execution']['roll']['dc']);
        }
        unset($response['execution']['dcVisible']);

        return $response;
    }

    public function resource(Request $request, Campaign $campaign, AbilityActions $actions): array
    {
        return $actions->resource($request->user(), $campaign, $request->validate([
            'clientMutationId' => 'required|uuid', 'characterId' => 'required|integer|min:1',
            'key' => 'required|string|max:48', 'delta' => 'required|integer|between:-9999,9999',
        ]));
    }
}
