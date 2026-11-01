<?php

namespace App\Http\Controllers;

use App\Actions\StoreAudio;
use App\Actions\StoreImage;
use App\Models\Asset;
use App\Services\AssetLibrary;
use App\Services\AssetThumbnail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class GlobalAssetController extends Controller
{
    public const CATEGORIES = 'portraits,tokens,maps,props,handouts,art,audio';

    public function index(Request $r, AssetLibrary $library): array
    {
        $data = $r->validate(['search' => 'nullable|string|max:120', 'category' => 'nullable|in:'.self::CATEGORIES, 'images' => 'nullable|boolean', 'page' => 'nullable|integer|min:1']);
        $query = Asset::available()->with(['tags', 'collections']);
        if ($data['images'] ?? false) {
            $query->whereNull('duration_ms');
        }
        if ($category = $data['category'] ?? null) {
            $kinds = ['portraits' => 'token', 'tokens' => 'token', 'maps' => 'map', 'props' => 'prop', 'handouts' => 'handout', 'art' => 'prop'];
            $query->where(fn ($q) => $q->where('category', $category)->when(! in_array($category, ['portraits', 'art']), fn ($q) => $q->orWhere(fn ($q) => $q->whereNull('category')->whereIn('kind', $category === 'audio' ? ['music', 'ambient', 'sfx'] : [$kinds[$category]]))));
        }
        if ($search = $data['search'] ?? '') {
            $search = '%'.addcslashes($search, '%_\\').'%';
            $query->where(fn ($q) => $q->where('name', 'like', $search)->orWhereHas('tags', fn ($q) => $q->where('name', 'like', $search)));
        }
        $page = $query->latest('id')->paginate(40);

        return ['assets' => $page->getCollection()->map(fn ($a) => $library->projection($a)), 'pages' => $page->lastPage(), 'total' => $page->total()];
    }

    public function store(Request $r, AssetLibrary $library): array
    {
        $data = $r->validate(['category' => 'required|in:'.self::CATEGORIES, 'kind' => 'nullable|in:music,ambient,sfx', 'file' => 'required|file|max:65536']);
        $kind = match ($data['category']) {
            'maps' => 'map', 'portraits', 'tokens' => 'token', 'handouts' => 'handout', 'audio' => $data['kind'] ?? 'music', default => 'prop'
        };
        $asset = app($data['category'] === 'audio' ? StoreAudio::class : StoreImage::class)->execute($r->user(), null, $r->file('file'), $kind);
        $asset->update(['category' => $data['category']]);

        return $library->projection($asset);
    }

    public function duplicate(Asset $asset, AssetLibrary $library): array
    {
        $library->authorizeEdit($asset);
        $path = 'library/'.auth()->id().'/'.$asset->kind.'/'.Str::uuid().'.'.pathinfo($asset->storage_path, PATHINFO_EXTENSION);
        abort_unless(Storage::disk('campaigns')->copy($asset->storage_path, $path), 500);
        try {
            return DB::transaction(function () use ($asset, $path, $library) {
                $copy = $asset->replicate();
                $copy->fill(['campaign_id' => null, 'library_user_id' => auth()->id(), 'uploaded_by' => auth()->id(), 'storage_path' => $path, 'delivery_key' => null, 'name' => mb_substr($asset->name, 0, 240).' · копия'])->save();
                $copy->tags()->sync($asset->tags()->pluck('asset_tags.id'));

                return $library->projection($copy);
            });
        } catch (\Throwable $e) {
            Storage::disk('campaigns')->delete($path);
            throw $e;
        }
    }

    public function replace(Request $r, Asset $asset, AssetLibrary $library): array
    {
        $library->authorizeEdit($asset);
        $r->validate(['file' => 'required|file|max:65536']);
        $new = app($asset->duration_ms === null ? StoreImage::class : StoreAudio::class)->execute($r->user(), null, $r->file('file'), $asset->kind);
        try {
            return DB::transaction(function () use ($asset, $new, $library) {
                $asset = Asset::whereKey($asset->id)->lockForUpdate()->firstOrFail();
                $paths = [$asset->storage_path, app(AssetThumbnail::class)->path($asset), $asset->storage_path.'.thumb.lock'];
                $new->delete();
                $asset->fill($new->only(['storage_path', 'original_name', 'mime_type', 'file_size', 'width', 'height', 'duration_ms']))->save();
                DB::afterCommit(fn () => Storage::disk('campaigns')->delete($paths));

                return $library->projection($asset);
            });
        } catch (\Throwable $e) {
            $new->delete();
            Storage::disk('campaigns')->delete($new->storage_path);
            throw $e;
        }
    }
}
