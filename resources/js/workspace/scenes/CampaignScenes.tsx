import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowLeft, Copy, Image, Plus, Settings2, Play, Map } from 'lucide-react';
import { api, commandId, type Campaign } from '../../api/workspace';
import { request } from '../../api/client';
import type { Scene } from '../../tabletop/types/scene';
import { SceneSettings } from './SceneSettings';
import { Dialog } from '../Dialog';
import '../../../css/campaign-scenes.css';

const ScenePreview = lazy(() =>
    import('./ScenePreview').then((m) => ({ default: m.ScenePreview })),
);
interface Summary {
    id: string;
    name: string;
    width: number;
    height: number;
    tokenCount: number;
    propCount: number;
    thumbnailUrl: string | null;
}
export function CampaignScenes({ campaign: initial }: { campaign: Campaign }) {
    const [campaign, setCampaign] = useState(initial);
    const [scenes, setScenes] = useState<Summary[] | null>(null);
    const [selected, setSelected] = useState(initial.scenes[0]?.id ?? '');
    const [preview, setPreview] = useState<Scene>();
    const [search, setSearch] = useState(''),
        [error, setError] = useState('');
    const [revision, setRevision] = useState(0),
        [busy, setBusy] = useState(false);
    const [settings, setSettings] = useState<'new' | Scene | null>(null);
    const [copy, setCopy] = useState<Summary>(),
        [copyName, setCopyName] = useState('');
    useEffect(() => {
        const abort = new AbortController();
        void request<{ scenes: Summary[] }>(
            `/campaigns/${campaign.id}/scenes`,
            'GET',
            undefined,
            abort.signal,
        )
            .then((r) => setScenes(r.scenes))
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [campaign.id, revision]);
    useEffect(() => {
        if (!selected) return;
        const abort = new AbortController();
        void api
            .snapshot(selected, abort.signal)
            .then((s) => {
                if (!abort.signal.aborted) setPreview(s);
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [selected, revision]);
    const run = async (action: () => Promise<void>) => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            await action();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const openSession = (id: string) =>
        run(async () => {
            const current = await api.campaign(campaign.id);
            if (current.activeSceneId !== id) setCampaign(await api.activate(campaign.id, id));
            location.assign(`/campaigns/${campaign.id}/scenes/${id}?mode=session`);
        });
    const shown = preview?.id === selected ? preview : undefined;
    const summary = scenes?.find((s) => s.id === selected);
    return (
        <div className="project-screen campaign-scenes-screen">
            <header className="topbar">
                <a className="brand" href="/">
                    YTT /
                </a>
                <a className="secondary-button" href="/">
                    <ArrowLeft size={16} /> Кампании
                </a>
                <span className="muted">{campaign.name}</span>
                <div className="topbar-actions">
                    <a className="secondary-button" href="/control/characters">
                        Глобальные библиотеки
                    </a>
                </div>
            </header>
            <main className="campaign-scenes-main">
                <div className="project-title">
                    <div>
                        <span className="eyebrow">{campaign.name} / ПОДГОТОВКА</span>
                        <h1>Сцены кампании</h1>
                    </div>
                    <button className="primary-button" onClick={() => setSettings('new')}>
                        <Plus size={16} /> Создать сцену
                    </button>
                </div>
                <p className="muted">
                    Подготовьте место, выберите карту и расставьте участников. Затем откройте сцену
                    в Session.
                </p>
                {error && (
                    <p className="form-error" role="alert">
                        {error}
                    </p>
                )}
                <div className="campaign-scenes-layout">
                    <section className="campaign-scenes-list" aria-label="Список сцен">
                        <label className="field">
                            <span>Найти сцену</span>
                            <input
                                type="search"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Название сцены…"
                            />
                        </label>
                        {scenes === null && <p role="status">Загружаем сцены…</p>}
                        {scenes?.length === 0 && (
                            <div className="campaign-scenes-empty">
                                <Map size={38} />
                                <h2>Место для новой истории</h2>
                                <p>
                                    Создайте первую сцену — с картой из Assets или с пустой сеткой.
                                </p>
                                <button
                                    className="primary-button"
                                    onClick={() => setSettings('new')}
                                >
                                    Создать сцену
                                </button>
                            </div>
                        )}
                        {scenes
                            ?.filter((s) =>
                                s.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                            )
                            .map((s) => (
                                <button
                                    className="campaign-scene-card"
                                    key={s.id}
                                    aria-pressed={selected === s.id}
                                    onClick={() => {
                                        setSelected(s.id);
                                        setError('');
                                    }}
                                >
                                    <div className="campaign-scene-card-art">
                                        {s.thumbnailUrl ? (
                                            <img src={s.thumbnailUrl} alt="" loading="lazy" />
                                        ) : (
                                            <Image size={30} />
                                        )}
                                    </div>
                                    <div>
                                        <strong>{s.name}</strong>
                                        <small>
                                            {s.tokenCount} токенов · {s.propCount} объектов
                                        </small>
                                        <small>
                                            {s.width} × {s.height}
                                            {campaign.activeSceneId === s.id
                                                ? ' · В эфире'
                                                : ' · Подготовка'}
                                        </small>
                                    </div>
                                </button>
                            ))}
                        {!!scenes?.length &&
                            !scenes.some((s) =>
                                s.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                            ) && <p className="hint">Сцен с таким названием нет.</p>}
                    </section>
                    <section className="campaign-scene-detail" aria-label="Выбранная сцена">
                        {summary ? (
                            <>
                                <div className="campaign-scene-detail-heading">
                                    <div>
                                        <span className="eyebrow">SCENE PREVIEW</span>
                                        <h2>{summary.name}</h2>
                                    </div>
                                    <button
                                        className="secondary-button"
                                        disabled={busy || !shown}
                                        onClick={() => setSettings(shown!)}
                                    >
                                        <Settings2 size={16} /> Параметры
                                    </button>
                                    <button
                                        className="icon-button"
                                        title="Дублировать сцену"
                                        aria-label="Дублировать сцену"
                                        disabled={busy}
                                        onClick={() => {
                                            setCopy(summary);
                                            setCopyName(`${summary.name.slice(0, 110)} · копия`);
                                        }}
                                    >
                                        <Copy size={17} />
                                    </button>
                                </div>
                                {shown ? (
                                    <Suspense
                                        fallback={
                                            <div className="campaign-scene-preview">
                                                Загружаем preview…
                                            </div>
                                        }
                                    >
                                        <ScenePreview
                                            key={`${shown.id}:${shown.revision}`}
                                            scene={shown}
                                        />
                                    </Suspense>
                                ) : (
                                    <div className="campaign-scene-preview" role="status">
                                        Загружаем preview…
                                    </div>
                                )}
                                <p className="hint">
                                    На столе: карта, персонажи, NPC и объекты. Изменения подготовки
                                    сохраняются автоматически. Подготовка активной сцены видна
                                    подключённым игрокам.
                                </p>
                                <div className="campaign-scene-actions">
                                    <a
                                        className="primary-button"
                                        href={`/campaigns/${campaign.id}/scenes/${summary.id}?mode=prepare`}
                                    >
                                        Открыть для подготовки
                                    </a>
                                    <button
                                        className="secondary-button"
                                        disabled={busy}
                                        onClick={() => void openSession(summary.id)}
                                    >
                                        <Play size={16} />{' '}
                                        {campaign.activeSceneId === summary.id
                                            ? 'Открыть в Session'
                                            : 'Запустить / открыть в Session'}
                                    </button>
                                </div>
                                <small className="muted">
                                    Запуск делает сцену активной для игроков. Используется текущий
                                    Session Workspace.
                                </small>
                            </>
                        ) : (
                            <div className="campaign-scenes-empty">
                                <Map size={42} />
                                <h2>Сначала выберите место</h2>
                                <p>Здесь появится preview вашей сцены.</p>
                            </div>
                        )}
                    </section>
                </div>
            </main>
            {settings && (
                <SceneSettings
                    campaignId={campaign.id}
                    scene={settings === 'new' ? undefined : settings}
                    onClose={() => {
                        setSettings(null);
                        setRevision((r) => r + 1);
                    }}
                    onSaved={(id) => {
                        if (settings === 'new')
                            location.assign(`/campaigns/${campaign.id}/scenes/${id}?mode=prepare`);
                        else {
                            setSettings(null);
                            setRevision((r) => r + 1);
                        }
                    }}
                />
            )}
            {copy && (
                <Dialog title="Дублировать сцену" onClose={() => !busy && setCopy(undefined)}>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void run(async () => {
                                const result = await request<{ id: string }>(
                                    `/scenes/${copy.id}/duplicate`,
                                    'POST',
                                    { name: copyName.trim(), clientMutationId: commandId() },
                                );
                                setSelected(result.id);
                                setCopy(undefined);
                                setRevision((r) => r + 1);
                            });
                        }}
                    >
                        <p className="hint">
                            Карта, сетка, fog, заметки и размещение копируются. Герои остаются
                            связанными; NPC получают независимые копии. Бой, добыча, события и
                            автоматизация не копируются.
                        </p>
                        <label className="field">
                            <span>Название копии</span>
                            <input
                                value={copyName}
                                required
                                maxLength={120}
                                disabled={busy}
                                onChange={(e) => setCopyName(e.target.value)}
                            />
                        </label>
                        {error && (
                            <p role="alert" className="form-error">
                                {error}
                            </p>
                        )}
                        <button className="primary-button" disabled={busy || !copyName.trim()}>
                            {busy ? 'Копируем…' : 'Создать копию'}
                        </button>
                    </form>
                </Dialog>
            )}
        </div>
    );
}
