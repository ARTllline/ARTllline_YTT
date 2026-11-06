<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\Scene;
use App\Models\Token;
use App\Services\LineOfSight;
use App\Services\StructuralGeometry;
use App\Services\VisibilityPolygon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class LineOfSightController extends Controller
{
    /** GM diagnostic adapter; future player adapters must return their own safe projection. */
    public function __invoke(Request $request, Scene $scene): array
    {
        Gate::authorize('update', $scene);
        $rules = ['observer' => 'required|array:point,tokenId',
            'targets' => 'required|array|list|min:1|max:64',
            'targets.*' => 'required|array:point,tokenId', 'range' => 'nullable|numeric|between:0,40000'];
        foreach (['observer', 'targets.*'] as $path) {
            $rules += ["$path.point" => "required_without:$path.tokenId|prohibits:$path.tokenId|array:x,y",
                "$path.point.x" => "required_with:$path.point|numeric|between:0,{$scene->width}",
                "$path.point.y" => "required_with:$path.point|numeric|between:0,{$scene->height}",
                "$path.tokenId" => "required_without:$path.point|integer|min:1"];
        }
        $data = $request->validate($rules);

        return DB::transaction(function () use ($scene, $data) {
            // Same lock order as writers: one coherent geometry/token revision per batch.
            $campaign = Campaign::whereKey($scene->campaign_id)->sharedLock()->firstOrFail();
            $scene = Scene::whereKey($scene->id)->sharedLock()->firstOrFail();
            $scene->setRelation('campaign', $campaign);
            Gate::authorize('update', $scene);
            $ids = array_filter(array_column([$data['observer'], ...$data['targets']], 'tokenId'));
            $tokens = $scene->tokens()->whereIn('id', $ids)->get()->keyBy('id');
            // Do not resolve token IDs through a global lookup.
            abort_unless(count(array_unique($ids)) === $tokens->count(), 422, 'Некорректный LOS-запрос.');
            $los = LineOfSight::forScene($scene);
            $observer = $data['observer'];
            $source = isset($observer['tokenId']) ? $tokens[$observer['tokenId']] : null;
            $origin = $source ? ['x' => (float) $source->x, 'y' => (float) $source->y] : $observer['point'];
            $range = isset($data['range']) ? (float) $data['range'] : null;
            $results = [];
            foreach ($data['targets'] as $target) {
                if (isset($target['tokenId'])) {
                    // Token sampling also works for an explicit point observer.
                    $source ??= new Token($origin);
                    $results[] = ['tokenId' => (string) $target['tokenId']]
                        + $los->token($source, $tokens[$target['tokenId']], $range, true);
                } else {
                    $results[] = ['point' => $target['point']] + $los->point($origin, $target['point'], $range, true);
                }
            }

            return ['schemaVersion' => 1, 'sceneId' => (string) $scene->id, 'revision' => $scene->revision,
                'geometryKey' => $los->geometryKey, 'policy' => LineOfSight::POLICY,
                'polygon' => (new VisibilityPolygon(StructuralGeometry::forScene($scene)))->build($origin, $range ?? hypot($scene->width, $scene->height), $scene->width, $scene->height),
                'observer' => $origin, 'range' => $range, 'results' => $results];
        });
    }
}
