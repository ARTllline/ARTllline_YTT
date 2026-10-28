<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class TabletopEvent implements ShouldBroadcastNow
{
    use InteractsWithSockets;

    public function __construct(public readonly string $channel, public readonly array $envelope, ?string $socketId = null, public readonly array $additionalChannels = [])
    {
        $this->socket = $socketId;
    }

    public function broadcastOn(): array
    {
        return array_map(fn ($channel) => new PrivateChannel($channel), [$this->channel, ...$this->additionalChannels]);
    }

    public function broadcastAs(): string
    {
        return 'tabletop';
    }

    public function broadcastWith(): array
    {
        return $this->envelope;
    }
}
