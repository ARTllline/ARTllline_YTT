<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class ItemDefinition extends Model
{
    use HasUuids;

    protected $guarded = ['id', 'campaign_id'];

    protected function casts(): array
    {
        return ['equipment_slots' => 'array', 'modifiers' => 'array', 'width' => 'integer', 'height' => 'integer', 'max_stack' => 'integer'];
    }
}
