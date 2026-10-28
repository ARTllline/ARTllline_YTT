<?php

namespace App\Actions;

use App\Models\Asset;
use App\Models\Campaign;
use App\Models\User;
use App\Services\AudioProbe;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class StoreAudio
{
    public function execute(User $user, Campaign $campaign, UploadedFile $file, string $kind): Asset
    {
        Gate::forUser($user)->authorize('update', $campaign);
        abort_unless(in_array($kind, ['music', 'ambient', 'sfx']), 422);
        $info = app(AudioProbe::class)->inspect($file);
        $path = 'campaigns/'.$campaign->id.'/'.$kind.'/'.Str::uuid().'.'.$info['extension'];
        Storage::disk('campaigns')->putFileAs(dirname($path), $file, basename($path));
        try {
            $original = basename(str_replace('\\', '/', $file->getClientOriginalName()));

            return Asset::create(['campaign_id' => $campaign->id, 'uploaded_by' => $user->id, 'kind' => $kind,
                'name' => mb_substr(pathinfo($original, PATHINFO_FILENAME), 0, 255), 'original_name' => mb_substr($original, 0, 255),
                'storage_path' => $path, 'mime_type' => $info['mime'], 'file_size' => $file->getSize(),
                'width' => 0, 'height' => 0, 'duration_ms' => $info['duration']]);
        } catch (\Throwable $error) {
            Storage::disk('campaigns')->delete($path);
            throw $error;
        }
    }
}
