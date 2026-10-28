<?php

namespace App\Http\Controllers;

use App\Models\Asset;
use App\Models\Campaign;
use App\Services\PreloadService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;

class PreloadController extends Controller
{
    public function show(Request $request, Campaign $campaign, PreloadService $service): array
    {
        return DB::transaction(function () use ($request, $campaign, $service) {
            $campaign = Campaign::whereKey($campaign->id)->sharedLock()->firstOrFail();
            $role = $campaign->roleFor($request->user());
            abort_unless($role, 403);

            return $role === 'gm' ? $service->gm($campaign) : ['manifest' => $service->manifest($campaign)];
        });
    }

    public function start(Request $request, Campaign $campaign, PreloadService $service): array
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate(['sceneId' => 'required|integer|min:1', 'includeAudio' => 'required|boolean']);

        return $service->start($request->user(), $campaign, $data['sceneId'], $data['includeAudio']);
    }

    public function acknowledge(Request $request, Campaign $campaign, PreloadService $service): array
    {
        $data = $request->validate(['batchId' => 'required|uuid', 'clientId' => 'required|uuid', 'status' => 'required|in:waiting,loading,ready,failed', 'loaded' => 'required|integer|min:0|max:128']);

        return $service->acknowledge($request->user(), $campaign, $data);
    }

    public function resource(Request $request, string $key, PreloadService $service): mixed
    {
        $asset = Asset::where('delivery_key', $key)->firstOrFail();

        return DB::transaction(function () use ($request, $asset, $service) {
            $campaign = Campaign::whereKey($asset->campaign_id)->sharedLock()->firstOrFail();
            abort_unless($campaign->roleFor($request->user()), 403);
            abort_unless(Gate::allows('view', $asset) || $service->authorized($campaign, $asset), 403);

            return response()->file(Storage::disk('campaigns')->path($asset->storage_path), [
                'Content-Type' => $asset->mime_type, 'Content-Disposition' => 'inline; filename="resource"',
                'X-Content-Type-Options' => 'nosniff', 'Vary' => 'Cookie', 'Cache-Control' => 'private, no-store',
            ]);
        });
    }
}
