<?php

namespace App\Actions;

use App\Models\Asset;
use App\Models\Campaign;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class StoreImage
{
    public function execute(User $user, Campaign $campaign, UploadedFile $file, string $kind): Asset
    {
        Gate::forUser($user)->authorize('update', $campaign);
        abort_unless(in_array($kind, ['map', 'token', 'handout', 'prop'], true), 422);
        $dimensions = @getimagesize($file->getRealPath());
        $formats = [IMAGETYPE_PNG => ['image/png', 'png'], IMAGETYPE_JPEG => ['image/jpeg', 'jpg'], IMAGETYPE_WEBP => ['image/webp', 'webp']];
        $format = $dimensions ? ($formats[$dimensions[2]] ?? null) : null;
        if (! $format || $file->getMimeType() !== $format[0] || $file->getSize() > 16 * 1024 * 1024
            || $dimensions[0] > 8192 || $dimensions[1] > 8192 || $dimensions[0] * $dimensions[1] > 32000000) {
            throw ValidationException::withMessages(['file' => 'Use a PNG, JPEG or WebP up to 16 MB, 8192 px per side and 32 megapixels.']);
        }
        $path = 'campaigns/'.$campaign->id.'/'.$kind.'/'.Str::uuid().'.'.$format[1];
        Storage::disk('campaigns')->putFileAs(dirname($path), $file, basename($path));
        try {
            $original = basename(str_replace('\\', '/', $file->getClientOriginalName()));

            return Asset::create(['campaign_id' => $campaign->id, 'uploaded_by' => $user->id, 'kind' => $kind,
                'name' => mb_substr(trim(preg_replace('/[_-]+/u', ' ', pathinfo($original, PATHINFO_FILENAME))) ?: __('ui.untitled_asset'), 0, 255),
                'original_name' => mb_substr(basename(str_replace('\\', '/', $file->getClientOriginalName())), 0, 255),
                'storage_path' => $path, 'mime_type' => $format[0], 'file_size' => $file->getSize(),
                'width' => $dimensions[0], 'height' => $dimensions[1]]);
        } catch (\Throwable $error) {
            Storage::disk('campaigns')->delete($path);
            throw $error;
        }
    }
}
