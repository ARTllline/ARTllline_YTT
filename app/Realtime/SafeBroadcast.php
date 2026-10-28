<?php

namespace App\Realtime;

use App\Events\TabletopEvent;
use Illuminate\Broadcasting\BroadcastException;
use Illuminate\Support\Facades\Log;

class SafeBroadcast
{
    private bool $unavailable = false;

    public function send(TabletopEvent $event): void
    {
        if ($this->unavailable) {
            return;
        }
        try {
            event($event);
        } catch (BroadcastException $error) {
            $this->unavailable = true;
            // The database is already committed. A transport outage must not turn
            // an accepted command into an ambiguous HTTP failure. Reconnect/probes resync.
            Log::warning('Tabletop broadcast unavailable', ['type' => $event->envelope['type']]);
        }
    }
}
