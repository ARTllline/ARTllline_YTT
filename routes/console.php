<?php

use App\Actions\CueRunner;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Artisan::command('tabletop:prune-receipts {--dry-run : Count without deleting}', function () {
    $days = max(1, (int) config('tabletop.receipt_retention_days', 7));
    $query = DB::table('scene_mutation_receipts')->where('created_at', '<', now()->subDays($days))->whereNotNull('result');
    $count = $this->option('dry-run') ? $query->count() : $query->delete();
    $this->info($count.' receipts '.($this->option('dry-run') ? 'eligible' : 'removed').'; retention '.$days.' days.');
})->purpose('Prune expired completed idempotency receipts');

Schedule::command('tabletop:prune-receipts')->daily()->withoutOverlapping();

Artisan::command('tabletop:recover-cues', function () {
    $this->info(app(CueRunner::class)->recover().' overdue runs scheduled.');
})->purpose('Recover overdue cue runs after interrupted workers');

Schedule::command('tabletop:recover-cues')->everyMinute()->withoutOverlapping();
Schedule::call(fn () => DB::table('audio_grants')->where('expires_at', '<', now())->delete())->daily()->name('prune-audio-grants')->withoutOverlapping();
