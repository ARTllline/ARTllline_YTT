<?php

namespace App\Realtime;

use App\Events\TabletopEvent;
use App\Support\RequestPerformance;
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
            $trace = app(RequestPerformance::class);
            if ($trace->enabled) {
                $trace->broadcasts[] = ['type' => $event->envelope['type'], 'bytes' => strlen(json_encode($event->envelope)), 'channels' => 1 + count($event->additionalChannels)];
            }
            $trace->measure('broadcast_dispatch', fn () => event($event));
        } catch (BroadcastException $error) {
            $this->unavailable = true;
            // The database is already committed. A transport outage must not turn
            // an accepted command into an ambiguous HTTP failure. Reconnect/probes resync.
            Log::warning('Tabletop broadcast unavailable', ['type' => $event->envelope['type']]);
        }
    }
}
