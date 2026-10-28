<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Asset extends Model
{
    protected $guarded = ['id'];

    protected $hidden = ['storage_path'];

    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(AssetTag::class, 'asset_tag');
    }

    public function collections(): BelongsToMany
    {
        return $this->belongsToMany(AssetCollection::class, 'asset_collection');
    }

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }
}
