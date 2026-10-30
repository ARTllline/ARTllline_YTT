<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CompendiumCopy extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['snapshot' => 'array', 'source_reference' => 'array', 'created_at' => 'datetime'];
    }
}
