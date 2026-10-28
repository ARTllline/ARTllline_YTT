<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\Scene;
use Illuminate\Support\Facades\Gate;
use Illuminate\View\View;

class WorkspaceController extends Controller
{
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
