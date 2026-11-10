<?php

namespace App\Services;

use App\Models\Asset;
use App\Models\MapMaterial;
use App\Models\ObjectPreset;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

final class FantasyClassicPack
{
    public function install(): int
    {
        $source = resource_path('architecture/fantasy-classic');
        $pack = json_decode(File::get($source.'/manifest.json'), true, flags: JSON_THROW_ON_ERROR);
        return DB::transaction(function () use ($source, $pack) {
            foreach ($pack['materials'] as $item) {
                $key = 'fantasy-classic/'.$item['key'];
                $version = $pack['version'];
                $asset = $this->asset($source, $key, $pack, $item, 'architecture');
                $this->material($key, $version, $asset, $item);
            }

            return count($pack['materials']);
        }, 3);
    }

    public function installEnvironment(): int
    {
        $source = resource_path('environment/fantasy-classic');
        $pack = json_decode(File::get($source.'/manifest.json'), true, flags: JSON_THROW_ON_ERROR);

        return DB::transaction(function () use ($source, $pack) {
            foreach ($pack['terrain'] as $item) {
                $key = 'fantasy-classic/environment/'.$item['key'];
                $asset = $this->asset($source, $key, $pack, $item, 'terrain');
                $this->material($key, $pack['version'], $asset, $item + ['type' => 'terrain']);
            }
            foreach ($pack['objects'] as $item) {
                $key = 'fantasy-classic/environment/'.$item['key'];
                $asset = $this->asset($source, $key, $pack, $item, 'props');
                $settings = $item['settings'];
                $settings['collider'] = PropCollider::validate($settings['collider']);
                $preset = ObjectPreset::firstOrCreate(['builtin_key' => $asset->builtin_key], [
                    'asset_id' => $asset->id, 'name' => $item['name'], 'category' => $item['category'], 'settings' => $settings,
                ]);
                if ($preset->asset_id !== $asset->id || $preset->settings != $settings
                    || $preset->name !== $item['name'] || $preset->category !== $item['category']) {
                    throw new RuntimeException('Installed preset differs. Bundle updates require a new version: '.$key);
                }
            }

            return count($pack['objects']);
        }, 3);
    }

    private function asset(string $source, string $key, array $pack, array $item, string $category): Asset
    {
        $version = $pack['version'];
        $assetKey = $key.'/v'.$version;
        $filename = $item['key'].'.webp';
        $originalPath = 'builtin/'.$assetKey.'.webp';
        $revision = $item['artwork'] ?? null;
        $path = $revision ? 'builtin/'.$key.'/'.$revision['directory'].'.webp' : $originalPath;
        $directory = $revision['directory'] ?? 'v'.$version;
        $checksum = $revision['sha256'] ?? $item['sha256'];
        $bytes = File::get($source.'/'.$directory.'/'.$filename);
        $image = getimagesizefromstring($bytes);
        if (hash('sha256', $bytes) !== $checksum || ($image['mime'] ?? null) !== 'image/webp') {
            throw new RuntimeException('Invalid bundled artwork: '.$filename);
        }
        $asset = Asset::firstOrCreate(['builtin_key' => $assetKey], [
            'kind' => 'prop', 'name' => $pack['name'].' · '.$item['name'], 'category' => $category,
            'original_name' => $filename, 'storage_path' => $path, 'mime_type' => 'image/webp',
            'width' => $image[0], 'height' => $image[1], 'file_size' => strlen($bytes),
        ]);
        $asset = Asset::whereKey($asset->id)->lockForUpdate()->firstOrFail();
        $upgrade = $revision && $asset->storage_path === $originalPath;
        if ((! $upgrade && $asset->storage_path !== $path) || $asset->category !== $category) {
            throw new RuntimeException('Unexpected bundled asset path or category: '.$filename);
        }
        if ($asset->width !== $image[0] || $asset->height !== $image[1]) {
            throw new RuntimeException('Bundled artwork dimensions changed: '.$filename);
        }
        $disk = Storage::disk('campaigns');
        $previous = $disk->path($originalPath);
        if ($upgrade && File::exists($previous) && hash_file('sha256', $previous) !== $item['sha256']) {
            throw new RuntimeException('Unexpected original bundled artwork: '.$filename);
        }
        $target = $disk->path($path);
        if (! File::exists($target)) {
            File::ensureDirectoryExists(dirname($target), 0755, true);
            File::replace($target, $bytes);
        }
        if (hash_file('sha256', $target) !== $checksum) {
            throw new RuntimeException('Installed artwork differs. Bundle updates require a new version: '.$filename);
        }
        if ($upgrade) {
            // A new path isolates the thumbnail cache and keeps the old file available to in-flight readers.
            $asset->update(['storage_path' => $path, 'file_size' => strlen($bytes)]);
        }

        return $asset;
    }

    private function material(string $key, int $version, Asset $asset, array $item): void
    {
        $material = MapMaterial::firstOrCreate(['builtin_key' => $key], ['version' => $version]);
        $material = MapMaterial::whereKey($material->id)->lockForUpdate()->firstOrFail();
        $installed = $material->versions()->firstOrCreate(['version' => $version], [
            'asset_id' => $asset->id, 'name' => $asset->name,
            'type' => $item['type'], 'repeat_size' => $item['repeatSize'], 'rotation' => 0,
            'layout' => $item['layout'] ?? null, 'variation' => ['offset' => false, 'quarterTurns' => false],
            'created_at' => now(),
        ]);
        if ($installed->asset_id !== $asset->id || $installed->type !== $item['type']
            || $installed->repeat_size !== (float) $item['repeatSize'] || $installed->layout !== ($item['layout'] ?? null)
            || $installed->name !== $asset->name) {
            throw new RuntimeException('Installed material differs. Bundle updates require a new version: '.$key);
        }
        if ($material->version < $version) {
            $material->update(['version' => $version]);
        }
    }
}
