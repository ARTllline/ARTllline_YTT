<?php

namespace App\Http\Controllers;

use App\Actions\StoreImage;
use App\Models\Asset;
use App\Models\Campaign;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AssetController extends Controller
{
    public function store(Request $request, Campaign $campaign, StoreImage $action, SceneSnapshotBuilder $builder): array
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate(['kind' => 'required|in:map,token', 'file' => 'required|file|max:16384']);

        return $builder->asset($action->execute($request->user(), $campaign, $request->file('file'), $data['kind']));
    }

    public function show(Asset $asset): StreamedResponse
    {
        Gate::authorize('view', $asset);
        abort_unless(Storage::disk('campaigns')->exists($asset->storage_path), 404);

        return Storage::disk('campaigns')->response($asset->storage_path, 'image-'.$asset->id, [
            'Content-Type' => $asset->mime_type, 'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff', 'Vary' => 'Cookie',
        ]);
    }
}
