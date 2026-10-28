<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Scene extends Model
{
    protected $guarded = ['id', 'revision'];

    protected function casts(): array
    {
        return ['grid_visible' => 'boolean', 'grid_snap' => 'boolean', 'revision' => 'integer'];
    }

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function mapAsset(): BelongsTo
    {
        return $this->belongsTo(Asset::class, 'map_asset_id');
    }

    public function tokens(): HasMany
    {
        return $this->hasMany(Token::class);
    }
}
