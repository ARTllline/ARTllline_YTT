<?php

namespace App\Jobs;

use App\Actions\CueRunner;
use App\Models\CueRun;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Carbon;

class ExecuteCueStep implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 60;

    public int $backoff = 5;

    public function __construct(public int $campaignId, public string $runId, public int $position)
    {
        // Explicit durable queue, even on installations whose default is sync.
        $this->onConnection('tabletop')->onQueue('cues')->beforeCommit();
    }

    public function handle(CueRunner $runner): void
    {
        // Database queue timestamps have second precision. The delayed job wakes
        // in the final second and waits only that subsecond tail, without locks.
        // Long Waits remain delayed jobs, never sleeping workers or browser timers.
        $due = CueRun::whereKey($this->runId)->value('due_at');
        if ($due) {
            $remaining = Carbon::parse($due)->getTimestampMs() - now()->getTimestampMs();
            if ($remaining > 0 && $remaining < 1000) {
                usleep($remaining * 1000);
            }
        }
        $runner->advance($this->campaignId, $this->runId, $this->position);
    }
}
