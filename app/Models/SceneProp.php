<?php

namespace App\Models;

use App\Actions\ObjectInteractionActions;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SceneProp extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['is_hidden' => 'boolean', 'is_locked' => 'boolean', 'interactions' => 'array'];
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
        $loot = LootContainer::where('prop_id', $this->id)->first();

        return [...($loot ? ['loot' => $loot->summary($gm)] : []), 'id' => (string) $this->id, 'name' => $this->name,
            'interactions' => app(ObjectInteractionActions::class)->projection($this, $gm),
            'image' => app(SceneSnapshotBuilder::class)->asset($this->asset) ?? ['id' => 'loot', 'url' => '/assets/player/utility/loot.svg', 'width' => 96, 'height' => 96],
            'x' => (float) $this->x, 'y' => (float) $this->y, 'rotation' => (float) $this->rotation,
            'scaleX' => (float) $this->scale_x, 'scaleY' => (float) $this->scale_y, 'zIndex' => $this->z_index,
            ...($gm ? ['isHidden' => $this->is_hidden, 'isLocked' => $this->is_locked] : [])];
    }
}
