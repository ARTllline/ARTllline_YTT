<?php

namespace App\Models;

use App\Actions\ObjectInteractionActions;
use App\Services\SceneSnapshotBuilder;
use App\Services\PropCollider;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class SceneProp extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['is_hidden' => 'boolean', 'is_locked' => 'boolean', 'interactions' => 'array', 'preset_snapshot' => 'array'];
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function scene(): BelongsTo
    {
        return $this->belongsTo(Scene::class);
    }

    public function lootContainer(): HasOne
    {
        return $this->hasOne(LootContainer::class, 'prop_id');
    }

    public function projection(bool $gm): array
    {
        $loot = $this->relationLoaded('lootContainer') ? $this->lootContainer : $this->lootContainer()->first();
        $image = app(SceneSnapshotBuilder::class)->asset($this->asset) ?? ['id' => 'loot', 'url' => '/assets/player/utility/loot.svg', 'width' => 96, 'height' => 96];
        $snapshot = $this->preset_snapshot;
        if ($snapshot) {
            $image = array_replace($image, array_intersect_key($snapshot, array_flip(['width', 'height'])));
        }

        return [...($loot ? ['loot' => $loot->summary($gm)] : []), 'id' => (string) $this->id, 'name' => $this->name,
            'interactions' => app(ObjectInteractionActions::class)->projection($this, $gm),
            'image' => $image, ...($snapshot ? ['pivotX' => $snapshot['pivotX'], 'pivotY' => $snapshot['pivotY']] : []),
            'x' => (float) $this->x, 'y' => (float) $this->y, 'rotation' => (float) $this->rotation,
            'scaleX' => (float) $this->scale_x, 'scaleY' => (float) $this->scale_y, 'zIndex' => $this->z_index,
            ...(! $gm && ! $this->is_hidden ? ['movementObstacle' => $this->movementObstacle()] : []),
            ...($gm ? ['isHidden' => $this->is_hidden, 'isLocked' => $this->is_locked,
                ...($snapshot ? ['collider' => $snapshot['collider'], 'preset' => array_diff_key($snapshot, ['collider' => true])] : [])] : [])];
    }

    /** Only the physical silhouette of an already public prop, never preset metadata. */
    private function movementObstacle(): ?array
    {
        $shape = PropCollider::compile($this);
        if (! ($shape['blocksMovement'] ?? false)) {
            return null;
        }

        return $shape['kind'] === 'ellipse'
            ? ['center' => $shape['center'], 'rx' => $shape['radiusX'], 'ry' => $shape['radiusY'],
                'rotation' => deg2rad($shape['rotation'])]
            : ['points' => $shape['points'], 'padding' => 0];
    }
}
