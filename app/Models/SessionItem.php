<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SessionItem extends Model
{
    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    protected $guarded = [];
}
