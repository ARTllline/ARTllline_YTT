<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AbilityExecution extends Model
{
    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['context' => 'array', 'result' => 'array'];
    }
}
