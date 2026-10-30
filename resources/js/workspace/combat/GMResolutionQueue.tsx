import { useEffect, useState } from 'react';
import { ApiError, request } from '../../api/client';
import { api, commandId } from '../../api/workspace';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import { CombatResults } from './CombatResults';
import { TokenCombatControls } from './TokenCombatControls';
import type { SessionState, ResolutionTask } from './sessionModel';
export function GMResolutionQueue({ store, disabled }: { store: SceneStore; disabled: boolean }) {
    const { scene } = store.getSnapshot();
    const [data, setData] = useState<SessionState>({ pending: [], undoId: null });
    const [taskId, setTaskId] = useState<string | null>(null),
        [targetId, setTargetId] = useState('');
    const [note, setNote] = useState(''),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const [pending, setPending] = useState<Record<string, unknown> | null>(null);
    useEffect(() => {
        if (store.role !== 'gm') return;
        const abort = new AbortController();
        const timer = setTimeout(() => {
            void request<SessionState>(
                `/scenes/${scene.id}/combat/session`,
                'GET',
                undefined,
                abort.signal,
            )
                .then((r) => {
                    setData(r);
                    setError('');
                })
                .catch((e: Error) => {
                    if (!abort.signal.aborted) setError(e.message);
                });
        }, 100);
        return () => {
            clearTimeout(timer);
            abort.abort();
        };
    }, [store, scene.id, scene.revision, refresh]);
    const run = async (body: Record<string, unknown>) => {
        setBusy(true);
        setPending(body);
        setError('');
        try {
            await request(`/scenes/${scene.id}/combat/session`, 'POST', body);
            setPending(null);
            store.reconcile(await api.snapshot(scene.id!));
            setRefresh((n) => n + 1);
        } catch (e) {
            setError((e as Error).message);
            if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
                setPending(null);
                store.reconcile(await api.snapshot(scene.id!));
            }
        } finally {
            setBusy(false);
        }
    };
    const task = data.pending.find((t) => t.id === taskId);
    const target = scene.tokens.find((t) => t.id === targetId);
    const open = (t: ResolutionTask) => {
        setTaskId(t.id);
        setNote('');
        setTargetId(
            t.result.outcomes?.[0]?.tokenId ??
                (t.result.target?.kind === 'token' ? t.result.target.id : ''),
        );
    };
    if (store.role !== 'gm') return null;
    return (
        <section className="gm-resolutions" aria-label="Ручное разрешение">
            <div className="resolution-heading">
                <strong>
                    Ручные шаги <b>{data.pending.length}</b>
                </strong>
                <button
                    disabled={disabled || busy || !!pending || !data.undoId}
                    title="Отменить последнюю безопасную коррекцию HP/состояний, пока сцена не изменилась"
                    onClick={() =>
                        void run({
                            action: 'undo',
                            correctionId: data.undoId,
                            clientMutationId: commandId(),
                        })
                    }
                >
                    ↶ Коррекция
                </button>
            </div>
            <details
                className="pending-resolution-list"
                open={data.pending.length > 0 && data.pending.length <= 3 ? true : undefined}
            >
                <summary>Ожидают решения ({data.pending.length})</summary>
                {data.pending.map((t) => (
                    <button
                        className="resolution-item"
                        key={t.id}
                        aria-expanded={taskId === t.id}
                        onClick={() => (taskId === t.id ? setTaskId(null) : open(t))}
                    >
                        <span>⚠ {t.result.abilityName}</span>
                        <small>
                            {t.result.actorName} · {t.result.coverage}
                        </small>
                    </button>
                ))}
            </details>
            {task && (
                <div className="manual-resolver">
                    <strong>
                        {task.result.abilityName} · {task.result.coverage}
                    </strong>
                    <p className="hint">
                        Уже выполнено:{' '}
                        {(
                            {
                                action: 'действие',
                                bonus_action: 'бонусное действие',
                                reaction: 'реакция',
                                free: 'свободное действие',
                                outside_combat: 'сотворение вне боя',
                            } as Record<string, string>
                        )[task.result.gmContext?.activation ?? ''] ?? 'стоимость действия'}
                        {task.result.gmContext?.slotSpent
                            ? ` · ячейка ${task.result.gmContext.slotSpent}`
                            : ''}
                        . Броски и последствия ниже уже применены.
                    </p>
                    <CombatResults result={task.result} scene={scene} />
                    <p className="manual-remaining">
                        Осталось ГМ:{' '}
                        {task.result.gmContext?.remaining ??
                            'Разрешить ручные последствия по описанию заклинания.'}
                    </p>
                    <details>
                        <summary>Описание заклинания</summary>
                        <p className="spell-source-text">
                            {task.result.gmContext?.description ??
                                'Описание доступно в кампанийной копии заклинания.'}
                        </p>
                    </details>
                    <div className="manual-targets">
                        {Array.from(
                            new Set([
                                ...(task.result.outcomes?.map((o) => o.tokenId) ?? []),
                                ...(task.result.target?.kind === 'token'
                                    ? [task.result.target.id]
                                    : []),
                                ...(task.result.gmContext?.sourceTokenId
                                    ? [task.result.gmContext.sourceTokenId]
                                    : []),
                            ]),
                        ).map((id) => (
                            <button
                                key={id}
                                aria-pressed={targetId === id}
                                onClick={() => {
                                    setTargetId(id);
                                    store.select(id);
                                }}
                            >
                                {scene.tokens.find((t) => t.id === id)?.name ?? 'Удалённая цель'}
                            </button>
                        ))}
                        <button
                            onClick={() => setTargetId(store.getSnapshot().selectedIds[0] ?? '')}
                        >
                            Выбранный на карте
                        </button>
                    </div>
                    {target && (
                        <details className="manual-primitives">
                            <summary>HP / состояния · {target.name}</summary>
                            <TokenCombatControls
                                key={target.id}
                                token={target}
                                store={store}
                                disabled={disabled || busy || !!pending}
                            />
                            <button onClick={() => store.select(target.id)}>
                                Выбрать для перемещения на карте
                            </button>
                        </details>
                    )}
                    <label>
                        Заметка ГМ
                        <textarea
                            aria-label="Итог ручного разрешения"
                            value={note}
                            maxLength={2000}
                            onChange={(e) => setNote(e.target.value)}
                        />
                    </label>
                    <div className="combat-row-actions">
                        <button
                            disabled={disabled || busy || !!pending}
                            className="primary-button"
                            onClick={() =>
                                void run({
                                    action: 'resolve',
                                    executionId: task.id,
                                    status: 'resolved',
                                    note,
                                    clientMutationId: commandId(),
                                })
                            }
                        >
                            Шаг выполнен
                        </button>
                        <button
                            disabled={disabled || busy || !!pending}
                            title="Закрыть без применения дополнительных последствий"
                            onClick={() =>
                                void run({
                                    action: 'resolve',
                                    executionId: task.id,
                                    status: 'dismissed',
                                    note,
                                    clientMutationId: commandId(),
                                })
                            }
                        >
                            Закрыть без эффекта
                        </button>
                    </div>
                </div>
            )}
            {error && <p role="alert">{error}</p>}
            {pending && !busy && (
                <button onClick={() => void run(pending)}>Повторить команду с тем же ID</button>
            )}
        </section>
    );
}
