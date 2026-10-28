<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Handout extends Model
{
    protected $guarded = ['id'];

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function reveals(): HasMany
    {
        return $this->hasMany(HandoutReveal::class);
    }
}
