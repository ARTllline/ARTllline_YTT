<?php

namespace App\Actions;

use App\Jobs\ExecuteCueStep;
use App\Models\Campaign;
use App\Models\Cue;
use App\Models\CueRun;
use App\Models\Scene;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Realtime\DirectorPublisher;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

class CueRunner
{
    public function start(User $user, Scene $scene, Cue $cue, array $chain = [], ?string $correlation = null, bool $automatic = false): CueRun
    {
        return DB::transaction(function () use ($user, $scene, $cue, $chain, $correlation, $automatic) {
            $campaign = Campaign::whereKey($scene->campaign_id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            abort_unless($campaign->active_scene_id === $scene->id, 409, 'Сначала активируйте эту сцену для игроков.');
            $pending = CueRun::where('campaign_id', $campaign->id)->whereIn('status', ['queued', 'running', 'failed'])->count();
            abort_if(! $automatic && $pending > 0, 409, 'Сначала завершите или остановите текущее событие.');
            abort_if($pending >= 100, 409, 'Очередь событий заполнена. Мастеру нужно завершить или остановить ожидающие события.');
            $cue = Cue::where('scene_id', $scene->id)->with('steps')->findOrFail($cue->id);
            $run = CueRun::create(['id' => (string) Str::uuid(), 'campaign_id' => $campaign->id, 'scene_id' => $scene->id,
                'cue_id' => $cue->id, 'created_by' => $user->id, 'name' => $cue->name, 'epoch' => $campaign->live_revision, 'due_at' => now(),
                'queue_order' => (CueRun::where('campaign_id', $campaign->id)->max('queue_order') ?? 0) + 1,
                'trigger_chain' => $chain, 'correlation_id' => $correlation]);
            foreach ($cue->steps as $step) {
                $run->steps()->create(['id' => (string) Str::uuid(), 'position' => $step->position, 'type' => $step->type, 'config' => $step->config]);
            }
            $this->enqueue($run);

            return $run;
        });
    }

    public function control(User $user, Scene $scene, string $id, string $action): CueRun
    {
        return DB::transaction(function () use ($user, $scene, $id, $action) {
            $campaign = Campaign::whereKey($scene->campaign_id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $run = CueRun::where('scene_id', $scene->id)->lockForUpdate()->findOrFail($id);
            if ($action === 'cancel') {
                if (in_array($run->status, ['queued', 'running', 'failed'])) {
                    $this->finish($campaign, $run, 'cancelled');
                }
            } else {
                abort_unless($run->status === 'failed', 409, 'Повтор доступен только для шага с ошибкой.');
                abort_unless($campaign->active_scene_id === $scene->id && $campaign->live_revision === $run->epoch, 409, 'Сцена события больше не активна.');
                $run->steps()->where('position', $run->position)->update(['status' => 'queued']);
                $run->update(['status' => 'queued', 'error' => null, 'due_at' => now()]);
                $this->enqueue($run);
            }

            return $run;
        });
    }

    public function advance(int $campaignId, string $id, int $position): void
    {
        try {
            DB::transaction(function () use ($campaignId, $id, $position) {
                $campaign = Campaign::whereKey($campaignId)->lockForUpdate()->first();
                if (! $campaign) {
                    return;
                }
                $run = CueRun::where('campaign_id', $campaignId)->lockForUpdate()->find($id);
                if (! $run || ! in_array($run->status, ['queued', 'running']) || $run->position !== $position) {
                    return;
                }
                if ($campaign->active_scene_id !== $run->scene_id || $campaign->live_revision !== $run->epoch) {
                    $this->finish($campaign, $run, 'cancelled');

                    return;
                }
                if ($run->due_at?->isFuture()) {
                    $this->enqueue($run);

                    return;
                }
                if (CueRun::where('campaign_id', $campaignId)->where('queue_order', '<', $run->queue_order)->whereIn('status', ['queued', 'running', 'failed'])->exists()) {
                    $run->update(['due_at' => now()->addSecond()]);
                    $this->enqueue($run);

                    return;
                }
                $scene = Scene::whereKey($run->scene_id)->lockForUpdate()->firstOrFail();
                Gate::forUser(User::findOrFail($run->created_by))->authorize('update', $scene);
                $step = $run->steps()->where('position', $position)->first();
                if (! $step) {
                    $this->finish($campaign, $run, 'completed');

                    return;
                }
                $step->update(['status' => 'running']);
                $context = app(CommandContext::class);
                $previousChain = $context->triggerChain;
                $previousCorrelation = $context->correlationId;
                $context->triggerChain = $run->trigger_chain ?? [];
                $context->correlationId = $run->correlation_id ?? $run->id;
                try {
                    $delay = app(CueStepActions::class)->execute($campaign, $scene, $run, $step);
                } finally {
                    $context->triggerChain = $previousChain;
                    $context->correlationId = $previousCorrelation;
                }
                $step->update(['status' => 'completed', 'completed_at' => now()]);
                $run->update(['status' => 'running', 'position' => $position + 1, 'due_at' => now()->addMilliseconds($delay), 'error' => null]);
                // Database job insertion and domain writes commit together. A killed
                // worker can replay this delivery, but the position guard rejects it.
                $this->enqueue($run);
            }, 3);
        } catch (Throwable $error) {
            Log::error('Cue step failed', ['campaign_id' => $campaignId, 'run_id' => $id, 'position' => $position, 'exception' => $error::class]);
            DB::transaction(function () use ($campaignId, $id, $position, $error) {
                $campaign = Campaign::whereKey($campaignId)->lockForUpdate()->first();
                $run = CueRun::where('campaign_id', $campaignId)->lockForUpdate()->find($id);
                if (! $campaign || ! $run || $run->position !== $position || ! in_array($run->status, ['queued', 'running'])) {
                    return;
                }
                $message = $error instanceof HttpExceptionInterface && preg_match('/[А-Яа-я]/u', $error->getMessage())
                    ? $error->getMessage() : 'Не удалось выполнить действие. Проверьте его цели и повторите шаг.';
                $run->update(['status' => 'failed', 'error' => mb_substr($message, 0, 1000)]);
                $run->steps()->where('position', $position)->update(['status' => 'failed']);
                app(DirectorPublisher::class)->send($campaign, $run, (string) Str::uuid(), 'clear', ['terminal' => false]);
            });
        }
    }

    public function cancelCampaign(Campaign $campaign): void
    {
        foreach (CueRun::where('campaign_id', $campaign->id)->whereIn('status', ['queued', 'running', 'failed'])->get() as $run) {
            $this->finish($campaign, $run, 'cancelled');
        }
    }

    private function finish(Campaign $campaign, CueRun $run, string $status): void
    {
        $run->update(['status' => $status, 'due_at' => null]);
        if ($status === 'cancelled') {
            $run->steps()->whereIn('status', ['queued', 'failed'])->update(['status' => 'cancelled']);
        }
        // A waiting run has presented nothing. Cancelling it must not release
        // the camera/message belonging to the earlier active run.
        if ($run->position > 0) {
            app(DirectorPublisher::class)->send($campaign, $run, (string) Str::uuid(), 'clear');
        }
    }

    public function enqueue(CueRun $run): void
    {
        // The job handles the final subsecond tail outside the transaction.
        $available = $run->due_at?->timestamp ?? now()->timestamp;
        ExecuteCueStep::dispatch($run->campaign_id, $run->id, $run->position)->delay(now()->setTimestamp($available));
    }

    public function recover(): int
    {
        $count = 0;
        CueRun::whereIn('status', ['queued', 'running'])->where('due_at', '<', now()->subSeconds(90))->orderBy('id')->chunk(100, function ($runs) use (&$count) {
            foreach ($runs as $run) {
                $this->enqueue($run);
                $count++;
            }
        });

        return $count;
    }
}
