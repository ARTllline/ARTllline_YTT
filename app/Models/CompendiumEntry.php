<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CompendiumEntry extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['raw_data' => 'array', 'normalized_data' => 'array', 'imported_at' => 'datetime', 'normalization_version' => 'integer'];
    }

    public function source(): BelongsTo
    {
        return $this->belongsTo(CompendiumSource::class, 'source_id');
    }
}
