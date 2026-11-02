<?php

namespace App\Http\Controllers;

use App\Models\Scene;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class SessionLogController extends Controller
{
    public function __invoke(Request $request, Scene $scene): array
    {
        // The source contains private rolls, HP and GM notes. Never expose it to players.
        Gate::authorize('update', $scene);
        $d = $request->validate(['before' => 'sometimes|integer|min:1', 'after' => 'sometimes|integer|min:0', 'filter' => 'sometimes|in:all,combat,runtime']);
        $query = DB::table('combat_events')->where('scene_id', $scene->id)->whereIn('type', [
            'ability.resolved', 'gm.check', 'check.resolved', 'gm.correction', 'gm.undo', 'manual.resolved',
            'condition.applied', 'condition.removed', 'condition.immune', 'concentration.save',
            'spell.effect.ended', 'lifecycle.changed', 'lifecycle.consequence',
            'combat.started', 'combat.round', 'combat.ended', 'turn.started', 'budget.override',
            'runtime.short-rest', 'runtime.long-rest', 'runtime.spend-die', 'runtime.finish-rest', 'runtime.stabilize',
        ]);
        if (($d['filter'] ?? 'all') === 'combat') {
            $query->whereNotNull('combat_id');
        }
        if (($d['filter'] ?? 'all') === 'runtime') {
            $query->whereNull('combat_id');
        }
        if (isset($d['before'])) {
            $query->where('id', '<', $d['before']);
        }
        if (isset($d['after'])) {
            $query->where('id', '>', $d['after']);
        }
        // Ascending catch-up avoids dropping bursts larger than a page after reconnect.
        $rows = isset($d['after']) ? $query->orderBy('id')->limit(51)->get() : $query->orderByDesc('id')->limit(51)->get();
        $more = $rows->count() > 50;
        $rows = $rows->take(50);

        return ['events' => $rows->map(fn ($e) => [
            'id' => (string) $e->id, 'type' => $e->type, 'combatId' => $e->combat_id ? (string) $e->combat_id : null,
            'data' => json_decode($e->data, true), 'createdAt' => $e->created_at,
        ])->values()->all(), 'hasMore' => $more];
    }
}
