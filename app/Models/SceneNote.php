<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SceneNote extends Model
{
    protected $guarded = ['id'];

    public function projection(): array
    {
        return ['id' => (string) $this->id, 'x' => (float) $this->x, 'y' => (float) $this->y,
            'title' => $this->title, 'body' => $this->body, 'icon' => $this->icon];
    }
}
