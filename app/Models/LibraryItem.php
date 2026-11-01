<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class LibraryItem extends Model
{
    use HasUuids;

    protected $guarded = ['id', 'user_id'];

    protected function casts(): array
    {
        return ['definition' => 'array'];
    }
}
