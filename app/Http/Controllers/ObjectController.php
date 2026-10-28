<?php

namespace App\Http\Controllers;

use App\Actions\PropActions;
use App\Actions\SelectionActions;
use App\Actions\TemplateActions;
use App\Models\Scene;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class ObjectController extends Controller
{
    public static function selectionRules(): array
    {
        return ['tokenIds' => 'present|array|max:200', 'tokenIds.*' => 'integer|distinct',
            'propIds' => 'present|array|max:200', 'propIds.*' => 'integer|distinct'];
    }

    public function prop(Request $request, Scene $scene, PropActions $actions): array
    {
        Gate::authorize('update', $scene);
        $data = $request->validate(['action' => 'required|in:create,update', 'id' => 'required_if:action,update|integer',
            'assetId' => 'required_if:action,create|integer', 'x' => 'required_if:action,create|numeric|between:-1000000,1000000',
            'y' => 'required_if:action,create|numeric|between:-1000000,1000000', 'order' => 'sometimes|in:front,back,forward,backward',
            'patch' => 'sometimes|array:name,x,y,rotation,scale_x,scale_y,is_hidden,is_locked',
            'patch.name' => 'sometimes|nullable|string|max:160', 'patch.x' => 'sometimes|numeric|between:-1000000,1000000',
            'patch.y' => 'sometimes|numeric|between:-1000000,1000000', 'patch.rotation' => 'sometimes|numeric|between:-360,360',
            'patch.scale_x' => 'sometimes|numeric|between:0.001,100', 'patch.scale_y' => 'sometimes|numeric|between:0.001,100',
            'patch.is_hidden' => 'sometimes|boolean', 'patch.is_locked' => 'sometimes|boolean']);

        return $actions->execute($request->user(), $scene, $data);
    }

    public function selection(Request $request, Scene $scene, SelectionActions $actions): array
    {
        Gate::authorize('update', $scene);
        $data = $request->validate(self::selectionRules() + ['action' => 'required|in:move,duplicate,delete',
            'anchorKind' => 'required_if:action,move|in:token,prop', 'anchorId' => 'required_if:action,move|integer',
            'x' => 'required_if:action,move|numeric|between:-1000000,1000000', 'y' => 'required_if:action,move|numeric|between:-1000000,1000000']);

        return $actions->execute($request->user(), $scene, $data);
    }

    public function spawn(Request $request, Scene $scene, TemplateActions $actions): array
    {
        Gate::authorize('update', $scene);

        return $actions->spawn($request->user(), $scene, $request->validate(['templateId' => 'required|integer',
            'x' => 'required|numeric|between:-1000000,1000000', 'y' => 'required|numeric|between:-1000000,1000000']));
    }
}
