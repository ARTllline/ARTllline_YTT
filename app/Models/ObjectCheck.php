<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ObjectCheck extends Model
{
    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['branch' => 'array', 'success' => 'boolean', 'dc_visible' => 'boolean', 'created_at' => 'datetime'];
    }

    public function projection(): array
    {
        return ['id' => $this->id, 'actionId' => $this->action_id, 'actionLabel' => $this->action_label,
            'label' => $this->label, 'natural' => (int) $this->natural, 'modifier' => (int) $this->modifier,
            'total' => (int) $this->total, 'success' => $this->success, 'tokenId' => $this->token_id ? (string) $this->token_id : null,
            'rolledAt' => $this->created_at->toIso8601String()]
            + ($this->dc_visible ? ['dc' => (int) $this->dc] : []);
    }
}
