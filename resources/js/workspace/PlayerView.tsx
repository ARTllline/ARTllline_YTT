import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Hand, Maximize, Minus, MousePointer2, Plus } from 'lucide-react';
import { api, type Campaign, type User } from '../api/workspace';
import { SceneStore } from '../tabletop/state/SceneStore';
import { ScenePersistence } from '../tabletop/state/ScenePersistence';
import type { Scene } from '../tabletop/types/scene';
import type { TabletopRenderer } from '../tabletop/renderer/TabletopRenderer';
import { useCampaignLive, type LiveEcho, type ConnectionState } from '../realtime/useCampaignLive';
import { useSceneLive } from '../realtime/useSceneLive';
import { ConnectionBadge } from './PlayersPanel';
import { Tabletop } from './Tabletop';
export function PlayerView({ campaign: initial, user }: { campaign: Campaign; user: User }) {
    const [campaign, setCampaign] = useState(initial);
    const { echo, connection } = useCampaignLive(campaign.id, setCampaign);
    const [loaded, setLoaded] = useState<{ scene: Scene; epoch: number } | null>(null);
    const [failure, setFailure] = useState<{ epoch: number; message: string } | null>(null);
    const error = failure?.epoch === campaign.liveRevision ? failure.message : '';
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        const abort = new AbortController();
        if (campaign.activeSceneId)
            void api
                .snapshot(campaign.activeSceneId, abort.signal)
                .then((scene) => {
                    if (!abort.signal.aborted && scene.liveRevision === campaign.liveRevision) {
                        setFailure(null);
                        setLoaded({ scene, epoch: campaign.liveRevision });
                    }
                })
                .catch((e) => {
                    if (!abort.signal.aborted)
                        setFailure({ epoch: campaign.liveRevision, message: e.message });
                });
        return () => abort.abort();
    }, [campaign.activeSceneId, campaign.liveRevision, retry]);
    const current =
        loaded &&
        loaded.epoch === campaign.liveRevision &&
        loaded.scene.id === campaign.activeSceneId
            ? loaded
            : null;
    return (
        <div className="player-view">
            <header className="player-topbar">
                <a href="/" title="Your campaigns" aria-label="Your campaigns">
                    <ArrowLeft size={17} />
                </a>
                <div>
                    <span className="eyebrow">{campaign.name}</span>
                    <strong>{current?.scene.name ?? 'Your table'}</strong>
                </div>
                <ConnectionBadge state={connection} />
                <span className="player-name">{user.name}</span>
            </header>
            {current ? (
                <PlayerTabletop
                    key={`${current.scene.id}:${current.epoch}`}
                    scene={current.scene}
                    user={user}
                    echo={echo}
                    connection={connection}
                />
            ) : (
                <main className="player-waiting">
                    <div className="waiting-orbit" aria-hidden="true">
                        ✦
                    </div>
                    <span className="eyebrow">THE NEXT CHAPTER</span>
                    <h1>
                        {error
                            ? 'The scene could not open.'
                            : campaign.activeSceneId
                              ? 'Entering the scene…'
                              : 'Your Game Master is setting the scene.'}
                    </h1>
                    <p>
                        {error ||
                            (campaign.activeSceneId
                                ? 'Preparing your view of the world.'
                                : 'Stay here. Your adventure will appear when the table is ready.')}
                    </p>
                    {error && (
                        <button className="secondary-button" onClick={() => setRetry((n) => n + 1)}>
                            Try again
                        </button>
                    )}
                </main>
            )}
        </div>
    );
}
function PlayerTabletop({
    scene: initial,
    user,
    echo,
    connection,
}: {
    scene: Scene;
    user: User;
    echo: LiveEcho | null;
    connection: ConnectionState;
}) {
    const [{ store, queue }] = useState(() => {
        const store = new SceneStore(initial, 'player');
        store.movementEnabled = false;
        return { store, queue: new ScenePersistence(store, initial.id!).queue };
    });
    const status = useSceneLive(
        echo,
        `campaign.${initial.campaignId}.scene.${initial.id}.epoch.${initial.liveRevision}.user.${user.id}`,
        store,
        queue,
        connection,
    );
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const save = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
    const renderer = useRef<TabletopRenderer | null>(null);
    const [zoom, setZoom] = useState(100);
    const [pan, setPan] = useState(false);
    const selected = snapshot.scene.tokens.find((t) => t.id === snapshot.selectedIds[0]);
    return (
        <main className="player-tabletop">
            <Tabletop store={store} rendererRef={renderer} onZoom={setZoom} />
            {(status || save.error) && (
                <div className="player-notice" role="status">
                    <span>{save.error || status}</span>
                    {save.error && (
                        <>
                            <button onClick={queue.retry}>Retry move</button>
                            <button onClick={() => location.reload()}>Reload saved scene</button>
                        </>
                    )}
                </div>
            )}
            <div className="player-help">
                {selected ? (
                    <>
                        <strong>{selected.name}</strong>
                        <span>
                            {selected.canMove
                                ? 'Your token · drag to move'
                                : 'View only · controlled by the GM or another player'}
                        </span>
                    </>
                ) : (
                    <>
                        <strong>Your seat at the table</strong>
                        <span>Select your token to move. Space + drag to pan. Scroll to zoom.</span>
                    </>
                )}
            </div>
            <div className="player-controls">
                <button
                    aria-label={pan ? 'Select tool' : 'Pan tool'}
                    title={pan ? 'Select tool' : 'Pan tool'}
                    onClick={() => {
                        renderer.current?.setTool(pan ? 'select' : 'pan');
                        setPan(!pan);
                    }}
                >
                    {pan ? <Hand size={17} /> : <MousePointer2 size={17} />}
                </button>
                <span className="control-divider" />
                <button aria-label="Zoom out" onClick={() => renderer.current?.zoom(0.8)}>
                    <Minus size={16} />
                </button>
                <span>{zoom}%</span>
                <button aria-label="Zoom in" onClick={() => renderer.current?.zoom(1.25)}>
                    <Plus size={16} />
                </button>
                <button aria-label="Fit scene" onClick={() => renderer.current?.fit()}>
                    <Maximize size={16} />
                </button>
            </div>
        </main>
    );
}
