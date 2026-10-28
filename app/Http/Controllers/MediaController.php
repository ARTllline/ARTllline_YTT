<?php

namespace App\Http\Controllers;

use App\Actions\MediaActions;
use App\Models\Campaign;
use App\Services\LiveMedia;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class MediaController extends Controller
{
    public function show(Request $request, Campaign $campaign, LiveMedia $media): array
    {
        return DB::transaction(function () use ($request, $campaign, $media) {
            $campaign = Campaign::whereKey($campaign->id)->sharedLock()->firstOrFail();
            abort_unless($campaign->roleFor($request->user()), 403);

            return $media->read($campaign);
        });
    }

    public function command(Request $request, Campaign $campaign, MediaActions $actions): array
    {
        Gate::authorize('update', $campaign);
        $request->validate(['action' => 'required|string|max:40']);

        return $actions->execute($request->user(), $campaign, $request->string('action')->toString(), $request->all());
    }
}
