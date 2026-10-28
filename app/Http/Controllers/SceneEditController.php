<?php

namespace App\Http\Controllers;

use App\Actions\SceneEditHistory;
use App\Models\Scene;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class SceneEditController extends Controller
{
    public function __invoke(Request $request, Scene $scene, SceneEditHistory $history): array
    {
        Gate::authorize('update', $scene);

        return $history->execute($request->user(), $scene, $request->only('changes'));
    }
}
