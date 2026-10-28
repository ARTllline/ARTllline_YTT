<?php

namespace App\Services;

use App\Models\Asset;
use Illuminate\Support\Facades\Storage;

class AssetThumbnail
{
    public function path(Asset $asset): string
    {
        return $asset->storage_path.'.thumb.webp';
    }

    public function ensure(Asset $asset): string
    {
        abort_unless(function_exists('imagewebp'), 503, 'Enable the PHP GD extension with WebP support to generate thumbnails.');
        $disk = Storage::disk('campaigns');
        $path = $this->path($asset);
        if ($disk->exists($path)) {
            return $path;
        }
        // Bound input dimensions at upload; serialize lazy generation for older assets.
        abort_unless($disk->exists($asset->storage_path), 404);
        $lock = fopen($disk->path($asset->storage_path.'.thumb.lock'), 'c');
        abort_unless($lock, 404);
        flock($lock, LOCK_EX);
        try {
            if ($disk->exists($path)) {
                return $path;
            }
            $limit = ini_get('memory_limit');
            $bytes = ini_parse_quantity($limit);
            if ($bytes > 0 && $bytes < 268435456) {
                ini_set('memory_limit', '256M');
            }
            $source = match ($asset->mime_type) {
                'image/png' => @imagecreatefrompng($disk->path($asset->storage_path)),
                'image/jpeg' => @imagecreatefromjpeg($disk->path($asset->storage_path)),
                'image/webp' => @imagecreatefromwebp($disk->path($asset->storage_path)),
            };
            abort_unless($source, 422, 'The image could not be decoded.');
            $scale = min(1, 320 / max($asset->width, $asset->height));
            $thumb = imagescale($source, max(1, (int) round($asset->width * $scale)), max(1, (int) round($asset->height * $scale)));
            imagealphablending($thumb, false);
            imagesavealpha($thumb, true);
            ob_start();
            imagewebp($thumb, null, 78);
            $disk->put($path, ob_get_clean());
            imagedestroy($thumb);
            imagedestroy($source);
            ini_set('memory_limit', $limit);

            return $path;
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}
