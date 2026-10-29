import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import { Dialog } from './Dialog';
import { api, commandId, type Campaign } from '../api/workspace';
import { request } from '../api/client';
import { preparation, type LibraryAsset } from '../api/preparation';
import type { ContentTemplate } from '../api/objects';
import type { Scene } from '../tabletop/types/scene';
import { sessions, itemTitle, type Resource } from '../session/model';
import { audioEngine } from '../media/AudioEngine';
import { mediaApi } from '../media/model';
import type { RightPanel, WorkspaceMode } from './workspaceState';

interface Command {
    id: string;
    group: string;
    name: string;
    hint: string;
    run: (mutationId: string) => void | Promise<void>;
}
interface SearchData {
    scenes: Resource[];
    cues: Resource[];
    encounters: Resource[];
    handouts: Resource[];
    assets: LibraryAsset[];
}
const emptyData: SearchData = { scenes: [], cues: [], encounters: [], handouts: [], assets: [] };

export function CommandPalette({
    campaign,
    scene,
    onClose,
    onPanel,
    onMode,
    onNavigate,
    onPlace,
    onAsset,
    beforeAction,
    onCampaign,
}: {
    campaign: Campaign;
    scene: Scene;
    onClose: () => void;
    onPanel: (panel: RightPanel) => void;
    onMode: (mode: WorkspaceMode) => void;
    onNavigate: (url: string) => void;
    onPlace: (template: Pick<ContentTemplate, 'id' | 'kind' | 'name'>) => void;
    onAsset: (asset: LibraryAsset) => void;
    beforeAction: () => Promise<void>;
    onCampaign: (campaign: Campaign) => void;
}) {
    const [query, setQuery] = useState(''),
        [index, setIndex] = useState(0),
        [busy, setBusy] = useState(false);
    const [error, setError] = useState(''),
        [data, setData] = useState<SearchData>(emptyData);
    const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
    const [sessionCommands, setSessionCommands] = useState<
        { id: string; sessionId: string; title: string }[]
    >([]);
    const list = useRef<HTMLDivElement>(null);
    // A retry keeps both the UUID and the original command/epoch after a lost response.
    const attempt = useRef<{ command: Command; id: string } | null>(null);
    const media = useSyncExternalStore(audioEngine.subscribe, audioEngine.getSnapshot).state;
    useEffect(() => {
        const abort = new AbortController();
        const timer = setTimeout(() => {
            void Promise.all([
                sessions.resources(campaign.id, 'scene', query, 1, abort.signal),
                sessions.resources(campaign.id, 'cue', query, 1, abort.signal),
                sessions.resources(campaign.id, 'encounter', query, 1, abort.signal),
                sessions.resources(campaign.id, 'handout', query, 1, abort.signal),
                preparation.assets(
                    campaign.id,
                    { kind: '', search: query, tag: '', collection: '', sort: 'name', page: 1 },
                    abort.signal,
                ),
            ])
                .then(([scenes, cues, encounters, handouts, assets]) => {
                    if (abort.signal.aborted) return;
                    setData({
                        scenes: scenes.items,
                        cues: cues.items,
                        encounters: encounters.items,
                        handouts: handouts.items,
                        assets: assets.assets,
                    });
                    setLoadedQuery(query);
                })
                .catch((e) => {
                    if (!abort.signal.aborted) {
                        setError(e.message);
                        setLoadedQuery(query);
                    }
                });
        }, 180);
        return () => {
            abort.abort();
            clearTimeout(timer);
        };
    }, [campaign.id, query]);
    useEffect(() => {
        const abort = new AbortController();
        void sessions
            .list(campaign.id, abort.signal)
            .then(async (result) => {
                if (!result.activeId) return;
                const plan = await sessions.get(campaign.id, String(result.activeId), abort.signal);
                if (!abort.signal.aborted)
                    setSessionCommands(
                        plan.items.map((item) => ({
                            id: item.id,
                            sessionId: plan.id,
                            title: itemTitle(item),
                        })),
                    );
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [campaign.id]);
    const sendMedia = async (mutationId: string, action: string, config: object = {}) => {
        const result = await mediaApi.command(
            campaign.id,
            action,
            {
                ...config,
                sceneId: media?.sceneId,
                epoch: media?.epoch,
            },
            mutationId,
        );
        if ('revision' in result) audioEngine.hydrate(result);
    };
    const commands: Command[] = (
        [
            ['combat', 'Открыть бой'],
            ['audio', 'Звук и атмосфера'],
            ['players', 'Игроки'],
            ['triggers', 'Триггеры'],
            ['cues', 'События и очередь'],
        ] as const
    ).map(([id, name]) => ({
        id,
        name,
        group: 'Команды',
        hint: 'Открыть панель',
        run: () => onPanel(id),
    }));
    if (media?.music)
        commands.push({
            id: 'stop',
            group: 'Команды',
            name: 'Остановить музыку',
            hint: media.music.name,
            run: (mutationId) => sendMedia(mutationId, 'music.stop', { fade: 1000 }),
        });
    if (campaign.activeSceneId)
        for (const [effect, name] of [
            ['rain', 'Дождь'],
            ['snow', 'Снег'],
            ['embers', 'Угли'],
            ['haze', 'Дымка'],
        ] as const) {
            const enabled = !!media?.effects?.[effect];
            commands.push({
                id: effect,
                group: 'Команды',
                name: `${enabled ? 'Выключить' : 'Включить'} · ${name}`,
                hint: 'Атмосфера активной сцены',
                run: (mutationId) =>
                    sendMedia(mutationId, enabled ? 'atmosphere.stop' : 'atmosphere.start', {
                        effect,
                        intensity: 'medium',
                    }),
            });
        }
    const needle = query.trim().toLocaleLowerCase();
    let items = commands.filter((item) =>
        `${item.name} ${item.hint}`.toLocaleLowerCase().includes(needle),
    );
    // Never execute stale results while a newer query is in flight.
    if (loadedQuery === query)
        items = items.concat(
            data.scenes.map((item) => ({
                id: `scene-${item.id}`,
                group: 'Сцены',
                name: item.name,
                hint: 'Активировать сцену',
                run: async () => {
                    onCampaign(await api.activate(campaign.id, item.id));
                    if (scene.id !== item.id)
                        onNavigate(`/campaigns/${campaign.id}/scenes/${item.id}`);
                },
            })),
            data.cues.map((item) => ({
                id: `cue-${item.id}`,
                group: 'События',
                name: item.name,
                hint:
                    item.sceneId === campaign.activeSceneId
                        ? 'Запустить событие'
                        : 'Сначала активируйте сцену события',
                run: async (mutationId) => {
                    if (item.sceneId !== campaign.activeSceneId)
                        throw new Error('Сначала активируйте сцену этого события.');
                    await request(`/scenes/${item.sceneId}/cues/start`, 'POST', {
                        cueId: item.id,
                        clientMutationId: mutationId,
                    });
                    if (scene.id !== item.sceneId)
                        onNavigate(`/campaigns/${campaign.id}/scenes/${item.sceneId}`);
                    else onPanel('cues');
                },
            })),
            data.encounters.map((item) => ({
                id: `encounter-${item.id}`,
                group: 'Столкновения',
                name: item.name,
                hint: 'Разместить на открытой сцене',
                run: () => {
                    if (!scene.id) throw new Error('Сначала создайте сцену.');
                    onPlace({ ...item, kind: 'encounter' });
                },
            })),
            data.handouts.map((item) => ({
                id: `handout-${item.id}`,
                group: 'Раздаточные материалы',
                name: item.name,
                hint: 'Показать игрокам',
                run: async (mutationId) => {
                    await request(`/campaigns/${campaign.id}/handouts/show`, 'POST', {
                        handoutId: item.id,
                        clientMutationId: mutationId,
                    });
                },
            })),
            data.assets.map((item) => ({
                id: `asset-${item.id}`,
                group: 'Материалы',
                name: item.name,
                hint: item.kind === 'music' ? 'Включить музыку' : 'Открыть материал',
                run: async (mutationId) => {
                    if (item.kind === 'music')
                        await sendMedia(mutationId, 'music.start', {
                            assetId: item.id,
                            volume: 0.8,
                            loop: true,
                            fade: 1000,
                        });
                    else onAsset(item);
                },
            })),
        );
    items = items.concat(
        sessionCommands
            .filter((item) => item.title.toLocaleLowerCase().includes(needle))
            .map((item) => ({
                id: `session-${item.id}`,
                group: 'План сессии',
                name: item.title,
                hint: 'Перейти к пункту · без запуска',
                run: async () => {
                    await sessions.command(campaign.id, 'focus', {
                        sessionId: item.sessionId,
                        itemId: item.id,
                    });
                    onMode('session');
                },
            })),
    );
    const selected = Math.min(index, Math.max(0, items.length - 1));
    const execute = async (item: Command) => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            await beforeAction();
            if (attempt.current?.command.id !== item.id)
                attempt.current = { command: item, id: commandId() };
            await attempt.current.command.run(attempt.current.id);
            onClose();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    useEffect(() => {
        list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [selected]);
    return (
        <Dialog
            title="Поиск и команды"
            onClose={() => {
                if (!busy) onClose();
            }}
        >
            <div className="command-palette">
                <label className="command-input">
                    <Search size={20} />
                    <input
                        autoFocus
                        placeholder="Название сцены, событие или действие…"
                        aria-label="Поиск по кампании"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="command-results"
                        aria-activedescendant={
                            items[selected] ? `command-${items[selected].id}` : undefined
                        }
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setIndex(0);
                            setError('');
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                e.preventDefault();
                                setIndex(
                                    (selected + (e.key === 'ArrowDown' ? 1 : -1) + items.length) %
                                        Math.max(1, items.length),
                                );
                            }
                            if (e.key === 'Enter' && items[selected]) {
                                e.preventDefault();
                                void execute(items[selected]);
                            }
                        }}
                    />
                </label>
                {error && (
                    <p role="alert" className="form-error">
                        {error}
                    </p>
                )}
                <div
                    className="command-results"
                    id="command-results"
                    role="listbox"
                    aria-label="Результаты поиска"
                    aria-busy={loadedQuery !== query || busy}
                    ref={list}
                >
                    {items.map((item, i) => (
                        <div key={item.id}>
                            {items[i - 1]?.group !== item.group && (
                                <div className="command-group">{item.group}</div>
                            )}
                            <button
                                id={`command-${item.id}`}
                                role="option"
                                aria-selected={selected === i}
                                disabled={busy}
                                onClick={() => void execute(item)}
                                onMouseMove={() => setIndex(i)}
                            >
                                <div>
                                    <strong>{item.name}</strong>
                                    <small>{item.hint}</small>
                                </div>
                                <ArrowUpRight size={16} />
                            </button>
                        </div>
                    ))}
                    {loadedQuery !== query && <p className="hint">Ищем в кампании…</p>}
                    {!items.length && loadedQuery === query && (
                        <p className="command-empty">
                            Ничего не найдено. Попробуйте часть названия.
                        </p>
                    )}
                </div>
                <footer>
                    <span>↑ ↓ выбрать</span>
                    <span>Enter выполнить</span>
                    <span>Esc закрыть</span>
                    <small>До 40 совпадений каждого типа · уточните запрос</small>
                </footer>
            </div>
        </Dialog>
    );
}
