<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CueRunStep extends Model
{
    public $timestamps = false;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $attributes = ['status' => 'queued'];

    protected $casts = ['config' => 'array', 'position' => 'integer'];
}
