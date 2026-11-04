<?php

namespace App\Http\Controllers;

use App\Actions\TerrainActions;
use App\Models\Scene;
use App\Services\TerrainData;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class TerrainController extends Controller
{
    public function store(Request $request, Scene $scene, TerrainActions $actions): array
    {
        Gate::authorize('update', $scene);

        return $actions->execute($request->user(), $scene, $request->all());
    }

    public function show(Request $request, Scene $scene, int $x, int $y, TerrainData $data)
    {
        Gate::authorize('view', $scene);
        abort_unless($x >= 0 && $y >= 0 && $x < 79 && $y < 79, 404);
        $layers = $data->read($scene, $x.':'.$y);
        abort_unless($request->query('hash') === $data->hash($layers), 409);

        return response()->json(['layers' => (object) array_map(bin2hex(...), $layers)])->header('Cache-Control', 'private, no-store');
    }
}
