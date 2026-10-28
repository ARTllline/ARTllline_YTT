<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SceneTrigger extends Model
{
    protected $guarded = [];

    protected $dateFormat = 'Y-m-d H:i:s.u';

    protected $casts = ['enabled' => 'boolean', 'once' => 'boolean', 'cooldown_ms' => 'integer',
        'fire_count' => 'integer', 'minimum_round' => 'integer', 'last_fired_at' => 'immutable_datetime'];

    public function projection(): array
    {
        return ['id' => (string) $this->id, 'name' => $this->name, 'eventType' => $this->event_type,
            'cueId' => $this->cue_id ? (string) $this->cue_id : null, 'regionId' => $this->region_id ? (string) $this->region_id : null,
            'objectType' => $this->prop_id ? 'prop' : 'token', 'objectId' => ($this->prop_id ?? $this->token_id) ? (string) ($this->prop_id ?? $this->token_id) : null,
            'actorFilter' => $this->actor_filter, 'actorTokenId' => $this->actor_token_id ? (string) $this->actor_token_id : null,
            'enabled' => $this->enabled, 'once' => $this->once, 'cooldownMs' => $this->cooldown_ms, 'minimumRound' => $this->minimum_round,
            'fireCount' => $this->fire_count, 'lastFiredAt' => $this->last_fired_at?->toISOString()];
    }
}
