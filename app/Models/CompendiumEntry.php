<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class CompendiumEntry extends Model
{
    protected $guarded = ['id'];

    // Batch-loaded alongside catalog pages; never resolve an image per card.
    protected $with = ['visual'];

    protected $hidden = ['visual'];

    public function visual(): HasOne
    {
        return $this->hasOne(CompendiumVisual::class);
    }

    public function visualIcon(): ?string
    {
        return $this->library_user_id === null && $this->visual?->entry_checksum === $this->checksum
            ? 'asset:'.$this->visual->asset_id : null;
    }

    protected function casts(): array
    {
        return ['raw_data' => 'array', 'normalized_data' => 'array', 'imported_at' => 'datetime', 'normalization_version' => 'integer'];
    }

    public function source(): BelongsTo
    {
        return $this->belongsTo(CompendiumSource::class, 'source_id');
    }
}
