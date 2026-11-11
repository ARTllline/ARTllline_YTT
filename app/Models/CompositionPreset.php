<?php

namespace App\Models;

use App\Services\SceneSnapshotBuilder;
use Illuminate\Database\Eloquent\Model;

class CompositionPreset extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['snapshot' => 'array', 'revision' => 'integer', 'user_id' => 'integer'];
    }

    public function assets()
    {
        return $this->belongsToMany(Asset::class, 'composition_preset_assets');
    }

    public function projection(): array
    {
        $assets = $this->assets->keyBy('id');
        $members = array_map(function ($member) use ($assets) {
            $d = $member['data'];
            $token = $member['kind'] === 'token';
            $image = app(SceneSnapshotBuilder::class)->asset($assets->get($token ? ($d['token_image_asset_id'] ?? null) : ($d['asset_id'] ?? null)));
            $preset = $d['preset_snapshot'] ?? [];

            return ['kind' => $member['kind'], 'name' => $d['name'], 'x' => $d['x'], 'y' => $d['y'], 'rotation' => $d['rotation'],
                'width' => $token ? $d['size'] * $d['scale'] : ($preset['width'] ?? $image['width'] ?? 96) * $d['scale_x'],
                'height' => $token ? $d['size'] * $d['scale'] : ($preset['height'] ?? $image['height'] ?? 96) * $d['scale_y'],
                'pivotX' => $preset['pivotX'] ?? .5, 'pivotY' => $preset['pivotY'] ?? .5, 'image' => $image,
                'container' => isset($member['loot']), 'items' => array_sum(array_map(fn ($i) => $i['data']['quantity'], $member['loot']['items'] ?? [])),
                'interactions' => count($d['interactions'] ?? [])];
        }, $this->snapshot['members']);

        return ['id' => (string) $this->id, 'name' => $this->name, 'description' => $this->description,
            'revision' => $this->revision, 'count' => count($members), 'members' => $members];
    }
}
