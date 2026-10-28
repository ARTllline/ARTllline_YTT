import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
    Box,
    ChevronRight,
    Play,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
    Maximize,
    Minus,
    Plus,
    Keyboard,
    X,
    ImagePlus,
    LogOut,
} from 'lucide-react';
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
import { Inspector } from './Inspector';
import { Tabletop } from './Tabletop';
import { Toolbar } from './Toolbar';
import { PlayersPanel } from './PlayersPanel';
import { useCampaignLive } from '../realtime/useCampaignLive';
import { useSceneLive } from '../realtime/useSceneLive';
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
    const live = useCampaignLive(campaign.id, setCampaign);
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
    const { scene } = useSyncExternalStore(store.subscribe, store.getSnapshot);
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
    const [dropping, setDropping] = useState(false);
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
            await queue.flush();
            location.assign(url);
        });
    };
    const uploadMap = (file: File) => {
        void run(async () => {
            if (!scene.id) return;
            await queue.flush();
            const asset = await api.upload(campaign.id, file, 'map');
            store.setMap({
                asset,
                x: 0,
                y: 0,
                width:
                    asset.width * Math.min(scene.width / asset.width, scene.height / asset.height),
                height:
                    asset.height * Math.min(scene.width / asset.width, scene.height / asset.height),
            });
            await queue.flush();
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
    const [zoom, setZoom] = useState(100);
    const [left, setLeft] = useState(() => window.innerWidth >= 900);
    const [right, setRight] = useState(() => window.innerWidth >= 1180);
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
    useEffect(() => {
        const compact = window.matchMedia('(max-width: 1179px)');
        const narrow = window.matchMedia('(max-width: 899px)');
        const collapseInspector = () => {
            if (compact.matches) setRight(false);
        };
        const collapseLibrary = () => {
            if (narrow.matches) setLeft(false);
        };
        compact.addEventListener('change', collapseInspector);
        narrow.addEventListener('change', collapseLibrary);
        return () => {
            compact.removeEventListener('change', collapseInspector);
            narrow.removeEventListener('change', collapseLibrary);
        };
    }, []);
    const toggleLibrary = () => {
        if (!left && window.innerWidth < 900) setRight(false);
        setLeft(!left);
    };
    const toggleInspector = () => {
        if (!right && window.innerWidth < 900) setLeft(false);
        setRight(!right);
    };
    const changeTool = (next: Tool) => {
        renderer.current?.setTool(next);
    };
    return (
        <div className="workspace">
            <header className="topbar">
                <a
                    className="brand"
                    href="/"
                    onClick={(event) => {
                        event.preventDefault();
                        navigate('/');
                    }}
                    aria-label="YTT home"
                >
                    <Box size={25} />
                    <strong>
                        YTT<span> / </span>
                    </strong>
                </a>
                <div className="breadcrumb">
                    <span>{campaign.name}</span>
                    <ChevronRight size={13} />
                    <strong>{scene.name ?? 'New workspace'}</strong>
                </div>
                <div className="topbar-actions">
                    <PlayersPanel
                        campaign={campaign}
                        members={live.members}
                        connection={live.connection}
                    />
                    <span className="local-badge">
                        <i /> {activeName ? `Active: ${activeName}` : 'No active scene'}
                    </span>
                    <span title={user.name} className="gm-avatar">
                        GM
                    </span>
                    <button
                        className="present-button"
                        disabled={!scene.id || busy}
                        title={
                            campaign.activeSceneId === scene.id
                                ? 'Deactivate this scene'
                                : 'Set the active scene independently from editing'
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
                        {campaign.activeSceneId === scene.id ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                        className="icon-button"
                        aria-label="Sign out"
                        title="Sign out"
                        onClick={() =>
                            void run(async () => {
                                await queue.flush();
                                await api.logout();
                                location.assign('/login');
                            })
                        }
                    >
                        <LogOut size={16} />
                    </button>
                </div>
            </header>
            <div
                className={`workspace-body ${left ? '' : 'left-closed'} ${right ? '' : 'right-closed'}`}
            >
                {left && (
                    <Sidebar
                        store={store}
                        campaign={campaign}
                        onClose={() => setLeft(false)}
                        onNavigate={navigate}
                        onCreate={() => setModal('createScene')}
                        onRename={() => setModal('renameScene')}
                        onDelete={() => setModal('deleteScene')}
                        onCampaignRename={() => setModal('renameCampaign')}
                    />
                )}
                <main
                    className="tabletop"
                    aria-label="Tabletop workspace"
                    onDragOver={(event) => {
                        event.preventDefault();
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
                        if (file && scene.id && !busy) uploadMap(file);
                    }}
                >
                    {scene.id && <Tabletop store={store} rendererRef={renderer} onZoom={setZoom} />}
                    {!scene.id ? (
                        <div className="canvas-empty">
                            <span className="eyebrow">YOUR FIRST SCENE</span>
                            <h2>A world begins with a place.</h2>
                            <p>Create a scene, bring in a map, and make room for your cast.</p>
                            <button
                                className="primary-button"
                                onClick={() => setModal('createScene')}
                            >
                                <Plus size={16} /> Create scene
                            </button>
                        </div>
                    ) : (
                        !scene.map &&
                        scene.tokens.length === 0 && (
                            <div className="canvas-empty map-empty">
                                <ImagePlus size={27} />
                                <h2>Set the scene.</h2>
                                <p>
                                    Drop a battle map here or upload an image.
                                    <br />
                                    You can also start with tokens on the grid.
                                </p>
                                <label className="upload-button">
                                    <ImagePlus size={15} />
                                    {busy ? 'Uploading…' : 'Upload battle map'}
                                    <input
                                        type="file"
                                        aria-label="Upload first battle map"
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
                    {dropping && (
                        <div className="drop-overlay">
                            Drop to {scene.map ? 'replace' : 'add'} the battle map
                        </div>
                    )}
                    <div className="canvas-topline">
                        <button
                            className="icon-button surface"
                            onClick={toggleLibrary}
                            title={left ? 'Hide library' : 'Show library'}
                            aria-label={left ? 'Hide library' : 'Show library'}
                        >
                            {left ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
                        </button>
                        <div className="canvas-heading">
                            <span className="eyebrow">
                                {scene.id ? 'EDITING SCENE' : 'CAMPAIGN'} <span>/</span> PREPARATION
                            </span>
                            <h1>{scene.name ?? campaign.name}</h1>
                        </div>
                        <button
                            className="icon-button surface inspector-toggle"
                            onClick={toggleInspector}
                            title={right ? 'Hide inspector' : 'Show inspector'}
                            aria-label={right ? 'Hide inspector' : 'Show inspector'}
                        >
                            {right ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
                        </button>
                    </div>
                    {scene.id && (
                        <>
                            <Toolbar store={store} onTool={changeTool} />
                            <div className="scene-quick-actions">
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
                                            setRight(true);
                                            if (window.innerWidth < 900) setLeft(false);
                                        })
                                    }
                                >
                                    <Plus size={14} /> Add token
                                </button>
                                <button
                                    className="secondary-button"
                                    onClick={() => {
                                        store.select(null);
                                        setRight(true);
                                        if (window.innerWidth < 900) setLeft(false);
                                    }}
                                >
                                    Scene setup
                                </button>
                            </div>
                        </>
                    )}
                    <div className="canvas-bottomline">
                        <span className="canvas-tip">
                            <kbd>Space</kbd> + drag to pan <span>·</span> Scroll to zoom
                        </span>
                        <div className="zoom-control">
                            <button
                                aria-label="Zoom out"
                                title="Zoom out"
                                onClick={() => renderer.current?.zoom(1 / 1.2)}
                            >
                                <Minus size={14} />
                            </button>
                            <output aria-label="Zoom level">{zoom}%</output>
                            <button
                                aria-label="Zoom in"
                                title="Zoom in"
                                onClick={() => renderer.current?.zoom(1.2)}
                            >
                                <Plus size={14} />
                            </button>
                            <i />
                            <button
                                aria-label="Fit scene"
                                title="Fit scene to viewport"
                                onClick={() => renderer.current?.fit()}
                            >
                                <Maximize size={14} />
                            </button>
                        </div>
                    </div>
                </main>
                {right && (
                    <Inspector
                        store={store}
                        campaign={campaign}
                        uploadMap={uploadMap}
                        uploadToken={uploadToken}
                        busy={busy}
                        deleteToken={() => setModal('deleteToken')}
                        onClose={() => setRight(false)}
                    />
                )}
            </div>
            <footer className="statusbar">
                <span>
                    <i className="status-dot" /> GM WORKSPACE{' '}
                    {scene.id && <b>r{scene.revision ?? 0}</b>}
                </span>
                <span className={`session-note save-${save.status}`} role="status">
                    {busy
                        ? 'Working…'
                        : save.status === 'saved'
                          ? scene.id && syncStatus
                              ? syncStatus
                              : 'Saved'
                          : save.status === 'saving'
                            ? 'Saving…'
                            : 'Save failed'}
                </span>
                {save.status === 'failed' && <button onClick={queue.retry}>Retry save</button>}
                <button onClick={() => help.current?.showModal()}>
                    <Keyboard size={14} /> Shortcuts
                </button>
            </footer>
            {(error || save.error) && (
                <div className="error-banner" role="alert">
                    <span>{error || save.error}</span>
                    {save.error ? (
                        <>
                            <button onClick={queue.retry}>Retry</button>
                            <button onClick={() => setModal('reloadSaved')}>Reload saved</button>
                        </>
                    ) : (
                        <button aria-label="Dismiss error" onClick={() => setError('')}>
                            <X size={16} />
                        </button>
                    )}
                </div>
            )}
            {modal === 'reloadSaved' && (
                <ConfirmDialog
                    title="Reload saved scene?"
                    description="Local changes that the server has not confirmed will be discarded. You can retry saving instead to keep them."
                    buttonLabel="Reload saved scene"
                    onClose={() => setModal(null)}
                    submit={async () => {
                        allowExit.current = true;
                        location.reload();
                    }}
                />
            )}
            {modal === 'createScene' && (
                <NameDialog
                    title="Create a scene"
                    label="Scene name"
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
                    title="Rename scene"
                    label="Scene name"
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
                    title="Rename campaign"
                    label="Campaign name"
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
                    title="Delete scene?"
                    description={`Delete “${scene.name}” and its tokens? This cannot be undone. Images remain in private storage. An active scene must be deactivated first.`}
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
                    title="Delete token?"
                    description="This removes the selected token from the scene. It cannot be undone. Its image stays in private storage."
                    onClose={() => setModal(null)}
                    submit={async () => {
                        await queue.flush();
                        const id = store.getSnapshot().selectedIds[0];
                        if (id) {
                            const result = await api.deleteToken(id);
                            store.removeToken(id, result.revision);
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
                    <strong>At your fingertips</strong>
                    <button
                        className="icon-button"
                        aria-label="Close shortcuts"
                        onClick={() => help.current?.close()}
                    >
                        <X size={16} />
                    </button>
                </div>
                <p>Click the tabletop to focus its controls.</p>
                <dl>
                    <dt>Select / Pan / Fog / Ruler / Ping</dt>
                    <dd>V / H / F / R / P</dd>
                    <dt>Area templates</dt>
                    <dd>Circle toolbar then choose shape</dd>
                    <dt>Select / move token</dt>
                    <dd>Click / drag</dd>
                    <dt>Pan</dt>
                    <dd>
                        <kbd>Space</kbd> + drag
                    </dd>
                    <dt>Pan anywhere on canvas</dt>
                    <dd>Middle mouse drag</dd>
                    <dt>Zoom to cursor</dt>
                    <dd>Mouse wheel</dd>
                    <dt>Cancel drag / clear selection</dt>
                    <dd>
                        <kbd>Esc</kbd>
                    </dd>
                    <dt>Apply Inspector field</dt>
                    <dd>
                        <kbd>Enter</kbd> or blur
                    </dd>
                </dl>
                <p className="hint">
                    The Pan toolbar tool also works with a touch or pen drag. Pinch zoom is not part
                    of this preview.
                </p>
            </dialog>
        </div>
    );
}
