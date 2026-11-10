<?php

namespace App\Models;

use App\Services\SceneSnapshotBuilder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/** Immutable definition. Future placements reference this ID, never the library head. */
class MapMaterialVersion extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('Material versions are immutable; append a new version.'));
    }

    protected function casts(): array
    {
        return ['variation' => 'array', 'repeat_size' => 'float', 'rotation' => 'float'];
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function material(): BelongsTo
    {
        return $this->belongsTo(MapMaterial::class, 'map_material_id');
    }

    public function projection(bool $includeLibraryDetails = false): array
    {
        return ['id' => (string) $this->map_material_id, 'versionId' => (string) $this->id,
            'version' => $this->version, 'name' => $this->name, 'type' => $this->type,
            'asset' => app(SceneSnapshotBuilder::class)->asset($this->asset),
            'repeatSize' => $this->repeat_size, 'rotation' => $this->rotation, 'variation' => $this->variation,
            ...($this->layout ? ['layout' => $this->layout] : []),
            ...($includeLibraryDetails && $this->material->builtin_key ? ['builtin' => true, 'displayName' => Str::after($this->name, ' · ')] : [])];
    }
}
