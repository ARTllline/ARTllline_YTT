<?php

namespace App\Http\Controllers;

use App\Actions\SceneTransaction;
use App\Models\Scene;
use App\Services\SceneLighting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class LightingController extends Controller
{
    public function show(Request $request, Scene $scene, SceneLighting $lighting): array
    {
        Gate::authorize('view', $scene);

        // Consistent read, no FOR UPDATE or writes, no Fog recording.
        return DB::transaction(function () use ($scene, $request, $lighting) {
            $current = $scene->fresh();
            Gate::authorize('view', $current);

            return $lighting->render($current, $request->user());
        });
    }

    public function update(Request $request, Scene $scene, SceneTransaction $transaction): array
    {
        Gate::authorize('update', $scene);
        $data = $request->validate([
            'value' => 'required|array:enabled,mode,brightness,color,sources',
            'value.enabled' => 'required|boolean', 'value.mode' => 'required|in:day,night',
            'value.brightness' => 'required|numeric|between:0,1', 'value.color' => 'required|regex:/^#[0-9a-fA-F]{6}$/',
            'value.sources' => 'present|array|max:16', 'value.sources.*' => 'array:id,name,enabled,x,y,tokenId,radius,color,intensity,falloff',
            'value.sources.*.id' => 'required|string|max:64|distinct|regex:/^[a-zA-Z0-9_-]+$/',
            'value.sources.*.name' => 'required|string|max:80', 'value.sources.*.enabled' => 'required|boolean',
            'value.sources.*.x' => 'required|numeric|between:0,'.$scene->width, 'value.sources.*.y' => 'required|numeric|between:0,'.$scene->height,
            'value.sources.*.tokenId' => 'nullable|integer|min:1', 'value.sources.*.radius' => 'required|numeric|between:2,40000',
            'value.sources.*.color' => 'required|regex:/^#[0-9a-fA-F]{6}$/',
            'value.sources.*.intensity' => 'required|numeric|between:0,3', 'value.sources.*.falloff' => 'required|numeric|between:0.25,4',
            'expected' => 'required|array',
        ]);

        return $transaction->run($scene, function ($locked) use ($data) {
            Gate::authorize('update', $locked);
            abort_unless($data['expected'] == SceneLighting::settings($locked, true), 409, 'Свет изменён в другом окне. Обновите настройки.');
            $value = $data['value'];
            foreach ($value['sources'] as &$source) {
                if ($source['x'] > $locked->width || $source['y'] > $locked->height) {
                    throw ValidationException::withMessages(['value.sources' => 'Размер карты изменился. Источник выходит за её границы.']);
                }
                if (isset($source['tokenId'])) {
                    if (! $locked->tokens()->whereKey($source['tokenId'])->exists()) {
                        throw ValidationException::withMessages(['value.sources' => 'Источник привязан к токену другой сцены.']);
                    }
                    $source['tokenId'] = (string) $source['tokenId'];
                }
                foreach (['x', 'y', 'radius', 'intensity', 'falloff'] as $field) {
                    $source[$field] = (float) $source[$field];
                }
            }
            unset($source);
            $value['brightness'] = (float) $value['brightness'];
            $locked->update(['lighting' => $value]);

            return ['lighting' => $value, 'movementGeometryChanged' => false];
        }, 'lighting.updated');
    }
}
