import { lazy, Suspense, useEffect, useState } from 'react';
import { Film, Play, Square, Plus, Pencil, Trash2, RotateCcw } from 'lucide-react';
import type { Scene } from '../../tabletop/types/scene';
import { actionLabels, cues, statusLabels, type Cue, type CueRun } from './model';
const CueEditor = lazy(() => import('./CueEditor').then((m) => ({ default: m.CueEditor })));

export function CueLibrary({
    scene,
    active,
    live = false,
}: {
    scene: Scene;
    active: boolean;
    live?: boolean;
}) {
    const [data, setData] = useState<{ cues: Cue[]; runs: CueRun[]; pendingCount: number }>({
        cues: [],
        runs: [],
        pendingCount: 0,
    });
    const [editor, setEditor] = useState<Cue | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false),
        [refresh, setRefresh] = useState(0),
        [loaded, setLoaded] = useState(false);
    const [search, setSearch] = useState('');
    useEffect(() => {
        const abort = new AbortController();
        let pending = false;
        const load = (full = false) => {
            if (pending) return;
            pending = true;
            void (full ? cues.list(scene.id!, abort.signal) : cues.runs(scene.id!, abort.signal))
                .then((d) => {
                    if (!abort.signal.aborted) {
                        setData((previous) => ({
                            cues: d.cues ?? previous.cues,
                            runs: d.runs,
                            pendingCount: d.pendingCount,
                        }));
                        setLoaded(true);
                    }
                })
                .catch((e) => {
                    if (!abort.signal.aborted) setError(e.message);
                })
                .finally(() => {
                    pending = false;
                });
        };
        load(true);
        const timer = setInterval(() => load(), 1500);
        return () => {
            abort.abort();
            clearInterval(timer);
        };
    }, [scene.id, refresh]);
    const execute = (action: string, body: object) => {
        setBusy(true);
        setError('');
        void cues
            .command(scene.id!, action, body)
            .then(() => setRefresh((n) => n + 1))
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
    };
    const running = data.runs.find((r) => ['queued', 'running', 'failed'].includes(r.status));
    const position = running?.displayPosition ?? running?.position ?? 0;
    return (
        <div className="cue-library">
            <div className="section-heading">
                <span>
                    <Film size={14} /> СОБЫТИЯ
                </span>
                {!live && (
                    <button
                        className="icon-button"
                        aria-label="Создать событие"
                        onClick={() =>
                            setEditor({
                                name: '',
                                description: '',
                                sort_order: data.cues.length,
                                steps: [],
                            })
                        }
                    >
                        <Plus size={16} />
                    </button>
                )}
            </div>
            {!live && (
                <p className="hint cue-intro">
                    Подготовьте момент.
                    <br />
                    Запустите одним действием.
                </p>
            )}
            <input
                className="cue-search"
                aria-label="Найти событие"
                placeholder="Найти событие…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
            />
            {!active && (
                <p className="cue-inactive">Для запуска активируйте эту сцену для игроков.</p>
            )}
            {error && (
                <p role="alert" className="cue-error">
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
            {running && (
                <section className={`cue-running ${running.status}`} aria-live="polite">
                    <span className="eyebrow">{statusLabels[running.status]}</span>
                    <strong>{running.name}</strong>
                    <progress value={position} max={running.steps.length} />
                    <span>
                        {Math.min(position + 1, running.steps.length)} / {running.steps.length} ·{' '}
                        {running.steps[position]
                            ? actionLabels[running.steps[position].type]
                            : 'Завершение'}
                    </span>
                    {running.error && (
                        <p role="alert">
                            Ошибка на шаге {running.position + 1}: {running.error}
                        </p>
                    )}
                    {running.status === 'failed' && (
                        <button
                            className="secondary-button"
                            disabled={busy || !active}
                            onClick={() => execute('retry', { runId: running.id })}
                        >
                            <RotateCcw size={14} /> Повторить шаг
                        </button>
                    )}
                    {live ? (
                        <p className="hint">Подготовьте события в разделе «Подготовка».</p>
                    ) : (
                        <button
                            className="secondary-button"
                            disabled={busy}
                            onClick={() => execute('cancel', { runId: running.id })}
                        >
                            <Square size={13} /> Остановить
                        </button>
                    )}
                    <small>Выполненные изменения останутся. Будущие действия будут отменены.</small>
                    <small>Если очередь не движется, проверьте рабочий процесс сервера.</small>
                    {data.pendingCount > 1 && (
                        <small>
                            Ожидают следом: {data.pendingCount - 1}. События выполняются по очереди;
                            ошибка приостанавливает следующие.
                        </small>
                    )}
                </section>
            )}
            <div className="cue-card-list">
                {data.cues
                    .filter((cue) =>
                        cue.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                    )
                    .map((cue) => {
                        const last = data.runs.find((r) => r.cue_id === cue.id);
                        return (
                            <article className="cue-card" key={cue.id}>
                                <div className="cue-card-title">
                                    <Film size={18} />
                                    <h3>{cue.name}</h3>
                                    {!live && (
                                        <button
                                            className="icon-button"
                                            aria-label={`Редактировать ${cue.name}`}
                                            onClick={() => setEditor(cue)}
                                        >
                                            <Pencil size={14} />
                                        </button>
                                    )}
                                </div>
                                {cue.description && <p>{cue.description}</p>}
                                <div className="cue-card-meta">
                                    <span>{cue.steps.length} действий</span>
                                    {last && <small>{statusLabels[last.status]}</small>}
                                </div>
                                <div className="cue-card-actions">
                                    <button
                                        className="primary-button"
                                        title={
                                            !active
                                                ? 'Сначала активируйте сцену'
                                                : running
                                                  ? 'Сначала завершите текущее событие'
                                                  : 'Запустить событие'
                                        }
                                        disabled={busy || !active || !!running}
                                        onClick={() => execute('start', { cueId: cue.id })}
                                    >
                                        <Play size={13} /> Запустить
                                    </button>
                                    {!live && (
                                        <button
                                            className="icon-button"
                                            aria-label={`Удалить ${cue.name}`}
                                            onClick={() => {
                                                if (
                                                    window.confirm(
                                                        `Удалить событие «${cue.name}»? Выполняющийся план сохранится.`,
                                                    )
                                                )
                                                    execute('delete', { cueId: cue.id });
                                            }}
                                            disabled={busy}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            </article>
                        );
                    })}
            </div>
            {loaded && !data.cues.length && (
                <div className="cue-empty-detail">
                    <Film size={28} />
                    <p>Засада, появление босса или тихое открытие тайны.</p>
                    <button
                        className="secondary-button"
                        onClick={() =>
                            setEditor({ name: '', description: '', sort_order: 0, steps: [] })
                        }
                    >
                        Создать первое событие
                    </button>
                </div>
            )}
            {!loaded && <p className="hint">Загрузка событий…</p>}
            {editor && (
                <Suspense fallback={<p>Открываем редактор…</p>}>
                    <CueEditor
                        cue={editor}
                        scene={scene}
                        onClose={() => setEditor(null)}
                        onSaved={() => {
                            setEditor(null);
                            setRefresh((n) => n + 1);
                        }}
                    />
                </Suspense>
            )}
        </div>
    );
}
