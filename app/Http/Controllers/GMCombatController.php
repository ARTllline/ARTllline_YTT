<?php

namespace App\Http\Controllers;

use App\Actions\SceneTransaction;
use App\Combat\GMCorrections;
use App\Combat\GMResolutions;
use App\Combat\GMSessionChecks;
use App\Models\Scene;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class GMCombatController extends Controller
{
    public function index(Scene $scene): array
    {
        Gate::authorize('update', $scene);

        return ['pending' => app(GMResolutions::class)->pending($scene), 'undoId' => ($event = app(GMCorrections::class)->available($scene)) ? (string) $event->id : null];
    }

    public function command(Request $request, Scene $scene): array
    {
        Gate::authorize('update', $scene);
        $d = $request->validate(['action' => 'required|in:resolve,undo,check', 'executionId' => 'required_if:action,resolve|uuid',
            'status' => 'required_if:action,resolve|in:resolved,dismissed', 'note' => 'nullable|string|max:2000', 'correctionId' => 'required_if:action,undo|integer|min:1',
            'tokenIds' => 'required_if:action,check|array|min:1|max:40', 'tokenIds.*' => 'required|integer|min:1|distinct',
            'stat' => 'required_if:action,check|string|max:48|regex:/^[a-z][a-z0-9_]*$/', 'dc' => 'nullable|integer|between:0,100',
            'rollMode' => 'sometimes|in:normal,advantage,disadvantage', 'visibility' => 'required_if:action,check|in:gm_only,public', 'dcVisible' => 'sometimes|boolean']);

        return app(SceneTransaction::class)->run($scene, function ($locked) use ($request, $d) {
            Gate::forUser($request->user())->authorize('update', $locked);
            if ($d['action'] === 'undo') {
                return app(GMCorrections::class)->undo($request->user(), $locked, $d['correctionId']);
            }
            if ($d['action'] === 'check') {
                return app(GMSessionChecks::class)->run($locked, $d);
            }
            app(GMResolutions::class)->resolve($request->user(), $locked, $d['executionId'], $d['status'], $d['note'] ?? '');

            return [];
        }, 'combat.session');
    }
}
