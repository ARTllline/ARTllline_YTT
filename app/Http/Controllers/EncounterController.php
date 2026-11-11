<?php

namespace App\Http\Controllers;

use App\Actions\EncounterActions;
use App\Actions\EncounterCombatActions;
use App\Models\Scene;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class EncounterController extends Controller
{
    public function combat(Request $request, Scene $scene, EncounterCombatActions $actions): array
    {
        Gate::authorize('update', $scene);

        return $actions->execute($request->user(), $scene, $request->all());
    }

    public function __invoke(Request $request, Scene $scene, EncounterActions $actions): array
    {
        Gate::authorize('update', $scene);

        return $actions->execute($request->user(), $scene, $request->all());
    }
}
