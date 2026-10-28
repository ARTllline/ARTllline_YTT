<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SceneRegion extends Model
{
    protected $guarded = [];

    protected $casts = ['geometry' => 'array', 'enabled' => 'boolean'];

    public function projection(): array
    {
        return ['id' => (string) $this->id, 'name' => $this->name, 'shape' => $this->shape,
            'geometry' => $this->geometry, 'enabled' => $this->enabled];
    }
}
