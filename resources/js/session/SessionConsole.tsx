import {
    lazy,
    Suspense,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type RefObject,
} from 'react';
import {
    ArrowLeft,
    ArrowRight,
    ListOrdered,
    Pencil,
    Play,
    Plus,
    X,
    Map,
    Film,
    BookOpen,
    Swords,
    StickyNote,
    Bookmark,
} from 'lucide-react';
import { api, commandId, type Campaign } from '../api/workspace';
import { preparation } from '../api/preparation';
import type { Member } from '../realtime/useCampaignLive';
import type { ContentTemplate } from '../api/objects';
import type { SceneStore } from '../tabletop/state/SceneStore';
import { SaveQueue } from '../tabletop/state/SaveQueue';
import { cues } from '../workspace/cues/model';
import { ConfirmDialog } from '../workspace/ConfirmDialog';
import { Dialog } from '../workspace/Dialog';
import { NameDialog } from '../workspace/NameDialog';
import {
    itemLabels,
    itemTitle,
    nextScene,
    sessions,
    type GameSession,
    type ReferenceType,
    type SessionItem,
    type SessionSummary,
} from './model';
import { ResourcePicker } from './ResourcePicker';
import { PreloadPanel } from './PreloadPanel';
const SessionPlanner = lazy(() =>
    import('./SessionPlanner').then((m) => ({ default: m.SessionPlanner })),
);
const CueLibrary = lazy(() =>
    import('../workspace/cues/CueLibrary').then((m) => ({ default: m.CueLibrary })),
);

export function SessionConsole({
    campaign,
    members,
    store,
    queue,
    liveMode,
    onMode,
    onClose,
    onNavigate,
    onPlace,
    flushRef,
}: {
    campaign: Campaign;
    members: Member[];
    store: SceneStore;
    queue: SaveQueue;
    liveMode: boolean;
    onMode: (live: boolean) => void;
    onClose: () => void;
    onNavigate: (url: string) => void;
    onPlace: (template: Pick<ContentTemplate, 'id' | 'kind' | 'name'>) => void;
    flushRef: RefObject<(() => Promise<void>) | null>;
}) {
    const [list, setList] = useState<SessionSummary[]>([]),
        [selected, setSelected] = useState('');
    const [session, setSession] = useState<GameSession | null>(null),
        [error, setError] = useState('');
    const [busy, setBusy] = useState(false),
        [refresh, setRefresh] = useState(0);
    const [create, setCreate] = useState(false),
        [editing, setEditing] = useState(false),
        [ending, setEnding] = useState(false),
        [deleting, setDeleting] = useState(false);
    const [quick, setQuick] = useState<ReferenceType | 'events' | null>(null);
    const [notesQueue] = useState(() => new SaveQueue());
    const noteState = useSyncExternalStore(notesQueue.subscribe, notesQueue.getSnapshot);
    const { scene } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const selectedRef = useRef(selected);
    useEffect(() => {
        selectedRef.current = selected;
    }, [selected]);
    useEffect(() => {
        flushRef.current = () => notesQueue.flush();
        const guard = (e: BeforeUnloadEvent) => {
            if (notesQueue.getSnapshot().status !== 'saved') {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', guard);
        return () => {
            flushRef.current = null;
            window.removeEventListener('beforeunload', guard);
        };
    }, [flushRef, notesQueue]);
    useEffect(() => {
        const abort = new AbortController();
        let pending = false;
        const load = async () => {
            if (pending) return;
            pending = true;
            try {
                const d = await sessions.list(campaign.id, abort.signal);
                if (abort.signal.aborted) return;
                setList(d.sessions);
                if (!selectedRef.current)
                    setSelected(String(d.activeId ?? d.sessions[0]?.id ?? ''));
            } catch (e) {
                if (!abort.signal.aborted) setError((e as Error).message);
            } finally {
                pending = false;
            }
        };
        void load();
        const timer = setInterval(() => void load(), 10000);
        return () => {
            abort.abort();
            clearInterval(timer);
        };
    }, [campaign.id, refresh]);
    useEffect(() => {
        if (!selected) return;
        const abort = new AbortController();
        void sessions
            .get(campaign.id, selected, abort.signal)
            .then((d) => {
                if (!abort.signal.aborted) setSession(d);
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [campaign.id, selected, refresh]);
    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        setError('');
        try {
            await notesQueue.flush();
            await queue.flush();
            await fn();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const command = async (action: string, data: object = {}) => {
        const d = await sessions.command(campaign.id, action, { sessionId: session!.id, ...data });
        setSession(d.session);
        setRefresh((n) => n + 1);
        return d.session;
    };
    const activate = async (id: string) => {
        await notesQueue.flush();
        await queue.flush();
        await api.activate(campaign.id, id);
        if (scene.id !== id) onNavigate(`/campaigns/${campaign.id}/scenes/${id}`);
    };
    const perform = async (item: SessionItem) => {
        if (!item.referenceId || item.missing) return;
        if (item.type === 'scene') await activate(item.referenceId);
        else if (item.type === 'cue') {
            await cues.command(item.sceneId!, 'start', { cueId: item.referenceId });
            setQuick('events');
        } else if (item.type === 'handout')
            await preparation.showHandout(campaign.id, item.referenceId);
        else if (item.type === 'encounter') {
            if (!scene.id || scene.id !== campaign.activeSceneId)
                throw new Error('Сначала откройте активную сцену.');
            onPlace({ id: item.referenceId, kind: 'encounter', name: item.name });
            await queue.flush();
        }
    };
    const current = session?.items.find((i) => i.id === session.currentItemId);
    const position = session?.items.findIndex((i) => i.id === session.currentItemId) ?? -1;
    const focus = (item: SessionItem) => {
        if (session?.status === 'completed') setSession({ ...session, currentItemId: item.id });
        else
            void run(async () => {
                await command('focus', { itemId: item.id });
            });
    };
    const completed = session?.status === 'completed';
    const actionLabel = {
        scene: 'Активировать сцену',
        cue: 'Запустить событие',
        handout: 'Показать игрокам',
        encounter: 'Разместить',
        note: '',
        chapter: '',
    };
    const blocked = (item: SessionItem) =>
        item.type === 'cue'
            ? campaign.activeSceneId !== item.sceneId
            : item.type === 'encounter'
              ? !scene.id || scene.id !== campaign.activeSceneId
              : false;
    const target = session ? nextScene(session)?.referenceId : null;
    return (
        <aside className="session-console panel" aria-label="Пульт сессии">
            <header>
                <div>
                    <span className="eyebrow">{liveMode ? 'РЕЖИМ СЕССИИ' : 'ПОДГОТОВКА'}</span>
                    <strong>
                        <ListOrdered size={17} />
                        {liveMode ? 'За игровым столом' : 'Сессии'}
                    </strong>
                </div>
                <button
                    className="icon-button"
                    aria-label="Закрыть сессии"
                    onClick={() => void run(async () => onClose())}
                >
                    <X size={16} />
                </button>
            </header>
            <div className="session-selector">
                <select
                    aria-label="Выбрать сессию"
                    value={selected}
                    disabled={busy}
                    onChange={(e) => {
                        const id = e.target.value;
                        if (id === selected) return;
                        void run(async () => {
                            setSession(null);
                            setSelected(id);
                        });
                    }}
                >
                    <option value="">Выберите сессию</option>
                    {list.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.status === 'active' ? '▶ ' : s.status === 'completed' ? '✓ ' : ''}
                            {s.name}
                        </option>
                    ))}
                </select>
                <button
                    className="icon-button"
                    aria-label="Создать сессию"
                    onClick={() => setCreate(true)}
                >
                    <Plus size={17} />
                </button>
            </div>
            {!session && (
                <p className="session-empty">
                    {selected
                        ? 'Открываем план…'
                        : 'Соберите сцены и важные моменты в один план. Во время игры порядок остаётся свободным.'}
                </p>
            )}
            {session && (
                <>
                    <div className="session-controls">
                        <h2>{session.name}</h2>
                        {!completed && (
                            <button
                                disabled={busy}
                                className="secondary-button"
                                onClick={() => void run(async () => setEditing(true))}
                            >
                                <Pencil size={13} />
                                Изменить план
                            </button>
                        )}
                        {session.status === 'planned' && (
                            <button
                                disabled={busy}
                                className="primary-button"
                                onClick={() =>
                                    void run(async () => {
                                        await command('start');
                                        onMode(true);
                                    })
                                }
                            >
                                <Play size={14} />
                                Начать сессию
                            </button>
                        )}
                        {session.status === 'active' && (
                            <button className="secondary-button" onClick={() => onMode(!liveMode)}>
                                {liveMode ? 'Вернуться к редактору' : 'Режим сессии'}
                            </button>
                        )}
                        {completed && (
                            <span className="hint">Завершена · план и заметки сохранены</span>
                        )}
                    </div>
                    {current && (
                        <section
                            className="session-current"
                            key={current.id}
                            data-beat-type={current.type}
                        >
                            <span className="eyebrow">
                                СЕЙЧАС · {position + 1} / {session.items.length}
                            </span>
                            <h3>{itemTitle(current)}</h3>
                            {current.notes && <p>{current.notes}</p>}
                            {current.missing ? (
                                <p className="form-error">
                                    Исходный материал удалён. Измените план или пропустите пункт.
                                </p>
                            ) : (
                                actionLabel[current.type] &&
                                !completed && (
                                    <button
                                        className="primary-button"
                                        disabled={busy || blocked(current)}
                                        onClick={() => void run(() => perform(current))}
                                    >
                                        {actionLabel[current.type]}
                                    </button>
                                )
                            )}
                            {blocked(current) && (
                                <p className="hint">
                                    {current.type === 'cue'
                                        ? 'Сначала активируйте сцену этого события.'
                                        : 'Откройте активную сцену для размещения.'}
                                </p>
                            )}
                        </section>
                    )}
                    {!completed && (
                        <div className="session-pager">
                            <button
                                disabled={busy || position <= 0}
                                onClick={() => focus(session.items[position - 1])}
                            >
                                <ArrowLeft size={14} />
                                Предыдущий
                            </button>
                            <button
                                disabled={busy || position >= session.items.length - 1}
                                onClick={() => focus(session.items[position + 1])}
                            >
                                Следующий
                                <ArrowRight size={14} />
                            </button>
                        </div>
                    )}
                    {session.items[position + 1] && (
                        <div className="session-next">
                            <span className="eyebrow">
                                ДАЛЕЕ · {itemLabels[session.items[position + 1].type]}
                            </span>
                            <strong>{itemTitle(session.items[position + 1])}</strong>
                        </div>
                    )}
                    <p className="session-focus-hint">Переход меняет только фокус плана.</p>
                    <ol className="session-run-list">
                        {session.items.map((item, index) => {
                            const BeatIcon = {
                                scene: Map,
                                cue: Film,
                                handout: BookOpen,
                                encounter: Swords,
                                note: StickyNote,
                                chapter: Bookmark,
                            }[item.type];
                            return (
                                <li
                                    key={item.id}
                                    data-beat-type={item.type}
                                    className={item.type === 'chapter' ? 'chapter' : ''}
                                >
                                    <button
                                        disabled={busy}
                                        aria-current={
                                            item.id === session.currentItemId ? 'step' : undefined
                                        }
                                        onClick={() => focus(item)}
                                    >
                                        <span
                                            className="beat-icon"
                                            title={`${index + 1} · ${itemLabels[item.type]}`}
                                        >
                                            <BeatIcon size={16} />
                                        </span>
                                        <div>
                                            <small>{itemLabels[item.type]}</small>
                                            <strong>{itemTitle(item)}</strong>
                                        </div>
                                        {item.missing && <span title="Материал удалён">!</span>}
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                    <details className="session-notes-disclosure">
                        <summary>Заметки мастера</summary>
                        <SessionNotes
                            key={session.id}
                            initial={session.notes}
                            readOnly={completed}
                            state={noteState}
                            retry={notesQueue.retry}
                            onChange={(notes) => {
                                const id = commandId(),
                                    sessionId = session.id;
                                notesQueue.enqueue(
                                    'notes',
                                    async () => {
                                        await sessions.command(
                                            campaign.id,
                                            'notes',
                                            { sessionId, notes },
                                            id,
                                        );
                                    },
                                    550,
                                );
                            }}
                        />
                    </details>
                    {!completed && (
                        <label className="check-row session-auto">
                            <input
                                type="checkbox"
                                checked={session.autoPreload}
                                disabled={busy}
                                onChange={(e) => {
                                    const enabled = e.target.checked;
                                    void run(async () => {
                                        await command('auto', { enabled });
                                    });
                                }}
                            />
                            Автоматически готовить следующую сцену
                        </label>
                    )}
                    <PreloadPanel
                        campaign={campaign}
                        members={members}
                        target={session.autoPreload && !completed ? target : null}
                        automatic={session.status === 'active' && session.autoPreload}
                        onActivate={activate}
                    />
                    <div className="session-ending">
                        {session.status === 'active' ? (
                            <button onClick={() => setEnding(true)}>Завершить сессию</button>
                        ) : (
                            <button onClick={() => setDeleting(true)}>Удалить план</button>
                        )}
                    </div>
                </>
            )}
            <nav className="session-quick" aria-label="Быстрый доступ">
                <button onClick={() => setQuick('scene')}>Сцены</button>
                <button onClick={() => setQuick('events')}>События</button>
                <button onClick={() => setQuick('handout')}>Материалы</button>
                <button onClick={() => setQuick('encounter')}>Столкновения</button>
            </nav>
            <p className="session-focus-hint">Бой, звук и события — в пульте справа от сцены.</p>
            {(error || noteState.error) && (
                <p role="alert" className="session-error">
                    {error || noteState.error}
                    <button
                        onClick={() => {
                            if (noteState.error) notesQueue.retry();
                            else {
                                setError('');
                                setRefresh((n) => n + 1);
                            }
                        }}
                    >
                        Повторить / обновить
                    </button>
                </p>
            )}
            {create && (
                <NameDialog
                    title="Создать сессию"
                    label="Название сессии"
                    onClose={() => setCreate(false)}
                    submit={async (name) => {
                        await notesQueue.flush();
                        const { session: s } = await sessions.command(campaign.id, 'create', {
                            name,
                        });
                        setSession(s);
                        setSelected(s.id);
                        setRefresh((n) => n + 1);
                        setEditing(true);
                    }}
                />
            )}
            {editing && session && (
                <Suspense fallback={<p>Открываем план…</p>}>
                    <SessionPlanner
                        campaignId={campaign.id}
                        initial={session}
                        onSaved={(s) => {
                            setSession(s);
                            setRefresh((n) => n + 1);
                        }}
                        onClose={() => setEditing(false)}
                    />
                </Suspense>
            )}
            {ending && (
                <ConfirmDialog
                    title="Завершить сессию?"
                    description="План и заметки сохранятся. Сцена, бой и музыка продолжатся без изменений."
                    buttonLabel="Завершить"
                    onClose={() => setEnding(false)}
                    submit={async () => {
                        await notesQueue.flush();
                        await command('complete');
                        onMode(false);
                    }}
                />
            )}
            {deleting && (
                <ConfirmDialog
                    title="Удалить план сессии?"
                    description="Удалятся только план и заметки этой сессии. Сцены, события и материалы останутся."
                    onClose={() => setDeleting(false)}
                    submit={async () => {
                        await sessions.command(campaign.id, 'delete', { sessionId: session!.id });
                        setSession(null);
                        setSelected('');
                        setRefresh((n) => n + 1);
                    }}
                />
            )}
            {quick && (
                <Dialog
                    title={quick === 'events' ? 'События текущей сцены' : itemLabels[quick]}
                    onClose={() => setQuick(null)}
                >
                    {quick !== 'events' && (
                        <p className="hint">
                            {quick === 'scene'
                                ? 'Выберите сцену, чтобы активировать её для игроков.'
                                : quick === 'handout'
                                  ? 'Выберите материал, чтобы показать его игрокам.'
                                  : 'Выберите столкновение, чтобы разместить его в центре текущего вида.'}
                        </p>
                    )}
                    {quick === 'events' ? (
                        scene.id ? (
                            <Suspense fallback={<p>Загрузка событий…</p>}>
                                <CueLibrary
                                    scene={scene}
                                    active={scene.id === campaign.activeSceneId}
                                />
                            </Suspense>
                        ) : (
                            <p>Сначала откройте сцену.</p>
                        )
                    ) : (
                        <ResourcePicker
                            key={quick}
                            campaignId={campaign.id}
                            type={quick}
                            onChoose={(r) =>
                                void run(async () => {
                                    await perform({
                                        id: '',
                                        type: quick,
                                        referenceId: r.id,
                                        name: r.name,
                                        title: '',
                                        notes: '',
                                        sceneId: r.sceneId,
                                        missing: false,
                                    });
                                    setQuick(null);
                                })
                            }
                        />
                    )}
                </Dialog>
            )}
        </aside>
    );
}

function SessionNotes({
    initial,
    readOnly,
    onChange,
    state,
    retry,
}: {
    initial: string;
    readOnly: boolean;
    onChange: (notes: string) => void;
    state: { status: string; error: string | null };
    retry: () => void;
}) {
    const [notes, setNotes] = useState(initial);
    return (
        <details className="session-notes" open>
            <summary>Заметки сессии</summary>
            <textarea
                aria-label="Заметки сессии"
                rows={4}
                maxLength={30000}
                readOnly={readOnly}
                value={notes}
                placeholder="Что произошло, о чём вспомнить позже…"
                onChange={(e) => {
                    setNotes(e.target.value);
                    onChange(e.target.value);
                }}
            />
            <small role="status">
                {state.status === 'saved'
                    ? 'Сохранено · только мастер'
                    : state.status === 'saving'
                      ? 'Сохранение…'
                      : 'Не сохранено'}
            </small>
            {state.error && <button onClick={retry}>Повторить сохранение</button>}
        </details>
    );
}
