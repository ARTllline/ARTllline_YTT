<?php

namespace App\Http\Controllers;

use App\Actions\FogActions;
use App\Models\Scene;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class FogController extends Controller
{
    public function store(Request $request, Scene $scene, FogActions $actions): array
    {
        Gate::authorize('update', $scene);
        $brush = $request->input('shape') === 'brush';
        $data = $request->validate([
            'operation' => 'required|in:reveal,cover', 'shape' => 'required|in:brush,rectangle',
            'geometry' => $brush ? 'required|array:points,radius' : 'required|array:points',
            'geometry.points' => $brush ? 'required|array|min:1|max:512' : 'required|array|size:2',
            'geometry.points.*' => 'required|array:x,y',
            'geometry.points.*.x' => 'required|numeric|between:-20000,40000',
            'geometry.points.*.y' => 'required|numeric|between:-20000,40000',
            'geometry.radius' => $brush ? 'required|numeric|between:5,600' : 'prohibited',
        ]);

        return $actions->append($request->user(), $scene, $data);
    }

    public function reset(Request $request, Scene $scene, FogActions $actions): array
    {
        Gate::authorize('update', $scene);

        return $actions->reset($request->user(), $scene, $request->validate(['base' => 'required|in:clear,covered'])['base']);
    }
}
