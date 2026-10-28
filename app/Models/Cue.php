<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Cue extends Model
{
    protected $guarded = [];

    public function steps(): HasMany
    {
        return $this->hasMany(CueStep::class)->orderBy('position');
    }
}
