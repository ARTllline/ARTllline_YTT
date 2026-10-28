<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FogAction extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['geometry' => 'array', 'sequence' => 'integer'];
    }

    public function projection(): array
    {
        return ['id' => (string) $this->id, 'sequence' => $this->sequence, 'operation' => $this->operation, 'shape' => $this->shape, 'geometry' => $this->geometry];
    }
}
