<?php

namespace App\Models;

use App\Combat\ConditionRules;
use Illuminate\Database\Eloquent\Model;

class ObjectCheck extends Model
{
    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['provenance' => 'array', 'raw_dice' => 'array', 'request_context' => 'array', 'branch' => 'array', 'success' => 'boolean', 'dc_visible' => 'boolean', 'created_at' => 'datetime'];
    }

    public function projection(bool $gm = false): array
    {
        $provenance = $this->provenance;
        if (! $gm && isset($provenance['rollContext'])) {
            $provenance['rollContext'] = app(ConditionRules::class)->publicContext($provenance['rollContext']);
        }

        return ['id' => $this->id, 'actionId' => $this->action_id, 'actionLabel' => $this->action_label,
            'label' => $this->label, 'natural' => (int) $this->natural, 'modifier' => (int) $this->modifier,
            'total' => (int) $this->total, 'success' => $this->success, 'tokenId' => $this->token_id ? (string) $this->token_id : null,
            'rollMode' => $this->roll_mode ?? 'normal', 'rawDice' => $this->raw_dice ?? [(int) $this->natural],
            'automaticFailure' => ! empty($this->provenance['rollContext']['automaticFailure']),
            'selectedDie' => (int) array_search((int) $this->natural, $this->raw_dice ?? [(int) $this->natural], true),
            'provenance' => $provenance ?? ['source' => 'legacy_interaction', 'tokenId' => $this->token_id ? (string) $this->token_id : null,
                'tokenName' => null, 'statKey' => $this->ability_key, 'statLabel' => $this->label,
                'baseModifier' => (int) $this->modifier, 'otherModifiers' => [], 'finalModifier' => (int) $this->modifier],
            'rolledAt' => $this->created_at->toIso8601String()]
            + ($this->dc_visible ? ['dc' => (int) $this->dc] : []);
    }
}
