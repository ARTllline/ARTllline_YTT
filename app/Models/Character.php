<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Character extends Model
{
    protected $guarded = ['id', 'campaign_id'];

    protected function casts(): array
    {
        return ['check_stats' => 'array', 'hp' => 'integer', 'max_hp' => 'integer', 'owner_user_id' => 'integer'];
    }

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function portraitAsset(): BelongsTo
    {
        return $this->belongsTo(Asset::class, 'portrait_asset_id');
    }

    public function tokens(): HasMany
    {
        return $this->hasMany(Token::class);
    }
}
