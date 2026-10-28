import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { SaveQueue } from '../tabletop/state/SaveQueue';
import { automation, eventLabels, type Trigger, type TriggerData } from './model';
import { TriggerEditor } from './TriggerEditor';
import { Dialog } from '../workspace/Dialog';
const CueLibrary = lazy(() =>
    import('../workspace/cues/CueLibrary').then((m) => ({ default: m.CueLibrary })),
);
export function TriggerPanel({
    store,
    queue,
    active,
    onClose,
    onUpdated,
}: {
    store: SceneStore;
    queue: SaveQueue;
    active: boolean;
    onClose: () => void;
    onUpdated: () => void;
}) {
    const { scene } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const [data, setData] = useState<TriggerData>({ triggers: [], history: [], cues: [] }),
        [editor, setEditor] = useState<Trigger | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false),
        [refresh, setRefresh] = useState(0),
        [events, setEvents] = useState(false),
        [loaded, setLoaded] = useState(false);
    useEffect(() => {
        const abort = new AbortController();
        let pending = false;
        const load = async () => {
            if (pending) return;
            pending = true;
            try {
                const d = await automation.read(scene.id!, abort.signal);
                if (!abort.signal.aborted) {
                    setData(d);
                    setLoaded(true);
                }
            } catch (e) {
                if (!abort.signal.aborted) setError((e as Error).message);
            } finally {
                pending = false;
            }
        };
        void load();
        const timer = setInterval(() => void load(), 3000);
        return () => {
            abort.abort();
            clearInterval(timer);
        };
    }, [scene.id, refresh]);
    const command = async (d: object) => {
        await queue.flush();
        const result = await automation.trigger(scene.id!, d);
        store.accept(result, true);
        setRefresh((n) => n + 1);
        onUpdated();
    };
    const run = (d: object) => {
        setBusy(true);
        setError('');
        void command(d)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
    };
    const missing = (t: Trigger) =>
        !data.cues.some((c) => c.id === t.cueId) ||
        (t.eventType.startsWith('region.') && !scene.regions?.some((r) => r.id === t.regionId)) ||
        (t.eventType.startsWith('region.') &&
            t.actorFilter === 'token' &&
            !scene.tokens.some((token) => token.id === t.actorTokenId)) ||
        (t.eventType === 'object.interact' &&
            !(t.objectType === 'token' ? scene.tokens : scene.props)?.some(
                (o) => o.id === t.objectId,
            ));
    return (
        <Dialog
            title="Триггеры сцены"
            onClose={() => {
                if (!busy && !editor) onClose();
            }}
        >
            <div className="trigger-panel">
                <p className="hint">
                    Условия запускают подготовленные события на сервере.{' '}
                    {active ? 'Эта сцена активна.' : 'Подготовка: эта сцена сейчас не активна.'}
                </p>
                <div className="trigger-panel-actions">
                    <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() =>
                            setEditor({
                                id: '',
                                name: '',
                                eventType: 'region.enter',
                                cueId: data.cues[0]?.id ?? null,
                                regionId: scene.regions?.[0]?.id ?? null,
                                objectType: 'prop',
                                objectId: null,
                                actorFilter: 'player',
                                actorTokenId: null,
                                enabled: true,
                                once: true,
                                cooldownMs: 0,
                                minimumRound: 1,
                                fireCount: 0,
                                lastFiredAt: null,
                            })
                        }
                    >
                        Добавить триггер
                    </button>
                    <button className="secondary-button" onClick={() => setEvents(!events)}>
                        События и очередь
                    </button>
                </div>
                {error && (
                    <p className="form-error" role="alert">
                        {error}
                        <button
                            onClick={() => {
                                setError('');
                                setRefresh((n) => n + 1);
                            }}
                        >
                            Обновить
                        </button>
                    </p>
                )}
                {!loaded && <p className="hint">Загрузка…</p>}
                {loaded && !data.triggers.length && (
                    <p className="trigger-empty">
                        Нарисуйте область инструментом «Области», затем выберите, какое событие
                        запустить при входе.
                    </p>
                )}
                <div className="trigger-list">
                    {data.triggers.map((t) => (
                        <article key={t.id} className={t.enabled ? '' : 'disabled'}>
                            <header>
                                <button
                                    className="trigger-name"
                                    disabled={busy}
                                    onClick={() => setEditor(t)}
                                >
                                    {t.name}
                                </button>
                                <label className="trigger-switch">
                                    <input
                                        type="checkbox"
                                        aria-label={`Включён: ${t.name}`}
                                        checked={t.enabled}
                                        disabled={busy}
                                        onChange={(e) =>
                                            run({
                                                action: 'toggle',
                                                id: t.id,
                                                enabled: e.target.checked,
                                            })
                                        }
                                    />
                                    {t.enabled ? 'Включён' : 'Выключен'}
                                </label>
                            </header>
                            <p>
                                {eventLabels[t.eventType]} →{' '}
                                {data.cues.find((c) => c.id === t.cueId)?.name ?? 'Событие удалено'}
                            </p>
                            <small>
                                {t.once
                                    ? t.fireCount
                                        ? 'Уже сработал · один раз'
                                        : 'Один раз'
                                    : 'Повторяемый'}
                                {t.cooldownMs ? ` · Пауза ${t.cooldownMs / 1000} с` : ''}
                                {t.fireCount ? ` · Запусков: ${t.fireCount}` : ''}
                            </small>
                            {missing(t) && (
                                <p className="form-error">
                                    Цель удалена. Выберите её заново в настройках.
                                </p>
                            )}
                            <footer>
                                <button disabled={busy} onClick={() => setEditor(t)}>
                                    Настроить
                                </button>
                                {!!t.fireCount && (
                                    <button
                                        disabled={busy}
                                        onClick={() => {
                                            if (
                                                confirm(
                                                    'Разрешить триггеру сработать снова? Счётчик и пауза сбросятся; записи запусков сохранятся.',
                                                )
                                            )
                                                run({ action: 'reset', id: t.id });
                                        }}
                                    >
                                        Разрешить снова
                                    </button>
                                )}
                                <button
                                    disabled={busy}
                                    onClick={() => {
                                        if (
                                            confirm(
                                                `Удалить триггер «${t.name}»? Подготовленное событие сохранится.`,
                                            )
                                        )
                                            run({ action: 'delete', id: t.id });
                                    }}
                                >
                                    Удалить
                                </button>
                            </footer>
                        </article>
                    ))}
                </div>
                {events && (
                    <section className="trigger-events">
                        <Suspense fallback={<p>Открываем события…</p>}>
                            <CueLibrary scene={scene} active={active} />
                        </Suspense>
                    </section>
                )}
                {!!data.history.length && (
                    <details className="trigger-history">
                        <summary>Последние срабатывания · {data.history.length}</summary>
                        {data.history.map((h) => (
                            <div key={h.id}>
                                <strong>
                                    {data.triggers.find((t) => t.id === String(h.trigger_id))
                                        ?.name ?? 'Триггер'}
                                </strong>
                                <span>
                                    {eventLabels[h.source_event]} · {h.fired_at}
                                </span>
                                <small>Запуск: {h.cue_run_id?.slice(0, 8) ?? 'удалён'}</small>
                            </div>
                        ))}
                    </details>
                )}
                <p className="hint">
                    Вход и выход проверяются только при сохранённом перемещении. Изменение области и
                    переподключение не запускают события.
                </p>
            </div>
            {editor && (
                <TriggerEditor
                    key={editor.id || 'new'}
                    initial={editor}
                    scene={scene}
                    cues={data.cues}
                    onClose={() => setEditor(null)}
                    onSave={(t) => command({ ...t, id: t.id || null, action: 'save' })}
                />
            )}
        </Dialog>
    );
}
