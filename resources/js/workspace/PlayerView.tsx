import { ActorPicker } from './interactions/ActorPicker';
import { charactersApi } from '../api/characters';
import { actingToken, eligibleActors } from './interactions/actingToken';
import { t } from '../i18n';
import { useLiveMedia } from '../media/useLiveMedia';
import { usePlayerPreload } from '../preload/usePlayerPreload';
import { InteractButton } from '../automation/InteractButton';
import { RadialMenu } from './radial/RadialMenu';
import { DirectorLayer } from '../director/DirectorLayer';
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Maximize, Minus, Plus } from 'lucide-react';
import { api, type Campaign, type User } from '../api/workspace';
import { SceneStore } from '../tabletop/state/SceneStore';
import { ScenePersistence } from '../tabletop/state/ScenePersistence';
import type { Scene } from '../tabletop/types/scene';
import type { TabletopRenderer } from '../tabletop/renderer/TabletopRenderer';
import { useCampaignLive, type LiveEcho, type ConnectionState } from '../realtime/useCampaignLive';
import { useSceneLive } from '../realtime/useSceneLive';
import { ConnectionBadge } from './PlayersPanel';
import { Toolbar } from './Toolbar';
import { Tabletop } from './Tabletop';
import { CombatPanel } from './combat/CombatPanel';
import { ConditionList } from './combat/TokenCombatControls';
import { HandoutShelf } from './handouts/HandoutShelf';
const MediaPanel = lazy(() =>
    import('../media/MediaPanel').then((m) => ({ default: m.MediaPanel })),
);
export function PlayerView({ campaign: initial, user }: { campaign: Campaign; user: User }) {
    const [campaign, setCampaign] = useState(initial);
    const { echo, connection } = useCampaignLive(campaign.id, setCampaign);
    const preload = usePlayerPreload(campaign.id, echo, connection);
    const media = useLiveMedia(
        campaign.id,
        user.id,
        echo,
        connection,
        campaign.activeSceneId,
        campaign.liveRevision,
    );
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
                <a href="/" title={t('Your campaigns')} aria-label={t('Your campaigns')}>
                    <ArrowLeft size={17} />
                </a>
                <div>
                    <span className="eyebrow">{campaign.name}</span>
                    <strong>{current?.scene.name ?? t('Your table')}</strong>
                </div>
                <ConnectionBadge state={connection} />
                {preload.status && (
                    <button
                        className="preload-player-status"
                        onClick={preload.retry}
                        title="Повторить подготовку"
                    >
                        {preload.status}
                    </button>
                )}
                <HandoutShelf campaignId={campaign.id} userId={user.id} echo={echo} />
                <Suspense fallback={null}>
                    <MediaPanel campaignId={campaign.id} syncError={media.syncError} />
                </Suspense>
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
                    <span className="eyebrow"> {t('THE NEXT CHAPTER')} </span>
                    <h1>
                        {error
                            ? t('The scene could not open.')
                            : campaign.activeSceneId
                              ? t('Entering the scene…')
                              : t('Your Game Master is setting the scene.')}
                    </h1>
                    <p>
                        {error ||
                            (campaign.activeSceneId
                                ? t('Preparing your view of the world.')
                                : t(
                                      'Stay here. Your adventure will appear when the table is ready.',
                                  ))}
                    </p>
                    {error && (
                        <button className="secondary-button" onClick={() => setRetry((n) => n + 1)}>
                            {' '}
                            {t('Try again')}{' '}
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
        store.spatial.identity = { id: user.id, name: user.name };
        store.spatial.shareActive = true;
        store.spatial.epoch = initial.liveRevision ?? 0;
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
    const actors = eligibleActors(snapshot.scene.tokens, 'player');
    const actor = actingToken(actors, snapshot.actingTokenId, snapshot.scene.activeCharacterId);
    const [actorBusy, setActorBusy] = useState(false);
    const [actorError, setActorError] = useState('');
    useEffect(() => {
        let alive = true;
        let chain = Promise.resolve();
        let version = 0;
        store.bindActiveCharacter((id) => {
            const current = ++version;
            setActorBusy(true);
            setActorError('');
            chain = chain
                .then(() => charactersApi.select(initial.campaignId!, id))
                .then((roster) => {
                    if (alive && current === version)
                        store.reconcile({ ...store.getSnapshot().scene, ...roster });
                })
                .catch((e) => {
                    if (alive && current === version) {
                        setActorError(e.message);
                        void api
                            .snapshot(initial.id!)
                            .then((scene) => {
                                if (alive && current === version) store.reconcile(scene);
                            })
                            .catch(() => {});
                    }
                })
                .finally(() => {
                    if (alive && current === version) setActorBusy(false);
                });
        });
        return () => {
            alive = false;
            store.bindActiveCharacter();
        };
    }, [store, initial.campaignId, initial.id]);
    useEffect(() => {
        if (snapshot.scene.activeCharacterId) store.select(actor?.id ?? null);
    }, [store, snapshot.scene.activeCharacterId, actor?.id]);
    useEffect(() => {
        const eligible = eligibleActors(snapshot.scene.tokens, 'player');
        if (snapshot.scene.activeCharacterId) return;
        if (
            !eligible.some((token) => token.id === snapshot.actingTokenId) &&
            (snapshot.actingTokenId || eligible.length === 1)
        )
            store.setActingToken(eligible.length === 1 ? eligible[0].id : undefined);
    }, [snapshot.scene.tokens, snapshot.scene.activeCharacterId, snapshot.actingTokenId, store]);
    const selected = snapshot.scene.tokens.find((t) => t.id === snapshot.selectedIds[0]);
    const selectedProp = snapshot.scene.props?.find((p) => p.id === snapshot.selectedPropIds?.[0]);
    return (
        <main className="player-tabletop">
            <div className="player-actor">
                {!!snapshot.scene.characters?.length && (
                    <label className="character-picker">
                        <span>ПЕРСОНАЖ</span>
                        <select
                            aria-label="Постоянный персонаж"
                            value={
                                snapshot.scene.activeCharacterId ??
                                (snapshot.actingTokenId ? `token:${snapshot.actingTokenId}` : '')
                            }
                            disabled={actorBusy}
                            onChange={(e) =>
                                e.target.value.startsWith('token:')
                                    ? store.setActingToken(e.target.value.slice(6))
                                    : store.setActiveCharacter(e.target.value || null)
                            }
                        >
                            <option value="" disabled>
                                Выберите персонажа
                            </option>
                            {snapshot.scene.characters.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                            {actors
                                .filter((t) => !t.characterId)
                                .map((t) => (
                                    <option key={t.id} value={`token:${t.id}`}>
                                        {t.name} · токен сцены
                                    </option>
                                ))}
                        </select>
                        {snapshot.scene.activeCharacterId && !actor && (
                            <small>Нет доступного токена в этой сцене</small>
                        )}
                    </label>
                )}
                {!snapshot.scene.characters?.length && (
                    <ActorPicker
                        tokens={actors}
                        actor={actor}
                        disabled={actorBusy}
                        onChange={(id) => store.setActingToken(id)}
                    />
                )}
                {actorError && <p role="alert">{actorError}</p>}
            </div>
            <Tabletop store={store} rendererRef={renderer} onZoom={setZoom} />
            <RadialMenu
                store={store}
                queue={queue}
                renderer={renderer}
                disabled={connection !== 'connected'}
            />
            <DirectorLayer
                sceneId={initial.id!}
                epoch={initial.liveRevision ?? 0}
                channel={`campaign.${initial.campaignId}.scene.${initial.id}.epoch.${initial.liveRevision}.user.${user.id}`}
                echo={echo}
                connection={connection}
                renderer={renderer}
            />
            <CombatPanel store={store} queue={queue} />
            <Toolbar store={store} onTool={(tool) => renderer.current?.setTool(tool)} />
            {(status || save.error) && (
                <div className="player-notice" role="status">
                    <span>{save.error || status}</span>
                    {save.error && (
                        <>
                            <button onClick={queue.retry}> {t('Retry move')} </button>
                            <button onClick={() => location.reload()}>
                                {' '}
                                {t('Reload saved scene')}{' '}
                            </button>
                        </>
                    )}
                </div>
            )}
            <div className="player-help">
                {selected ? (
                    <>
                        <strong>{selected.name}</strong>
                        {selected.hp !== undefined && (
                            <span>
                                {selected.hp} / {selected.maxHp} HP
                            </span>
                        )}
                        <ConditionList token={selected} />
                        <span>
                            {selected.canMove
                                ? t('Your token · drag to move')
                                : t('View only · controlled by the GM or another player')}
                        </span>
                    </>
                ) : selectedProp ? (
                    <strong>{selectedProp.name || 'Объект'}</strong>
                ) : (
                    <>
                        <strong> {t('Your seat at the table')} </strong>
                        <span>
                            {' '}
                            {t(
                                'Select your token to move. Space + drag to pan. Scroll to zoom.',
                            )}{' '}
                        </span>
                    </>
                )}
                {(selected ?? selectedProp)?.interactions?.length ? (
                    <span>ПКМ / долгое нажатие — действия объекта</span>
                ) : (
                    (selected || selectedProp) && (
                        <InteractButton
                            key={`${selected ? 'token' : 'prop'}:${(selected ?? selectedProp)!.id}`}
                            actorTokenId={actor?.id}
                            sceneId={initial.id!}
                            epoch={initial.liveRevision ?? 0}
                            kind={selected ? 'token' : 'prop'}
                            id={(selected ?? selectedProp)!.id}
                            disabled={
                                !actor || connection !== 'connected' || save.status !== 'saved'
                            }
                        />
                    )
                )}
            </div>
            <div className="player-controls">
                <button aria-label={t('Zoom out')} onClick={() => renderer.current?.zoom(0.8)}>
                    <Minus size={16} />
                </button>
                <span>{zoom}%</span>
                <button aria-label={t('Zoom in')} onClick={() => renderer.current?.zoom(1.25)}>
                    <Plus size={16} />
                </button>
                <button aria-label={t('Fit scene')} onClick={() => renderer.current?.fit()}>
                    <Maximize size={16} />
                </button>
            </div>
        </main>
    );
}
