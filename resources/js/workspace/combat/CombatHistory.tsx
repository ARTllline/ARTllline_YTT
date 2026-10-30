import { useState } from 'react';
import { request } from '../../api/client';
const labels: Record<string, string> = {
    'turn.started': 'Начало хода',
    'action.spent': 'Действие потрачено',
    'bonus_action.spent': 'Бонусное действие потрачено',
    'reaction.spent': 'Реакция потрачена',
    'movement.spent': 'Перемещение',
    'attack.roll': 'Атака',
    'check.roll': 'Проверка',
    'save.roll': 'Спасбросок',
    damage: 'Урон',
    'condition.applied': 'Состояние применено',
    'condition.removed': 'Состояние снято',
    'condition.immune': 'Иммунитет к состоянию',
    'budget.override': 'Бюджет изменён ГМ',
};
export function CombatHistory({ sceneId }: { sceneId: string }) {
    const [events, setEvents] = useState<
        { id: string; type: string; data: unknown; createdAt: string }[]
    >([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const load = async () => {
        setBusy(true);
        try {
            setEvents(
                (await request<{ events: typeof events }>(`/scenes/${sceneId}/combat/history`))
                    .events,
            );
            setError('');
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <details
            className="combat-history"
            onToggle={(e) => {
                if (e.currentTarget.open) void load();
            }}
        >
            <summary>История боя · броски и урон</summary>
            <button disabled={busy} onClick={() => void load()}>
                Обновить
            </button>
            {error && <p role="alert">{error}</p>}
            {!events.length && !busy && <p className="hint">Событий пока нет</p>}
            {events.map((e) => (
                <details key={e.id}>
                    <summary>
                        {labels[e.type] ?? e.type} · {e.createdAt}
                    </summary>
                    <pre>{JSON.stringify(e.data, null, 2)}</pre>
                </details>
            ))}
        </details>
    );
}
