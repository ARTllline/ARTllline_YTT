import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowUp, ScrollText, X } from 'lucide-react';
import { request } from '../../api/client';
import type { Scene } from '../../tabletop/types/scene';
import type { CombatEvent } from '../combat/sessionModel';
import { eventSummary } from '../combat/CombatHistory';
import { CombatResults, RollDetail } from '../combat/CombatResults';
import '../../../css/session-log.css';

type Page = { events: CombatEvent[]; hasMore: boolean };
type Filter = 'all' | 'combat' | 'runtime';
export function mergeLog(current: CombatEvent[], incoming: CombatEvent[]) {
    return [...new Map([...current, ...incoming].map((e) => [e.id, e])).values()].sort(
        (a, b) => Number(b.id) - Number(a.id),
    );
}
function time(value: string) {
    return new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
}

export function SessionLog({ scene }: { scene: Scene }) {
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState<Filter>('all');
    const [events, setEvents] = useState<CombatEvent[]>([]);
    const [more, setMore] = useState(false);
    const [busy, setBusy] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState('');
    const [unread, setUnread] = useState(0);
    const [recent, setRecent] = useState<CombatEvent | null>(null);
    const root = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const latest = useRef<string | null>(null);
    const openRef = useRef(open);
    useEffect(() => {
        openRef.current = open;
    }, [open]);

    useEffect(() => {
        const abort = new AbortController();
        let running = false;
        const refresh = async () => {
            if (running || document.hidden) return;
            running = true;
            try {
                let hasMore = true;
                while (hasMore && !abort.signal.aborted) {
                    const first = latest.current === null;
                    const page = await request<Page>(
                        `/scenes/${scene.id}/session-log?filter=${filter}${first ? '' : `&after=${latest.current}`}`,
                        'GET',
                        undefined,
                        abort.signal,
                    );
                    if (abort.signal.aborted) return;
                    setEvents((old) => mergeLog(old, page.events));
                    setLoaded(true);
                    if (first) setMore(page.hasMore);
                    if (page.events.length) {
                        const newest = mergeLog([], page.events)[0];
                        latest.current = newest.id;
                        if (!first) {
                            if (!openRef.current) {
                                setRecent(newest);
                                setUnread((n) => n + page.events.length);
                            }
                        }
                    } else if (first) latest.current = '0';
                    hasMore = !first && page.hasMore;
                }
                setError('');
            } catch (e) {
                if (!abort.signal.aborted) setError((e as Error).message);
            } finally {
                running = false;
            }
        };
        const debounce = setTimeout(() => void refresh(), 180);
        // Revision is the primary signal. Poll/focus also catches receipts committed after
        // the scene broadcast, or a reconnect with no subsequent scene command.
        const interval = setInterval(() => void refresh(), 6000);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            abort.abort();
            clearTimeout(debounce);
            clearInterval(interval);
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [scene.id, scene.revision, filter]);

    useEffect(() => {
        if (!recent) return;
        const timer = setTimeout(() => setRecent(null), 14000);
        return () => clearTimeout(timer);
    }, [recent]);
    const close = useCallback(() => {
        setOpen(false);
        if (filter !== 'all') {
            latest.current = null;
            setEvents([]);
            setMore(false);
            setLoaded(false);
            setFilter('all');
        }
        button.current?.focus();
    }, [filter]);
    useEffect(() => {
        if (!open) return;
        const dismiss = (e: PointerEvent) => {
            if (!root.current?.contains(e.target as Node)) close();
        };
        document.addEventListener('pointerdown', dismiss);
        return () => document.removeEventListener('pointerdown', dismiss);
    }, [open, close]);

    const older = async () => {
        setBusy(true);
        try {
            const page = await request<Page>(
                `/scenes/${scene.id}/session-log?filter=${filter}&before=${events.at(-1)?.id}`,
            );
            setEvents((old) => mergeLog(old, page.events));
            setMore(page.hasMore);
            setError('');
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div
            className="session-log"
            ref={root}
            onKeyDown={(e) => {
                if (e.key === 'Escape' && open) {
                    e.stopPropagation();
                    close();
                }
            }}
        >
            <button
                className="scene-switch session-log-entry"
                ref={button}
                aria-expanded={open}
                aria-controls="session-live-feed"
                onClick={() => {
                    if (open) close();
                    else setOpen(true);
                    setUnread(0);
                    setRecent(null);
                }}
            >
                <ScrollText size={16} />
                <span>Журнал</span>
                {!!unread && <b className="session-log-unread">{unread > 99 ? '99+' : unread}</b>}
            </button>
            {!open && recent && (
                <button
                    className="session-log-recent"
                    title={eventSummary(recent, scene)}
                    onClick={() => {
                        setOpen(true);
                        setUnread(0);
                        setRecent(null);
                    }}
                >
                    <Activity size={13} />
                    <span>{eventSummary(recent, scene)}</span>
                </button>
            )}
            {open && (
                <section
                    className="session-live-feed"
                    id="session-live-feed"
                    aria-label="Live Feed · журнал сессии"
                >
                    <header>
                        <div>
                            <span className="eyebrow">ЗА СТОЛОМ · ТОЛЬКО ГМ</span>
                            <h2>Live Feed</h2>
                        </div>
                        <button className="icon-button" aria-label="Закрыть журнал" onClick={close}>
                            <X size={18} />
                        </button>
                    </header>
                    <nav aria-label="Фильтр журнала">
                        {(['all', 'combat', 'runtime'] as const).map((f, i) => (
                            <button
                                key={f}
                                disabled={busy}
                                aria-pressed={filter === f}
                                onClick={() => {
                                    if (filter === f) return;
                                    latest.current = null;
                                    setEvents([]);
                                    setMore(false);
                                    setError('');
                                    setFilter(f);
                                    list.current?.scrollTo({ top: 0 });
                                }}
                            >
                                {['Всё', 'В бою', 'Вне боя'][i]}
                            </button>
                        ))}
                        <button
                            title="К свежим событиям"
                            aria-label="К свежим событиям"
                            onClick={() => list.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                        >
                            <ArrowUp size={14} />
                        </button>
                    </nav>
                    {error && <p role="alert">Не удалось обновить журнал: {error}</p>}
                    <div className="session-feed-list" ref={list}>
                        {!events.length && (
                            <p className="session-feed-empty">
                                {!loaded
                                    ? 'Загружаем события…'
                                    : 'Пока тихо. Значимые события появятся здесь.'}
                            </p>
                        )}
                        {events.map((event, index) => {
                            const date = time(event.createdAt);
                            const day = date.toLocaleDateString('ru', {
                                day: 'numeric',
                                month: 'long',
                            });
                            const previousDay = index
                                ? time(events[index - 1].createdAt).toDateString()
                                : '';
                            return (
                                <div key={event.id}>
                                    {date.toDateString() !== previousDay && (
                                        <div className="session-feed-date">{day}</div>
                                    )}
                                    <details
                                        className={`session-feed-event ${event.combatId ? 'in-combat' : 'in-runtime'}`}
                                    >
                                        <summary>
                                            <div className="session-feed-meta">
                                                <span>{event.combatId ? 'Бой' : 'За столом'}</span>
                                                <time dateTime={date.toISOString()}>
                                                    {date.toLocaleTimeString('ru', {
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </time>
                                            </div>
                                            <p>{eventSummary(event, scene)}</p>
                                        </summary>
                                        <div className="session-feed-detail">
                                            {event.data.result && (
                                                <CombatResults
                                                    result={event.data.result}
                                                    scene={scene}
                                                />
                                            )}
                                            <RollDetail
                                                roll={event.data.roll ?? event.data.save}
                                                breakdown={event.data.provenance?.breakdown}
                                            />
                                            {event.data.outcomes?.map((o) => (
                                                <div key={o.tokenId}>
                                                    <strong>{o.name}</strong>
                                                    <RollDetail
                                                        roll={o.roll}
                                                        breakdown={o.provenance?.breakdown}
                                                    />
                                                </div>
                                            ))}
                                            {event.data.summary?.map((s) => (
                                                <p key={s.name}>
                                                    <strong>{s.name}</strong> ·{' '}
                                                    {s.changes.join(' · ') ||
                                                        'Без изменений ресурсов'}
                                                </p>
                                            ))}
                                            {event.data.note && (
                                                <p>Решение ГМ: {event.data.note}</p>
                                            )}
                                            {event.data.before?.conditions &&
                                                event.data.after?.conditions && (
                                                    <p>
                                                        {event.data.before.conditions
                                                            .map((c) => c.label)
                                                            .join(', ') || 'Без состояний'}{' '}
                                                        →{' '}
                                                        {event.data.after.conditions
                                                            .map((c) => c.label)
                                                            .join(', ') || 'Без состояний'}
                                                    </p>
                                                )}
                                            <small>
                                                Подтверждено за столом · {date.toLocaleString('ru')}
                                            </small>
                                        </div>
                                    </details>
                                </div>
                            );
                        })}
                        {more && (
                            <button
                                className="session-feed-older"
                                disabled={busy}
                                onClick={() => void older()}
                            >
                                {busy ? 'Загружаем…' : 'Более ранние события'}
                            </button>
                        )}
                    </div>
                    <footer>Последние события сверху · нажмите запись для деталей</footer>
                </section>
            )}
        </div>
    );
}
