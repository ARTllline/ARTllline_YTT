<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class CompendiumSource extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['metadata' => 'array', 'type_synced_at' => 'array', 'last_synced_at' => 'datetime'];
    }

    public function entries(): HasMany
    {
        return $this->hasMany(CompendiumEntry::class, 'source_id');
    }
}
