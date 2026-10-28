<?php

namespace App\Models;

use App\Services\SceneSnapshotBuilder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SceneProp extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['is_hidden' => 'boolean', 'is_locked' => 'boolean'];
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function scene(): BelongsTo
    {
        return $this->belongsTo(Scene::class);
    }

    public function projection(bool $gm): array
    {
        return ['id' => (string) $this->id, 'name' => $this->name,
            'image' => app(SceneSnapshotBuilder::class)->asset($this->asset),
            'x' => (float) $this->x, 'y' => (float) $this->y, 'rotation' => (float) $this->rotation,
            'scaleX' => (float) $this->scale_x, 'scaleY' => (float) $this->scale_y, 'zIndex' => $this->z_index,
            ...($gm ? ['isHidden' => $this->is_hidden, 'isLocked' => $this->is_locked] : [])];
    }
}
