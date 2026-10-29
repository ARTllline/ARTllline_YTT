<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Token extends Model
{
    protected $guarded = ['id', 'scene_id'];

    protected function casts(): array
    {
        return ['is_hidden' => 'boolean', 'is_locked' => 'boolean', 'interactions' => 'array', 'check_stats' => 'array'];
    }

    public function scene(): BelongsTo
    {
        return $this->belongsTo(Scene::class);
    }

    public function conditions(): HasMany
    {
        return $this->hasMany(TokenCondition::class)->orderBy('id');
    }

    public function imageAsset(): BelongsTo
    {
        return $this->belongsTo(Asset::class, 'token_image_asset_id');
    }
}
