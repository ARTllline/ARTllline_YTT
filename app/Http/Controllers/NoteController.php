<?php

namespace App\Http\Controllers;

use App\Actions\NoteActions;
use App\Models\Scene;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class NoteController extends Controller
{
    public function __invoke(Request $request, Scene $scene, NoteActions $actions): array
    {
        Gate::authorize('update', $scene);
        $data = $request->validate([
            'action' => 'required|in:create,update,delete', 'id' => 'required_unless:action,create|integer',
            'x' => 'required_if:action,create|numeric|between:-1000000,1000000', 'y' => 'required_if:action,create|numeric|between:-1000000,1000000',
            'title' => 'sometimes|required|string|max:160', 'body' => 'sometimes|nullable|string|max:20000', 'icon' => 'sometimes|in:note,warning,secret,encounter,clue',
        ]);
        if (array_key_exists('body', $data)) {
            $data['body'] ??= '';
        }

        return $actions->execute($request->user(), $scene, $data);
    }
}
