<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InventoryItem extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['x' => 'integer', 'y' => 'integer', 'quantity' => 'integer'];
    }

    public function definition(): BelongsTo
    {
        return $this->belongsTo(ItemDefinition::class, 'item_definition_id');
    }
}
