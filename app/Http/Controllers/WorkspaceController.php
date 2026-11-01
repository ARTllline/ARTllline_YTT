<?php

namespace App\Http\Controllers;

use App\Actions\CharacterLibrary;
use App\Actions\NpcLibrary;
use App\Models\Campaign;
use App\Models\Scene;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\View\View;

class WorkspaceController extends Controller
{
    public function control(Campaign $campaign, ?string $section = null, ?string $characterId = null): View|RedirectResponse
    {
        Gate::authorize('update', $campaign);
        if ($characterId && $characterId !== 'new') {
            $campaign->characters()->findOrFail($characterId);
        }

        return redirect('/control/characters'.($characterId ? '/'.$characterId : '').'?campaign='.$campaign->id);
    }

    public function library(Request $request, ?string $section = null, ?string $characterId = null): View
    {
        if ($characterId && $characterId !== 'new') {
            if ($section === 'npcs') {
                app(NpcLibrary::class)->find($request->user(), (int) $characterId);
            } else {
                app(CharacterLibrary::class)->find($request->user(), (int) $characterId);
            }
        }

        return view('workspace');
    }

    public function play(Campaign $campaign): View
    {
        Gate::authorize('view', $campaign);

        return view('workspace');
    }

    public function campaign(Campaign $campaign): View
    {
        Gate::authorize('update', $campaign);

        return view('workspace');
    }

    public function scene(Campaign $campaign, Scene $scene): View
    {
        Gate::authorize('update', $campaign);
        abort_unless($scene->campaign_id === $campaign->id, 404);

        return view('workspace');
    }
}
