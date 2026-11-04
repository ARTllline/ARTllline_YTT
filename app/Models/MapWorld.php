<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MapWorld extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['schema_version' => 'integer', 'reference_crop' => 'array', 'structure' => 'array'];
    }

    public function scene(): BelongsTo
    {
        return $this->belongsTo(Scene::class);
    }
}
