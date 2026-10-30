import { useEffect, useState } from 'react';
import { request } from '../../api/client';
import type { Scene } from '../../tabletop/types/scene';
import { conditionLabel } from '../../i18n';
import { CombatResults, RollDetail } from './CombatResults';
import type { CombatEvent } from './sessionModel';
export type LogFilter = 'all' | 'combat' | 'rolls' | 'hp' | 'conditions' | 'system';
export function logMatches(type: string, filter: LogFilter) {
    if (filter === 'rolls')
        return type.endsWith('.roll') || type === 'gm.check' || type === 'concentration.save';
    if (filter === 'hp') return type === 'gm.correction' || type === 'ability.resolved';
    if (filter === 'conditions')
        return type.startsWith('condition.') || type.startsWith('spell.effect');
    if (filter === 'system')
        return ['turn.started', 'budget.override', 'gm.undo', 'manual.resolved'].includes(type);
    if (filter === 'combat')
        return ['ability.resolved', 'turn.started', 'concentration.save'].includes(type);
    return ![
        'movement.spent',
        'action.spent',
        'bonus_action.spent',
        'reaction.spent',
        'damage',
        'attack.roll',
        'save.roll',
        'check.roll',
    ].includes(type);
}
export function eventSummary(e: CombatEvent, scene: Scene) {
    const d = e.data;
    const token = scene.tokens.find((t) => t.id === String(d.tokenId ?? d.targetId ?? d.actorId));
    const name = d.name ?? token?.name ?? 'Участник';
    if (e.type === 'ability.resolved') {
        const r = d.result,
            roll = r?.roll;
        const target =
            r?.outcomes?.length === 1
                ? (scene.tokens.find((t) => t.id === r.outcomes![0].tokenId)?.name ??
                  'удалённая цель')
                : r?.outcomes?.length
                  ? `целей: ${r.outcomes.length}`
                  : '';
        const damage = r?.outcomes?.reduce((n, o) => n + o.damage, 0) ?? 0;
        return `${d.actorName}${target ? ' → ' + target : ''} · ${d.abilityName}${roll ? ` — ${roll.total}${roll.dc !== undefined ? ` vs ${r?.category === 'attack' ? 'AC' : 'Сл'} ${roll.dc}` : ''} · ${r?.success ? (r.category === 'attack' ? 'попадание' : 'успех') : r?.category === 'attack' ? 'промах' : 'провал'}` : ''}${damage ? ` · урон ${damage}` : ''}${r?.healing ? ` · лечение +${r.healing}` : ''}`;
    }
    if (e.type === 'lifecycle.changed') {
        const labels: Record<string, string> = {
            alive: 'В сознании',
            dying: 'Без сознания · Death Saves',
            stable: 'Стабилен',
            dead: 'Мёртв',
            defeated: 'Побеждён',
            unconscious: 'Без сознания',
        };
        return `${name} · ${labels[d.after?.status ?? ''] ?? ''}${d.cause === 'death_save' ? ` · Death Save ${d.roll?.total} · ${d.roll?.success ? 'успех' : 'провал'} · ${d.after?.successes} / ${d.after?.failures}` : d.cause === 'damage_at_zero' ? ' · урон при 0 HP · провалы ' + d.after?.failures : d.cause === 'massive_damage' ? ' · мгновенная смерть: массивный урон' : d.cause === 'exhaustion' ? ' · Exhaustion 6' : ''}`;
    }
    if (e.type === 'lifecycle.consequence') return `${name} · ${d.abilityName} → ручной шаг ГМ`;
    if (e.type === 'turn.started') return `Раунд ${d.round} · ход ${name}`;
    if (e.type === 'gm.correction')
        return d.before?.hp !== d.after?.hp
            ? `ГМ · ${name}: ${d.before?.hp} → ${d.after?.hp} HP`
            : `ГМ · ${name}: состояния изменены`;
    if (e.type === 'gm.undo') return `ГМ · отмена коррекции · ${name}`;
    if (e.type === 'budget.override') return `ГМ · ресурсы хода · ${name}`;
    if (e.type === 'manual.resolved')
        return `${d.abilityName} · ${d.status === 'dismissed' ? 'закрыто без эффекта' : 'ручной шаг завершён'}`;
    if (e.type === 'gm.check')
        return `ГМ · ${d.stat?.toUpperCase()} · целей: ${d.outcomes?.length}`;
    if (e.type === 'concentration.save')
        return `${name} · концентрация ${d.spell}: ${d.roll?.success ? 'сохранена' : 'прервана'}`;
    if (e.type === 'spell.effect.ended') return `${d.spell} · эффект завершён (${d.cause})`;
    if (e.type.startsWith('condition.'))
        return `${name} · ${conditionLabel({ key: d.key ?? null, label: d.key ?? '' })} · ${e.type === 'condition.applied' ? 'применено' : e.type === 'condition.immune' ? 'иммунитет' : d.reason === 'duration' ? 'срок истёк' : 'снято'}`;
    return `${d.abilityName ?? name} · ${d.roll?.total ?? d.save?.total ?? ''}`;
}
export function CombatHistory({
    sceneId,
    revision,
    scene,
}: {
    sceneId: string;
    revision?: number;
    scene: Scene;
}) {
    const [events, setEvents] = useState<CombatEvent[]>([]),
        [filter, setFilter] = useState<LogFilter>('all');
    const [error, setError] = useState(''),
        [open, setOpen] = useState(false),
        [refresh, setRefresh] = useState(0);
    useEffect(() => {
        if (!open) return;
        const abort = new AbortController();
        const timeout = setTimeout(() => {
            void request<{ events: CombatEvent[] }>(
                `/scenes/${sceneId}/combat/history`,
                'GET',
                undefined,
                abort.signal,
            )
                .then((r) => {
                    setEvents(r.events);
                    setError('');
                })
                .catch((e: Error) => {
                    if (!abort.signal.aborted) setError(e.message);
                });
        }, 120);
        return () => {
            abort.abort();
            clearTimeout(timeout);
        };
    }, [sceneId, revision, open, refresh]);
    return (
        <details className="combat-history" onToggle={(e) => setOpen(e.currentTarget.open)}>
            <summary>Журнал сессии · только ГМ</summary>
            <div className="combat-log-filters">
                {(['all', 'combat', 'rolls', 'hp', 'conditions', 'system'] as const).map((f, i) => (
                    <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                        {['Всё', 'Бой', 'Броски', 'HP', 'Состояния', 'Система'][i]}
                    </button>
                ))}
                <button title="Обновить журнал" onClick={() => setRefresh(refresh + 1)}>
                    ↻
                </button>
            </div>
            {error && <p role="alert">{error}</p>}
            {!events.length && <p className="hint">Событий пока нет</p>}
            <div className="combat-log-entries">
                {events
                    .filter((e) => logMatches(e.type, filter))
                    .map((e) => (
                        <details key={e.id} className="combat-event">
                            <summary>
                                {eventSummary(e, scene)}
                                <time>
                                    {new Date(
                                        e.createdAt.replace(' ', 'T') +
                                            (e.createdAt.includes('T') ? '' : 'Z'),
                                    ).toLocaleTimeString('ru', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                </time>
                            </summary>
                            {e.data.result && (
                                <CombatResults result={e.data.result} scene={scene} />
                            )}
                            <RollDetail
                                roll={e.data.roll ?? e.data.save}
                                breakdown={e.data.provenance?.breakdown}
                            />
                            {e.data.outcomes?.map((o) => (
                                <div key={o.tokenId}>
                                    <strong>{o.name}</strong>
                                    <RollDetail roll={o.roll} breakdown={o.provenance?.breakdown} />
                                </div>
                            ))}
                            {e.data.changes &&
                                Object.entries(e.data.changes).map(([key, v]) => (
                                    <p key={key}>
                                        {
                                            (
                                                {
                                                    action_available: 'Действие',
                                                    bonus_available: 'Бонус',
                                                    reaction_available: 'Реакция',
                                                    movement_spent: 'Потрачено ft',
                                                } as Record<string, string>
                                            )[key]
                                        }
                                        : {String(v)}
                                    </p>
                                ))}
                            {e.data.before && e.data.after && (
                                <p>
                                    {e.data.before.conditions.map((c) => c.label).join(', ') ||
                                        'Без состояний'}{' '}
                                    →{' '}
                                    {e.data.after.conditions.map((c) => c.label).join(', ') ||
                                        'Без состояний'}
                                </p>
                            )}
                            {e.data.note && <p>{e.data.note}</p>}
                            <small>
                                Событие #{e.id} · {e.type}
                            </small>
                        </details>
                    ))}
            </div>
        </details>
    );
}
