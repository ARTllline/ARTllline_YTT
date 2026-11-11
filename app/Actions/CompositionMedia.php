<?php

namespace App\Actions;

use App\Models\Asset;
use App\Models\User;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class CompositionMedia
{
    /** Visit only schema-owned media references, including ability/item icons. */
    public function map(array $value, callable $resolve): array
    {
        foreach ($value as $key => &$child) {
            if (in_array($key, ['asset_id', 'portrait_asset_id', 'token_image_asset_id'], true) && $child) {
                $child = $resolve((int) $child);
            } elseif (is_string($child) && preg_match('/^asset:(\d+)$/', $child, $match)) {
                $child = 'asset:'.$resolve((int) $match[1]);
            } elseif (is_array($child)) {
                $child = $this->map($child, $resolve);
            }
        }

        return $value;
    }

    public function capture(array $snapshot, User $user, array &$paths): array
    {
        $map = [];
        $snapshot = $this->map($snapshot, function ($id) use ($user, &$paths, &$map) {
            if (isset($map[$id])) {
                return $map[$id];
            }
            $asset = Asset::where(fn ($q) => $q->available(null, $user)->orWhereNotNull('builtin_key'))->lockForUpdate()->findOrFail($id);
            abort_if($asset->duration_ms !== null, 422, 'Аудио не поддерживается в пресете композиции.');
            // Campaign media must survive deletion of its source campaign and permission changes.
            if ($asset->campaign_id) {
                $path = 'library/'.$user->id.'/'.$asset->kind.'/'.Str::uuid().'.'.pathinfo($asset->storage_path, PATHINFO_EXTENSION);
                abort_unless(Storage::disk('campaigns')->copy($asset->storage_path, $path), 500, 'Не удалось скопировать изображение пресета.');
                $paths[] = $path;
                $copy = $asset->replicate();
                $copy->fill(['campaign_id' => null, 'library_user_id' => $user->id, 'uploaded_by' => $user->id, 'storage_path' => $path, 'delivery_key' => null, 'builtin_key' => null])->save();
                $asset = $copy;
            }

            return $map[$id] = $asset->id;
        });

        return [$snapshot, array_values($map)];
    }
}
