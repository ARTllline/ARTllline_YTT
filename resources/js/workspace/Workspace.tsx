import { t } from '../i18n';
import { currentTokenId } from '../tabletop/types/combat';
import { RadialMenu } from './radial/RadialMenu';
import { leaveSurface } from './ui/motion';
import { DropMarker } from './assets/DropMarker';
import { useLiveMedia } from '../media/useLiveMedia';
import { SelectionControls } from './objects/SelectionControls';
import { TEMPLATE_MIME, readTemplateDrag } from './objects/TemplateLibrary';
import type { ContentTemplate } from '../api/objects';
import {
    lazy,
    Suspense,
    useEffect,
    useRef,
    useState,
    useReducer,
    useSyncExternalStore,
} from 'react';
import {
    Box,
    ChevronRight,
    Play,
    PanelLeftOpen,
    Maximize,
    Minus,
    Plus,
    Keyboard,
    X,
    ImagePlus,
    LogOut,
    StickyNote,
    EyeOff,
} from 'lucide-react';
import { preparation, type LibraryAsset, type AssetKind } from '../api/preparation';
import { ASSET_MIME, readAssetDrag } from './assets/assetDrag';
import { AssetLibrary, AssetDetails } from './assets/LazyAssets';
import { Dialog } from './Dialog';
import { SceneStore } from '../tabletop/state/SceneStore';
import { api, type User, type Campaign } from '../api/workspace';
import { ScenePersistence } from '../tabletop/state/ScenePersistence';
import { SaveQueue } from '../tabletop/state/SaveQueue';
import { NameDialog } from './NameDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { snapPoint } from '../tabletop/utils/coordinates';
import type { TabletopRenderer } from '../tabletop/renderer/TabletopRenderer';
import type { Tool, Scene } from '../tabletop/types/scene';
import { Sidebar } from './Sidebar';
import { Tabletop } from './Tabletop';
import { Toolbar } from './Toolbar';
import { useCampaignLive } from '../realtime/useCampaignLive';
import { useSceneLive } from '../realtime/useSceneLive';
import { ConnectionBadge } from './PlayersPanel';
import { NavigationRail, LiveDock } from './WorkspaceNavigation';
import { WorkspaceDock } from './WorkspaceDock';
import { PanelGuard } from './ui/PanelGuard';
import { useWorkspaceSelection } from './useWorkspaceSelection';
import {
    contextualPanel,
    initialWorkspace,
    workspaceReducer,
    type WorkspaceMode,
    type RightPanel,
} from './workspaceState';
import { Search, Users, Settings2, Expand } from 'lucide-react';
const CommandPalette = lazy(() =>
    import('./CommandPalette').then((m) => ({ default: m.CommandPalette })),
);

const SessionConsole = lazy(() =>
    import('../session/SessionConsole').then((m) => ({ default: m.SessionConsole })),
);
export function Workspace({
    user,
    campaign: initialCampaign,
    initialScene,
}: {
    user: User;
    campaign: Campaign;
    initialScene?: Scene;
}) {
    const [campaign, setCampaign] = useState(initialCampaign);
    const [workspace, dispatch] = useReducer(workspaceReducer, initialWorkspace, (initial) => {
        try {
            return localStorage.getItem(`ytt.session-mode.${initialCampaign.id}`) === 'true'
                ? { ...initial, mode: 'session' as const, left: 'session' as const }
                : initial;
        } catch {
            return initial;
        }
    });
    const sessionMode = workspace.mode === 'session';
    const sessionOpen = workspace.left === 'session';
    const sessionFlush = useRef<(() => Promise<void>) | null>(null);
    const panelGuard = useRef('');
    const [commandOpen, setCommandOpen] = useState(false);
    const [sessionView, setSessionView] = useState(0);
    const changeMode = (mode: WorkspaceMode) =>
        void run(async () => {
            if (panelGuard.current) throw new Error(panelGuard.current);
            await sessionFlush.current?.();
            leaveSurface('.workspace-body > .workspace-left');
            leaveSurface('.workspace-body > .workspace-dock');
            dispatch({ type: 'mode', mode });
            if (mode === 'session') renderer.current?.setTool('select');
            try {
                localStorage.setItem(`ytt.session-mode.${campaign.id}`, String(mode === 'session'));
            } catch {
                /* Optional preference. */
            }
        });
    const changeSessionMode = (value: boolean) => changeMode(value ? 'session' : 'prepare');
    const live = useCampaignLive(campaign.id, setCampaign);
    const media = useLiveMedia(
        campaign.id,
        user.id,
        live.echo,
        live.connection,
        campaign.activeSceneId,
        campaign.liveRevision,
    );
    // Construct the bound pair together: StrictMode may evaluate this twice,
    // and a discarded adapter must never replace the live store's command sink.
    const [{ store, queue }] = useState(() => {
        const store = new SceneStore(
            initialScene ?? {
                width: 1440,
                height: 1080,
                grid: { size: 60, offset: { x: 0, y: 0 }, visible: true, snap: true },
                tokens: [],
            },
        );
        const queue = initialScene?.id
            ? new ScenePersistence(store, initialScene.id).queue
            : new SaveQueue();
        return { store, queue };
    });
    useEffect(() => {
        store.spatial.configure(
            { id: user.id, name: user.name },
            campaign.activeSceneId === initialScene?.id,
            campaign.liveRevision,
        );
    }, [
        store,
        user.id,
        user.name,
        campaign.activeSceneId,
        campaign.liveRevision,
        initialScene?.id,
    ]);
    const save = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
    const syncStatus = useSceneLive(
        live.echo,
        initialScene?.id ? `campaign.${campaign.id}.scene.${initialScene.id}.gm` : null,
        store,
        queue,
        live.connection,
    );
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const { scene } = snapshot;
    const selectionKey = useWorkspaceSelection(store);
    const rightPanel =
        workspace.left && !sessionMode ? null : contextualPanel(workspace, selectionKey);
    const openRight = (panel: RightPanel) =>
        void run(async () => {
            if (panelGuard.current) throw new Error(panelGuard.current);
            if (window.innerWidth <= 1100) await sessionFlush.current?.();
            leaveSurface('.workspace-body > .workspace-dock');
            dispatch({ type: 'right', panel, compact: window.innerWidth <= 1100 });
        });
    const closeRight = () => {
        if (panelGuard.current) {
            setError(panelGuard.current);
            return;
        }
        leaveSurface('.workspace-body > .workspace-dock');
        dispatch({ type: 'close-right', selection: selectionKey });
    };
    useEffect(() => {
        dispatch({ type: 'selection', key: selectionKey });
    }, [selectionKey]);
    const tool = useSyncExternalStore(store.spatial.subscribe, store.spatial.getTool);
    const [modal, setModal] = useState<
        | 'createScene'
        | 'renameScene'
        | 'renameCampaign'
        | 'deleteScene'
        | 'deleteToken'
        | 'reloadSaved'
        | null
    >(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [templateRefresh, setTemplateRefresh] = useState(0);
    const placeTemplate = (
        template: Pick<ContentTemplate, 'id' | 'kind' | 'name'>,
        point = renderer.current?.center() ?? { x: scene.width / 2, y: scene.height / 2 },
    ) => {
        if (scene.id)
            store.objectCommand({
                endpoint: 'spawn',
                data: { templateId: template.id, ...snapPoint(point, scene.grid) },
                ...(template.kind === 'encounter' ? { encounter: template.name } : {}),
            });
    };
    const [dropping, setDropping] = useState(false);
    const [dropHint, setDropHint] = useState(t('Drop to choose how to use this image'));
    const [placed, setPlaced] = useState('');
    useEffect(() => {
        if (!placed) return;
        const timer = setTimeout(() => setPlaced(''), 2200);
        return () => clearTimeout(timer);
    }, [placed]);
    const [replaceMap, setReplaceMap] = useState<LibraryAsset | null>(null);
    const [fileDrop, setFileDrop] = useState<{
        file: File;
        point: { x: number; y: number };
    } | null>(null);
    const [picker, setPicker] = useState<{ kind: AssetKind; tokenId?: string } | null>(null);
    const [handoutAsset, setHandoutAsset] = useState<LibraryAsset | null>(null);
    const activeName = campaign.scenes.find((item) => item.id === campaign.activeSceneId)?.name;
    const run = async (action: () => Promise<void>) => {
        setError('');
        setBusy(true);
        try {
            await action();
        } catch (error) {
            setError((error as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const navigate = (url: string) => {
        void run(async () => {
            if (panelGuard.current) throw new Error(panelGuard.current);
            await sessionFlush.current?.();
            await queue.flush();
            location.assign(url);
        });
    };
    const uploadMap = (file: File) => {
        void run(async () => {
            if (!scene.id) return;
            await queue.flush();
            const asset = await preparation.upload(campaign.id, file, 'map');
            if (scene.map) setReplaceMap(asset);
            else await placeMap(asset);
        });
    };
    const uploadToken = (id: string, file: File) => {
        void run(async () => {
            await queue.flush();
            const image = await api.upload(campaign.id, file, 'token');
            store.updateToken(id, { image });
            await queue.flush();
        });
    };
    const renderer = useRef<TabletopRenderer | null>(null);
    const placeMap = async (asset: LibraryAsset) => {
        await queue.flush();
        const ratio = Math.min(scene.width / asset.width, scene.height / asset.height);
        store.setMap({
            asset,
            x: 0,
            y: 0,
            width: asset.width * ratio,
            height: asset.height * ratio,
        });
        await queue.flush();
    };
    const placeAsset = (
        asset: LibraryAsset,
        target = {
            point: renderer.current?.center() ?? { x: scene.width / 2, y: scene.height / 2 },
            tokenId: null as string | null,
        },
    ) => {
        setPlaced('');
        if (asset.kind === 'prop' && scene.id) {
            store.objectCommand({
                endpoint: 'props',
                data: {
                    action: 'create',
                    assetId: asset.id,
                    ...snapPoint(target.point, scene.grid),
                },
            });
            void run(async () => {
                await queue.flush();
                setPlaced(`${asset.name} · на сцене`);
            });
            return;
        }
        if (asset.kind === 'handout') {
            setHandoutAsset(asset);
            return;
        }
        if (!scene.id) {
            setError(t('Create a scene before placing an asset.'));
            return;
        }
        if (asset.kind === 'map' && scene.map) {
            setReplaceMap(asset);
            return;
        }
        return run(async () => {
            await queue.flush();
            if (asset.kind === 'map') await placeMap(asset);
            else if (target.tokenId) {
                store.updateToken(target.tokenId, { image: asset });
                await queue.flush();
            } else {
                const result = await api.createToken(
                    scene.id!,
                    snapPoint(target.point, scene.grid),
                    asset,
                );
                store.addToken(result.token!, result.revision);
            }
            setPlaced(`${asset.name} · на сцене`);
        });
    };
    const [zoom, setZoom] = useState(100);
    const help = useRef<HTMLDialogElement>(null);
    const allowExit = useRef(false);
    useEffect(() => {
        document.title = `YTT · ${scene.name ?? campaign.name}`;
    }, [scene.name, campaign.name]);
    useEffect(() => {
        const guard = (event: BeforeUnloadEvent) => {
            if (!allowExit.current && queue.getSnapshot().status !== 'saved') {
                event.preventDefault();
                event.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', guard);
        return () => window.removeEventListener('beforeunload', guard);
    }, [queue]);
    const toggleLibrary = () =>
        void run(async () => {
            if (panelGuard.current) throw new Error(panelGuard.current);
            await sessionFlush.current?.();
            dispatch({
                type: 'left',
                panel: workspace.left ? null : sessionMode ? 'session' : 'scenes',
            });
        });
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            if (
                (event.ctrlKey || event.metaKey) &&
                event.code === 'KeyK' &&
                !document.querySelector('dialog[open]')
            ) {
                event.preventDefault();
                setCommandOpen(true);
            }
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, []);
    const changeTool = (next: Tool) => {
        renderer.current?.setTool(next);
        if (next === 'region') openRight('region');
    };
    return (
        <div
            className={`workspace redesigned-workspace mode-${workspace.mode} ${sessionMode ? 'session-mode' : ''}`}
            onKeyDownCapture={(event) => {
                if (
                    event.key !== 'Escape' ||
                    document.querySelector('dialog[open]') ||
                    (event.target as HTMLElement).closest(
                        'input, textarea, select, [contenteditable="true"]',
                    )
                )
                    return;
                if (rightPanel && workspace.right !== 'context') {
                    event.stopPropagation();
                    closeRight();
                } else if (workspace.left) {
                    event.stopPropagation();
                    toggleLibrary();
                }
            }}
        >
            <header className="topbar">
                <a
                    className="brand"
                    href="/"
                    onClick={(event) => {
                        event.preventDefault();
                        navigate('/');
                    }}
                    aria-label={t('YTT home')}
                >
                    <Box size={25} />
                    <strong>
                        YTT<span> / </span>
                    </strong>
                </a>
                <div className="breadcrumb">
                    <button onClick={() => navigate('/')}>{campaign.name}</button>
                    <ChevronRight size={13} />
                    <button className="breadcrumb-scene" onClick={toggleLibrary}>
                        {scene.name ?? t('New workspace')}
                    </button>
                </div>
                <div className="topbar-actions">
                    <button
                        className="command-launch"
                        title="Поиск и команды · Ctrl/Cmd+K"
                        aria-label="Поиск и команды"
                        onClick={() => setCommandOpen(true)}
                    >
                        <Search size={16} />
                        <span>Найти или выполнить…</span>
                        <kbd>Ctrl K</kbd>
                    </button>
                    <ConnectionBadge state={live.connection} />
                    <button
                        className="players-summary"
                        title="Игроки за столом"
                        onClick={() => openRight('players')}
                    >
                        <Users size={16} />
                        <span>{live.members.length}</span>
                    </button>
                    <button
                        className="present-button"
                        disabled={!scene.id || busy}
                        title={
                            campaign.activeSceneId === scene.id
                                ? t('Deactivate this scene')
                                : t('Set the active scene independently from editing')
                        }
                        onClick={() =>
                            void run(async () => {
                                await queue.flush();
                                setCampaign(
                                    await api.activate(
                                        campaign.id,
                                        campaign.activeSceneId === scene.id ? null : scene.id!,
                                    ),
                                );
                            })
                        }
                    >
                        <Play size={13} fill="currentColor" />{' '}
                        {campaign.activeSceneId === scene.id ? t('Deactivate') : t('Activate')}
                    </button>
                </div>
            </header>
            <div
                className={`workspace-body ${workspace.left ? 'has-left' : ''} ${rightPanel ? 'has-right' : ''}`}
            >
                <NavigationRail
                    mode={workspace.mode}
                    onMode={changeMode}
                    onSettings={() => openRight('settings')}
                />
                {workspace.left && (
                    <div className="workspace-left">
                        {sessionOpen && (
                            <Suspense
                                fallback={
                                    <aside className="session-console panel">
                                        Открываем сессии…
                                    </aside>
                                }
                            >
                                <SessionConsole
                                    key={sessionView}
                                    campaign={campaign}
                                    members={live.members}
                                    store={store}
                                    queue={queue}
                                    liveMode={sessionMode}
                                    onMode={changeSessionMode}
                                    onClose={() => dispatch({ type: 'left', panel: null })}
                                    onNavigate={navigate}
                                    onPlace={placeTemplate}
                                    flushRef={sessionFlush}
                                />
                            </Suspense>
                        )}
                        {workspace.left && !sessionOpen && (
                            <Sidebar
                                store={store}
                                campaign={campaign}
                                onClose={() => dispatch({ type: 'left', panel: null })}
                                onNavigate={navigate}
                                onCreate={() => setModal('createScene')}
                                onRename={() => setModal('renameScene')}
                                onDelete={() => setModal('deleteScene')}
                                panel={workspace.left!}
                                onPanel={(panel) => dispatch({ type: 'left', panel })}
                                onAutomation={() => openRight('triggers')}
                                onUseAsset={placeAsset}
                                onUseTemplate={placeTemplate}
                                templateRefresh={templateRefresh}
                            />
                        )}
                    </div>
                )}
                <main
                    className="tabletop"
                    aria-label={t('Tabletop workspace')}
                    onDragOver={(event) => {
                        if (
                            !event.dataTransfer.types.includes('Files') &&
                            !event.dataTransfer.types.includes(ASSET_MIME) &&
                            !event.dataTransfer.types.includes(TEMPLATE_MIME)
                        )
                            return;
                        event.preventDefault();
                        const target = renderer.current?.dropTarget(event.clientX, event.clientY);
                        setDropHint(
                            event.dataTransfer.types.includes(TEMPLATE_MIME)
                                ? t('Place the saved group here')
                                : event.dataTransfer.types.includes('application/x-ytt-prop')
                                  ? t('Place an object here')
                                  : event.dataTransfer.types.includes('Files')
                                    ? t('Drop to choose: map, token or library')
                                    : event.dataTransfer.types.includes('application/x-ytt-map')
                                      ? scene.map
                                          ? t('Drop to replace the map — confirmation follows')
                                          : t('Drop to place the scene map')
                                      : event.dataTransfer.types.includes(
                                              'application/x-ytt-handout',
                                          )
                                        ? t('Drop to prepare and preview handout')
                                        : target?.tokenId
                                          ? t('replaceImage', {
                                                name:
                                                    scene.tokens.find(
                                                        (token) => token.id === target.tokenId,
                                                    )?.name ?? t('selected token'),
                                            })
                                          : t('Create a token here'),
                        );
                        if (scene.id && !busy) setDropping(true);
                    }}
                    onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node))
                            setDropping(false);
                    }}
                    onDrop={(event) => {
                        event.preventDefault();
                        setDropping(false);
                        const file = event.dataTransfer.files[0];
                        const target = renderer.current?.dropTarget(event.clientX, event.clientY);
                        if (busy || !target) return;
                        if (file && scene.id) {
                            setFileDrop({ file, point: target.point });
                            return;
                        }
                        const template = readTemplateDrag(
                            event.dataTransfer.getData(TEMPLATE_MIME),
                        );
                        if (template) {
                            placeTemplate(template, target.point);
                            return;
                        }
                        const asset = readAssetDrag(event.dataTransfer.getData(ASSET_MIME));
                        if (asset) placeAsset(asset, target);
                    }}
                >
                    {scene.id && <Tabletop store={store} rendererRef={renderer} onZoom={setZoom} />}
                    <DropMarker />
                    {placed && (
                        <div className="placement-feedback" role="status" key={placed}>
                            ✓ {placed}
                        </div>
                    )}
                    {scene.id && (
                        <RadialMenu
                            store={store}
                            queue={queue}
                            renderer={renderer}
                            onPanel={async (panel) => {
                                if (panelGuard.current) throw new Error(panelGuard.current);
                                await sessionFlush.current?.();
                                dispatch({
                                    type: 'right',
                                    panel,
                                    force: true,
                                    compact: window.innerWidth <= 1100,
                                });
                            }}
                        />
                    )}
                    {scene.id && (
                        <SelectionControls
                            store={store}
                            queue={queue}
                            campaignId={campaign.id}
                            onSaved={() => setTemplateRefresh((n) => n + 1)}
                        />
                    )}
                    {!scene.id ? (
                        <div className="canvas-empty">
                            <span className="eyebrow"> {t('YOUR FIRST SCENE')} </span>
                            <h2> {t('A world begins with a place.')} </h2>
                            <p>
                                {' '}
                                {t(
                                    'Create a scene, bring in a map, and make room for your cast.',
                                )}{' '}
                            </p>
                            <button
                                className="primary-button"
                                onClick={() => setModal('createScene')}
                            >
                                <Plus size={16} /> {t('Create scene')}{' '}
                            </button>
                        </div>
                    ) : (
                        !scene.map &&
                        scene.tokens.length === 0 &&
                        !scene.props?.length &&
                        !scene.notes?.length &&
                        !scene.regions?.length &&
                        tool === 'select' && (
                            <div className="canvas-empty map-empty">
                                <ImagePlus size={27} />
                                <h2> {t('Set the scene.')} </h2>
                                <p>
                                    {' '}
                                    {t('Drop a battle map here or upload an image.')} <br />{' '}
                                    {t('You can also start with tokens on the grid.')}{' '}
                                </p>
                                <label className="upload-button">
                                    <ImagePlus size={15} />
                                    {busy ? t('Uploading…') : t('Upload battle map')}
                                    <input
                                        type="file"
                                        aria-label={t('Upload first battle map')}
                                        accept="image/png,image/jpeg,image/webp"
                                        disabled={busy}
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            if (file) uploadMap(file);
                                            event.target.value = '';
                                        }}
                                    />
                                </label>
                            </div>
                        )
                    )}
                    {dropping && <div className="drop-overlay">{dropHint}</div>}
                    <div className="canvas-topline">
                        <button
                            className="scene-switch"
                            onClick={toggleLibrary}
                            aria-expanded={!!workspace.left}
                            title={
                                sessionMode
                                    ? 'Открыть / закрыть план сессии'
                                    : 'Открыть / закрыть сцены'
                            }
                        >
                            <PanelLeftOpen size={16} />
                            <span>{sessionMode ? 'План сессии' : 'Сцены'}</span>
                        </button>
                        <div className="scene-state">
                            <i
                                className={campaign.activeSceneId === scene.id ? 'status-dot' : ''}
                            />
                            {campaign.activeSceneId === scene.id
                                ? 'В ЭФИРЕ'
                                : 'ПОДГОТОВЛЕННАЯ СЦЕНА'}
                            {activeName && campaign.activeSceneId !== scene.id && (
                                <span>Игроки: {activeName}</span>
                            )}
                        </div>
                    </div>
                    {scene.id && (
                        <>
                            <Toolbar
                                store={store}
                                onTool={changeTool}
                                preparation={workspace.mode !== 'session'}
                                dockedRegions
                            />
                            {!sessionMode && (
                                <div className="scene-quick-actions">
                                    <button
                                        className="secondary-button"
                                        title={t('Place a private GM note')}
                                        onClick={() => {
                                            store.select(null);
                                            changeTool('note');
                                        }}
                                    >
                                        <StickyNote size={14} /> {t('Note')}{' '}
                                    </button>
                                    <button
                                        className="icon-button surface"
                                        title={t('Show / hide GM notes')}
                                        aria-label={t('Show GM Notes')}
                                        aria-pressed={store.getSnapshot().showNotes !== false}
                                        onClick={() => store.toggleNotes()}
                                    >
                                        <EyeOff size={14} />
                                    </button>
                                    <button
                                        className="secondary-button"
                                        disabled={busy}
                                        onClick={() =>
                                            void run(async () => {
                                                await queue.flush();
                                                const result = await api.createToken(
                                                    scene.id!,
                                                    snapPoint(
                                                        renderer.current?.center() ?? {
                                                            x: scene.width / 2,
                                                            y: scene.height / 2,
                                                        },
                                                        scene.grid,
                                                    ),
                                                );
                                                store.addToken(result.token!, result.revision);
                                                dispatch({ type: 'right', panel: 'context' });
                                            })
                                        }
                                    >
                                        <Plus size={14} /> {t('Add token')}{' '}
                                    </button>
                                    <button
                                        className="secondary-button"
                                        onClick={() => {
                                            store.select(null);
                                            openRight('scene');
                                        }}
                                    >
                                        {' '}
                                        {t('Scene setup')}{' '}
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                    <LiveDock
                        panel={rightPanel}
                        currentName={
                            scene.tokens.find((token) => token.id === currentTokenId(scene.combat))
                                ?.name
                        }
                        round={scene.combat?.status === 'active' ? scene.combat.round : undefined}
                        onPanel={openRight}
                    />
                    <div className="canvas-bottomline">
                        <span className="canvas-tip">
                            <kbd>Space</kbd> {t('+ drag to pan')} <span>·</span>{' '}
                            {t('Scroll to zoom')}{' '}
                        </span>
                        <div className="zoom-control">
                            <button
                                aria-label={t('Zoom out')}
                                title={t('Zoom out')}
                                onClick={() => renderer.current?.zoom(1 / 1.2)}
                            >
                                <Minus size={14} />
                            </button>
                            <output aria-label={t('Zoom level')}>{zoom}%</output>
                            <button
                                aria-label={t('Zoom in')}
                                title={t('Zoom in')}
                                onClick={() => renderer.current?.zoom(1.2)}
                            >
                                <Plus size={14} />
                            </button>
                            <i />
                            <button
                                aria-label={t('Fit scene')}
                                title={t('Fit scene to viewport')}
                                onClick={() => renderer.current?.fit()}
                            >
                                <Maximize size={14} />
                            </button>
                            <button
                                title="Полный экран"
                                aria-label="Полный экран"
                                onClick={() =>
                                    void (
                                        document.fullscreenElement
                                            ? document.exitFullscreen()
                                            : document.documentElement.requestFullscreen()
                                    ).catch(() => setError('Браузер не разрешил полный экран.'))
                                }
                            >
                                <Expand size={14} />
                            </button>
                        </div>
                    </div>
                </main>
                {rightPanel && (
                    <PanelGuard.Provider value={panelGuard}>
                        <WorkspaceDock
                            panel={rightPanel}
                            queue={queue}
                            members={live.members}
                            connection={live.connection}
                            echo={live.echo}
                            userId={user.id}
                            syncError={media.syncError}
                            inspector={{
                                combatBusy: save.status !== 'saved',
                                store,
                                campaign,
                                uploadMap,
                                uploadToken,
                                busy,
                                deleteToken: () => setModal('deleteToken'),
                                onClose: closeRight,
                                chooseImage: (kind, tokenId) => setPicker({ kind, tokenId }),
                            }}
                            settings={
                                <div className="workspace-settings">
                                    <strong>{campaign.name}</strong>
                                    <button onClick={() => navigate('/')}>Сменить кампанию</button>
                                    <button onClick={() => setModal('renameCampaign')}>
                                        Переименовать кампанию
                                    </button>
                                    <button
                                        onClick={() => {
                                            store.select(null);
                                            openRight('scene');
                                        }}
                                    >
                                        <Settings2 size={15} />
                                        Настройки сцены
                                    </button>
                                    <button onClick={() => help.current?.showModal()}>
                                        Горячие клавиши
                                    </button>
                                    <button
                                        onClick={() =>
                                            void run(async () => {
                                                await queue.flush();
                                                await sessionFlush.current?.();
                                                await api.logout();
                                                location.assign('/login');
                                            })
                                        }
                                    >
                                        <LogOut size={15} />
                                        Выйти · {user.name}
                                    </button>
                                </div>
                            }
                        />
                    </PanelGuard.Provider>
                )}
            </div>
            <footer className="statusbar">
                <span>
                    <i className="status-dot" /> {t('GM WORKSPACE')}{' '}
                    {scene.id && <b>r{scene.revision ?? 0}</b>}
                </span>
                <span className={`session-note save-${save.status}`} role="status">
                    {busy
                        ? t('Working…')
                        : save.status === 'saved'
                          ? scene.id && syncStatus
                              ? syncStatus
                              : t('Saved')
                          : save.status === 'saving'
                            ? t('Saving…')
                            : t('Save failed')}
                </span>
                {save.status === 'failed' && (
                    <button onClick={queue.retry}> {t('Retry save')} </button>
                )}
                <button onClick={() => help.current?.showModal()}>
                    <Keyboard size={14} /> {t('Shortcuts')}{' '}
                </button>
            </footer>
            {commandOpen && (
                <Suspense fallback={null}>
                    <CommandPalette
                        campaign={campaign}
                        scene={scene}
                        onClose={() => setCommandOpen(false)}
                        onPanel={(panel) =>
                            dispatch({
                                type: 'right',
                                panel,
                                force: true,
                                compact: window.innerWidth <= 1100,
                            })
                        }
                        onMode={(mode) => {
                            setSessionView((value) => value + 1);
                            changeMode(mode);
                        }}
                        onNavigate={navigate}
                        onPlace={placeTemplate}
                        onAsset={setHandoutAsset}
                        beforeAction={async () => {
                            if (panelGuard.current) throw new Error(panelGuard.current);
                            await sessionFlush.current?.();
                            await queue.flush();
                        }}
                        onCampaign={setCampaign}
                    />
                </Suspense>
            )}
            {replaceMap && (
                <ConfirmDialog
                    title={t('Replace scene map?')}
                    description={t('replaceMap', { name: replaceMap.name })}
                    buttonLabel={t('Replace map')}
                    onClose={() => setReplaceMap(null)}
                    submit={() => placeMap(replaceMap)}
                />
            )}
            {fileDrop && (
                <Dialog title={t('Use dropped image')} onClose={() => !busy && setFileDrop(null)}>
                    <p>{fileDrop.file.name}</p>
                    <div className="dialog-actions">
                        {(['map', 'token', 'prop', 'handout'] as const).map((kind) => (
                            <button
                                key={kind}
                                className="secondary-button"
                                disabled={busy}
                                onClick={() =>
                                    void run(async () => {
                                        const asset = await preparation.upload(
                                            campaign.id,
                                            fileDrop.file,
                                            kind,
                                        );
                                        const point = fileDrop.point;
                                        setFileDrop(null);
                                        await placeAsset(asset, { point, tokenId: null });
                                    })
                                }
                            >
                                {kind === 'map'
                                    ? t('Place map')
                                    : kind === 'prop'
                                      ? t('Place object')
                                      : kind === 'token'
                                        ? t('Create token')
                                        : t('Add handout to library')}
                            </button>
                        ))}
                    </div>
                </Dialog>
            )}
            {picker && (
                <Dialog
                    title={picker.kind === 'token' ? t('Choose token image') : t('Choose map')}
                    onClose={() => setPicker(null)}
                >
                    <AssetLibrary
                        campaignId={campaign.id}
                        pickerKind={picker.kind}
                        onUse={(asset) => {
                            placeAsset(asset, {
                                point: renderer.current?.center() ?? { x: 0, y: 0 },
                                tokenId: picker.tokenId ?? null,
                            });
                            setPicker(null);
                        }}
                    />
                </Dialog>
            )}
            {handoutAsset && (
                <AssetDetails
                    asset={handoutAsset}
                    campaignId={campaign.id}
                    onClose={() => setHandoutAsset(null)}
                    onChanged={() => undefined}
                />
            )}
            {(error || save.error) && (
                <div className="error-banner" role="alert">
                    <span>{error || save.error}</span>
                    {save.error ? (
                        <>
                            <button onClick={queue.retry}> {t('Retry')} </button>
                            <button onClick={() => setModal('reloadSaved')}>
                                {' '}
                                {t('Reload saved')}{' '}
                            </button>
                        </>
                    ) : (
                        <button aria-label={t('Dismiss error')} onClick={() => setError('')}>
                            <X size={16} />
                        </button>
                    )}
                </div>
            )}
            {modal === 'reloadSaved' && (
                <ConfirmDialog
                    title={t('Reload saved scene?')}
                    description={t(
                        'Local changes that the server has not confirmed will be discarded. You can retry saving instead to keep them.',
                    )}
                    buttonLabel={t('Reload saved scene')}
                    onClose={() => setModal(null)}
                    submit={async () => {
                        allowExit.current = true;
                        location.reload();
                    }}
                />
            )}
            {modal === 'createScene' && (
                <NameDialog
                    title={t('Create a scene')}
                    label={t('Scene name')}
                    onClose={() => setModal(null)}
                    submit={async (name) => {
                        await queue.flush();
                        const created = await api.createScene(campaign.id, name);
                        location.assign(`/campaigns/${campaign.id}/scenes/${created.id}`);
                    }}
                />
            )}
            {modal === 'renameScene' && (
                <NameDialog
                    title={t('Rename scene')}
                    label={t('Scene name')}
                    initial={scene.name}
                    onClose={() => setModal(null)}
                    submit={async (name) => {
                        await queue.flush();
                        await api.renameScene(scene.id!, name);
                        location.reload();
                    }}
                />
            )}
            {modal === 'renameCampaign' && (
                <NameDialog
                    title={t('Rename campaign')}
                    label={t('Campaign name')}
                    initial={campaign.name}
                    onClose={() => setModal(null)}
                    submit={async (name) => {
                        await queue.flush();
                        setCampaign(await api.renameCampaign(campaign.id, name));
                    }}
                />
            )}
            {modal === 'deleteScene' && (
                <ConfirmDialog
                    title={t('Delete scene?')}
                    description={t('deleteScene', { name: scene.name ?? '' })}
                    onClose={() => setModal(null)}
                    submit={async () => {
                        await queue.flush();
                        await api.deleteScene(scene.id!);
                        location.assign(`/campaigns/${campaign.id}`);
                    }}
                />
            )}
            {modal === 'deleteToken' && (
                <ConfirmDialog
                    title={t('Delete token?')}
                    description={t(
                        'This removes the selected token from the scene. It cannot be undone. Its image stays in private storage.',
                    )}
                    onClose={() => setModal(null)}
                    submit={async () => {
                        await queue.flush();
                        const id = store.getSnapshot().selectedIds[0];
                        if (id) {
                            const result = await api.deleteToken(id);
                            store.accept(result, true);
                        }
                    }}
                />
            )}
            <dialog
                ref={help}
                className="shortcuts-dialog"
                onClick={(event) => {
                    if (event.target === event.currentTarget) help.current?.close();
                }}
            >
                <div className="panel-heading">
                    <strong> {t('At your fingertips')} </strong>
                    <button
                        className="icon-button"
                        aria-label={t('Close shortcuts')}
                        onClick={() => help.current?.close()}
                    >
                        <X size={16} />
                    </button>
                </div>
                <p> {t('Click the tabletop to focus its controls.')} </p>
                <dl>
                    <dt> {t('Select / Pan / Fog / Ruler / Ping')} </dt>
                    <dd>V / H / F / R / P</dd>
                    <dt> {t('Area templates')} </dt>
                    <dd> {t('Circle toolbar then choose shape')} </dd>
                    <dt> {t('Select / move token')} </dt>
                    <dd> {t('Click / drag')} </dd>
                    <dt>{t('Mixed selection')}</dt>
                    <dd>{t('Shift + click')}</dd>
                    <dt>Выделить рамкой</dt>
                    <dd>Тяните по пустому месту · Shift добавляет/убирает</dd>
                    <dt>Отменить / повторить правку</dt>
                    <dd>Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z · до 50 правок в этой сцене</dd>
                    <dt>{t('Duplicate selection')}</dt>
                    <dd>Ctrl / Cmd + D</dd>
                    <dt>Меню объекта</dt>
                    <dd>
                        Правая кнопка · удержание на планшете · Shift+F10 для выбранного объекта
                    </dd>
                    <dt>{t('Delete selection')}</dt>
                    <dd>Delete</dd>
                    <dt>{t('Resize prop')}</dt>
                    <dd>{t('Drag corner handle')}</dd>
                    <dt> {t('Pan')} </dt>
                    <dd>
                        <kbd>Space</kbd> {t('+ drag')}{' '}
                    </dd>
                    <dt> {t('Pan anywhere on canvas')} </dt>
                    <dd> {t('Middle mouse drag')} </dd>
                    <dt> {t('Zoom to cursor')} </dt>
                    <dd> {t('Mouse wheel')} </dd>
                    <dt> {t('Cancel drag / clear selection')} </dt>
                    <dd>
                        <kbd>Esc</kbd>
                    </dd>
                    <dt> {t('Apply Inspector field')} </dt>
                    <dd>
                        <kbd>Enter</kbd> {t('or blur')}{' '}
                    </dd>
                </dl>
                <p className="hint">
                    {' '}
                    {t(
                        'The Pan toolbar tool also works with a touch or pen drag. Pinch zoom is not part of this preview.',
                    )}{' '}
                </p>
            </dialog>
        </div>
    );
}
