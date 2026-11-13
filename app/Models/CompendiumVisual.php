<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CompendiumVisual extends Model
{
    protected $guarded = [];

    protected $primaryKey = 'compendium_entry_id';

    public $incrementing = false;

    public $timestamps = false;

    protected $casts = ['evidence' => 'array'];
}
