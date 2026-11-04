<?php

namespace App\Http\Controllers;

use App\Actions\MapWorldActions;
use App\Models\Scene;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class MapWorldController extends Controller
{
    public function __invoke(Request $request, Scene $scene, MapWorldActions $actions): array
    {
        Gate::authorize('update', $scene);
        $data = $request->validate(['value' => 'required|array', 'expected' => 'required|array']);

        return $actions->execute($request->user(), $scene, $data['value'], $data['expected']);
    }
}
