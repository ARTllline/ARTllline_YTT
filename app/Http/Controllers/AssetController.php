<?php

namespace App\Http\Controllers;

use App\Actions\HandoutActions;
use App\Actions\StoreAudio;
use App\Actions\StoreImage;
use App\Models\Asset;
use App\Models\AssetCollection;
use App\Models\AssetTag;
use App\Models\Campaign;
use App\Models\Handout;
use App\Services\AssetLibrary;
use App\Services\AssetThumbnail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AssetController extends Controller
{
    public function index(Request $request, Campaign $campaign, AssetLibrary $library): array
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate(['kind' => 'nullable|in:map,token,handout,prop,music,ambient,sfx', 'search' => 'nullable|string|max:120', 'tag' => 'nullable|integer', 'collection' => 'nullable|integer', 'sort' => 'nullable|in:newest,name', 'page' => 'nullable|integer|min:1']);
        $query = Asset::where('campaign_id', $campaign->id)->with(['tags', 'collections']);
        if (! empty($data['kind'])) {
            $query->where('kind', $data['kind']);
        }
        if (! empty($data['search'])) {
            $search = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $data['search']).'%';
            $query->where(fn ($q) => $q->where('name', 'like', $search)->orWhere('original_name', 'like', $search)->orWhereHas('tags', fn ($t) => $t->where('name', 'like', $search)));
        }
        foreach (['tag' => 'tags', 'collection' => 'collections'] as $key => $relation) {
            if (! empty($data[$key])) {
                $query->whereHas($relation, fn ($q) => $q->whereKey($data[$key])->where('campaign_id', $campaign->id));
            }
        }
        if (($data['sort'] ?? '') === 'name') {
            $query->orderBy('name');
        }
        $page = $query->orderByDesc('id')->paginate(40);

        return ['assets' => $page->getCollection()->map(fn ($a) => $library->projection($a))->all(),
            'page' => $page->currentPage(), 'pages' => $page->lastPage(), 'total' => $page->total(),
            'tags' => AssetTag::where('campaign_id', $campaign->id)->orderBy('name')->get()->map(fn ($t) => $library->label($t))->all(),
            'collections' => AssetCollection::where('campaign_id', $campaign->id)->orderBy('sort_order')->orderBy('name')->get()->map(fn ($t) => $library->label($t))->all()];
    }

    public function detail(Asset $asset, AssetLibrary $library): array
    {
        Gate::authorize('update', $asset->campaign);
        $handout = Handout::where('asset_id', $asset->id)->where('campaign_id', $asset->campaign_id)->first();

        return $library->projection($asset->load(['tags', 'collections'])) + ['usage' => $library->usage($asset), 'handout' => $handout ? app(HandoutActions::class)->projection($handout) : null];
    }

    public function update(Request $request, Asset $asset, AssetLibrary $library): array
    {
        Gate::authorize('update', $asset->campaign);

        return $library->update($asset, $request->validate(['name' => 'sometimes|required|string|max:255',
            'tags' => 'sometimes|array|max:30', 'tags.*' => 'required|string|max:80',
            'collections' => 'sometimes|array|max:20', 'collections.*' => 'required|string|max:80']));
    }

    public function destroy(Asset $asset, AssetLibrary $library): array
    {
        return $library->delete($asset);
    }

    public function store(Request $request, Campaign $campaign, StoreImage $action): array
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate(['kind' => 'required|in:map,token,handout,prop,music,ambient,sfx', 'file' => 'required|file|max:65536']);
        if (in_array($data['kind'], ['music', 'ambient', 'sfx'])) {
            $action = app(StoreAudio::class);
        }

        return app(AssetLibrary::class)->projection($action->execute($request->user(), $campaign, $request->file('file'), $data['kind']));
    }

    public function thumbnail(Asset $asset, AssetThumbnail $thumbnail): StreamedResponse
    {
        Gate::authorize('view', $asset);
        abort_if($asset->duration_ms !== null, 404);

        return Storage::disk('campaigns')->response($thumbnail->ensure($asset), 'thumbnail-'.$asset->id.'.webp', [
            'Content-Type' => 'image/webp', 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff', 'Vary' => 'Cookie']);
    }

    public function show(Asset $asset): StreamedResponse|BinaryFileResponse
    {
        Gate::authorize('view', $asset);
        abort_unless(Storage::disk('campaigns')->exists($asset->storage_path), 404);
        if ($asset->duration_ms !== null) {
            // BinaryFileResponse handles Range/206 and seeking without buffering the file in PHP.
            return response()->file(Storage::disk('campaigns')->path($asset->storage_path), [
                'Content-Type' => $asset->mime_type, 'Cache-Control' => 'private, no-store',
                'X-Content-Type-Options' => 'nosniff', 'Vary' => 'Cookie', 'Content-Disposition' => 'inline',
            ]);
        }

        return Storage::disk('campaigns')->response($asset->storage_path, 'image-'.$asset->id, [
            'Content-Type' => $asset->mime_type, 'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff', 'Vary' => 'Cookie',
        ]);
    }
}
