<?php

namespace App\Actions;

use App\Models\Campaign;
use App\Models\GameSession;
use App\Models\SessionItem;
use App\Models\User;
use App\Services\SessionPlan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

class SessionActions
{
    public function execute(User $user, Campaign $campaign, string $command, array $input): array
    {
        return DB::transaction(function () use ($user, $campaign, $command, $input) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $plans = app(SessionPlan::class);
            if ($command === 'create') {
                $data = Validator::make($input, ['name' => 'required|string|max:160'])->validate();
                abort_if(GameSession::where('campaign_id', $campaign->id)->count() >= 100, 422, 'В кампании можно сохранить до 100 сессий.');

                return ['session' => $plans->view(GameSession::create($data + ['campaign_id' => $campaign->id])->refresh())];
            }
            $data = Validator::make($input, ['sessionId' => 'required|integer|min:1'])->validate();
            $session = GameSession::where('campaign_id', $campaign->id)->findOrFail($data['sessionId']);
            if ($command === 'delete') {
                abort_if($session->status === 'active', 409, 'Сначала завершите сессию.');
                $session->update(['current_item_id' => null]);
                $session->delete();

                return ['deleted' => true];
            }
            abort_if($session->status === 'completed', 409, 'Завершённая сессия доступна для просмотра.');
            if ($command === 'save') {
                $data = $plans->validate($campaign, $input);
                abort_unless($data['planRevision'] === $session->plan_revision, 409, 'План изменён в другом окне. Обновите его перед сохранением.');
                $ids = array_column($data['items'], 'id');
                abort_if(SessionItem::whereIn('id', $ids)->where('game_session_id', '!=', $session->id)->exists(), 422);
                $old = $session->items->pluck('id')->all();
                foreach ($data['items'] as $item) {
                    if (isset(SessionPlan::REFERENCES[$item['type']]) && empty($item['referenceId'])) {
                        $previous = $session->items->firstWhere('id', $item['id']);
                        abort_unless($previous && $previous->type === $item['type'] && $previous->{SessionPlan::REFERENCES[$item['type']]} === null, 422, 'Выберите материал для пункта плана.');
                    }
                }
                $currentIndex = array_search($session->current_item_id, $old, true);
                if (! in_array($session->current_item_id, $ids, true)) {
                    $session->current_item_id = null;
                }
                $session->save();
                $session->items()->whereNotIn('id', $ids)->delete();
                foreach ($data['items'] as $position => $item) {
                    $refs = array_fill_keys(array_values(SessionPlan::REFERENCES), null);
                    if (isset(SessionPlan::REFERENCES[$item['type']])) {
                        $refs[SessionPlan::REFERENCES[$item['type']]] = $item['referenceId'] ?? null;
                    }
                    SessionItem::updateOrCreate(['id' => $item['id']], $refs + ['game_session_id' => $session->id, 'position' => $position,
                        'type' => $item['type'], 'title' => $item['title'] ?? null, 'notes' => $item['notes'] ?? null]);
                }
                $session->name = $data['name'];
                $session->plan_revision++;
                $session->current_item_id ??= $ids[min($currentIndex === false ? 0 : $currentIndex, max(0, count($ids) - 1))] ?? null;
            } elseif ($command === 'start') {
                abort_if(GameSession::where('campaign_id', $campaign->id)->where('status', 'active')->whereKeyNot($session->id)->exists(), 409, 'В кампании уже идёт другая сессия.');
                $session->status = 'active';
                $session->started_at ??= now();
                $session->current_item_id ??= $session->items()->value('id');
            } elseif ($command === 'focus') {
                $data = Validator::make($input, ['itemId' => 'required|uuid'])->validate();
                abort_unless($session->items()->whereKey($data['itemId'])->exists(), 422, 'Пункт больше не существует.');
                $session->current_item_id = $data['itemId'];
            } elseif ($command === 'notes') {
                $data = Validator::make($input, ['notes' => 'present|nullable|string|max:30000'])->validate();
                $session->notes = $data['notes'];
            } elseif ($command === 'auto') {
                $data = Validator::make($input, ['enabled' => 'required|boolean'])->validate();
                $session->auto_preload = $data['enabled'];
            } elseif ($command === 'complete') {
                abort_unless($session->status === 'active', 409, 'Сессия ещё не начата.');
                $session->status = 'completed';
                $session->ended_at = now();
            } else {
                abort(404);
            }
            $session->save();

            return ['session' => $plans->view($session->fresh())];
        }, 3);
    }
}
