<?php

use App\Actions\CueRunner;
use App\Services\TabletopDoctor;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Artisan::command('tabletop:doctor {--production : Require Redis, HTTPS/WSS and secure configuration} {--json : Machine-readable diagnostics}', function () {
    $rows = app(TabletopDoctor::class)->inspect((bool) $this->option('production'));
    if ($this->option('json')) {
        $this->line(json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    } else {
        $this->table(['Проверка', 'Статус', 'Результат'], array_map(fn ($r) => array_values($r), $rows));
    }

    return collect($rows)->contains('status', 'ERROR') ? 1 : 0;
})->purpose('Diagnose tabletop dependencies without printing secrets');

Schedule::call(fn () => Cache::put('tabletop:scheduler-heartbeat', time(), 300))->everyMinute()->name('tabletop-heartbeat');

Artisan::command('tabletop:prune-executions {--dry-run : Count without deleting}', function () {
    $days = max(30, (int) config('tabletop.execution_retention_days', 90));
    // Do not prune any campaign with an unfinished execution or a failed run awaiting repair.
    $busy = DB::table('cue_runs')->select('campaign_id')->whereIn('status', ['queued', 'running', 'failed'])->distinct()->pluck('campaign_id');
    $runs = DB::table('cue_runs')->whereIn('status', ['completed', 'cancelled'])->where('updated_at', '<', now()->subDays($days))->whereNotIn('campaign_id', $busy);
    $count = $runs->count();
    if (! $this->option('dry-run')) {
        // Chunk and lock campaign first, matching execution writers; recheck status under the lock.
        $runs->orderBy('id')->chunkById(100, function ($rows) use ($days) {
            foreach ($rows->groupBy('campaign_id') as $campaignId => $group) {
                DB::transaction(function () use ($campaignId, $group, $days) {
                    DB::table('campaigns')->where('id', $campaignId)->lockForUpdate()->first();
                    if (DB::table('cue_runs')->where('campaign_id', $campaignId)->whereIn('status', ['queued', 'running', 'failed'])->exists()) {
                        return;
                    }
                    $ids = DB::table('cue_runs')->whereIn('id', $group->pluck('id'))->whereIn('status', ['completed', 'cancelled'])->where('updated_at', '<', now()->subDays($days))->pluck('id');
                    DB::table('trigger_fires')->whereIn('cue_run_id', $ids)->delete();
                    DB::table('cue_runs')->whereIn('id', $ids)->delete();
                });
            }
        }, 'id');
    }
    $this->info($count.' executions '.($this->option('dry-run') ? 'eligible' : 'considered').'; retention '.$days.' days. Definitions, sessions and combat history retained.');
})->purpose('Prune old completed technical cue executions and their trigger fire details');
Schedule::command('tabletop:prune-executions')->daily()->withoutOverlapping();

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
