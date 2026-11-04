<?php

namespace App\Http\Controllers;

use App\Actions\StructureActions;
use App\Models\Scene;
use Illuminate\Http\Request;

class StructureController extends Controller
{
    public function store(Request $request, Scene $scene, StructureActions $actions): array
    {
        return $actions->execute($request->user(), $scene, $request->all());
    }
}
