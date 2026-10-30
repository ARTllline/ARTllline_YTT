<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SpellEffect extends Model
{
    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['targets' => 'array', 'payload' => 'array', 'concentration' => 'boolean', 'expires_at' => 'datetime', 'ended_at' => 'datetime'];
    }
}
