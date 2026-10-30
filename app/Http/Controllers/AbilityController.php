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
            'clientMutationId' => 'required|uuid', 'characterId' => 'required_without:actorTokenId|nullable|integer|min:1', 'actorTokenId' => 'required_without:characterId|nullable|integer|min:1',
            'abilityId' => 'required|uuid', 'epoch' => 'required|integer|min:0',
            'rollMode' => 'required|in:normal,advantage,disadvantage', 'castLevel' => 'sometimes|integer|between:0,9', 'effectChoice' => 'sometimes|string|max:48', 'manualComplete' => 'sometimes|boolean',
            'target' => 'present|nullable|array:kind,id,x,y', 'target.kind' => 'required_with:target|in:token,prop,point',
            'target.id' => 'sometimes|integer|min:1', 'target.x' => 'sometimes|numeric', 'target.y' => 'sometimes|numeric',
        ];
    }

    public static function present(array $response): array
    {
        $scene = request()->route('scene');
        if ($scene instanceof Scene && $scene->campaign->roleFor(request()->user()) === 'gm') {
            unset($response['execution']['dcVisible']);

            return $response;
        }
        unset($response['execution']['gmContext'], $response['execution']['resolution']);
        foreach ($response['execution']['outcomes'] ?? [] as $i => $outcome) {
            unset($response['execution']['outcomes'][$i]['damageDetail'],$response['execution']['outcomes'][$i]['conditionsApplied'], $response['execution']['outcomes'][$i]['hpBefore'], $response['execution']['outcomes'][$i]['hpAfter']);
            if (isset($outcome['save'])) {
                $response['execution']['outcomes'][$i]['save'] = array_intersect_key($outcome['save'], array_flip(['success', 'rollMode', 'automaticFailure']));
            }
        }
        if (isset($response['execution']['roll']['context'])) {
            foreach (['advantage', 'disadvantage', 'automaticFailure'] as $kind) {
                $response['execution']['roll']['context'][$kind] = array_map(fn ($r) => ($r['visibility'] ?? 'public') === 'gm_only' ? ['label' => 'Модификатор ГМ'] : $r, $response['execution']['roll']['context'][$kind] ?? []);
            }
        }
        if (! ($response['execution']['dcVisible'] ?? false) && isset($response['execution']['roll'])) {
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
