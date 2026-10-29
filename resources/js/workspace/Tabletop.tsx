import { t } from '../i18n';
import { audioEngine } from '../media/AudioEngine';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { TabletopRenderer } from '../tabletop/renderer/TabletopRenderer';
import type { SceneStore } from '../tabletop/state/SceneStore';
import { loadImages } from '../api/images';
export function Tabletop({
    store,
    rendererRef,
    onZoom,
}: {
    store: SceneStore;
    rendererRef: RefObject<TabletopRenderer | null>;
    onZoom: (zoom: number) => void;
}) {
    const host = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [presented, setPresented] = useState(false);
    const [arrival, setArrival] = useState(true);
    const [media, setMedia] = useState<{ loading: boolean; error: string | null }>({
        loading: false,
        error: null,
    });
    useEffect(() => {
        let active = true;
        const fail = (error: unknown) => {
            console.error('Tabletop renderer:', error);
            if (active) setStatus('error');
        };
        let instance: TabletopRenderer | undefined;
        let instanceReady = false;
        let mediaAbort: AbortController | undefined;
        let mediaKey: string | null = null;
        const decoded = new Map<string, HTMLImageElement>();
        const syncMedia = () => {
            if (!instanceReady) return;
            const scene = store.getSnapshot().scene;
            const assets = [
                ...(scene.map ? [scene.map.asset] : []),
                ...(scene.props ?? []).map((p) => p.image),
                ...scene.tokens.flatMap((t) => (t.image ? [t.image] : [])),
            ];
            const unique = [...new Map(assets.map((asset) => [asset.id, asset])).values()];
            for (const id of decoded.keys())
                if (!unique.some((a) => a.id === id)) decoded.delete(id);
            const key = unique
                .map((asset) => asset.id)
                .sort()
                .join(',');
            if (key === mediaKey) return;
            mediaKey = key;
            mediaAbort?.abort();
            mediaAbort = new AbortController();
            const controller = mediaAbort;
            setMedia({ loading: true, error: null });
            void loadImages(
                unique.filter((asset) => !decoded.has(asset.id)),
                controller.signal,
            )
                .then((images) => {
                    if (active && !controller.signal.aborted) {
                        images.forEach((image, id) => decoded.set(id, image));
                        instance?.setImages(decoded);
                        setMedia({ loading: false, error: null });
                        setPresented(true);
                    }
                })
                .catch((error) => {
                    if (active && !controller.signal.aborted && error.name !== 'AbortError')
                        setMedia({ loading: false, error: error.message });
                });
        };
        const unsubscribe = store.subscribe(syncMedia);
        const syncAtmosphere = () => {
            const state = audioEngine.getSnapshot().state;
            instance?.atmosphere(
                state && state.sceneId === store.getSnapshot().scene.id ? state.effects : {},
            );
        };
        const unsubscribeAtmosphere = audioEngine.subscribe(syncAtmosphere);
        void import('../tabletop/renderer/TabletopRenderer')
            .then(async ({ TabletopRenderer }) => {
                if (!active) return;
                instance = new TabletopRenderer(host.current!, store, onZoom, fail);
                await instance.init();
                if (active) {
                    rendererRef.current = instance;
                    instanceReady = true;
                    setStatus('ready');
                    syncMedia();
                    syncAtmosphere();
                }
            })
            .catch(fail);
        return () => {
            active = false;
            rendererRef.current = null;
            instance?.destroy();
            unsubscribe();
            unsubscribeAtmosphere();
            mediaAbort?.abort();
        };
    }, [store, rendererRef, onZoom]);
    return (
        <>
            <div className="canvas-host" ref={host} />
            {store.role === 'player' && (
                <div
                    className={`director-fade scene-arrival ${presented ? 'ready' : ''}`}
                    aria-hidden="true"
                />
            )}
            {status === 'ready' && presented && arrival && (
                <div
                    className="scene-title-arrival"
                    onAnimationEnd={() => setArrival(false)}
                    aria-hidden="true"
                >
                    <span>YTT · {store.role === 'gm' ? 'ВАША СЦЕНА' : 'ВЫ НА СЦЕНЕ'}</span>
                    <strong>{store.getSnapshot().scene.name}</strong>
                </div>
            )}
            {status !== 'ready' && (
                <div className="canvas-message" role="status">
                    <span className="eyebrow"> {t('YTT / TABLETOP')} </span>
                    <h2>
                        {status === 'loading'
                            ? t('Setting the stage…')
                            : t('The tabletop could not start.')}
                    </h2>
                    <p>
                        {status === 'loading'
                            ? t('Preparing your scene.')
                            : t(
                                  'Check that WebGL is enabled, then reload. Details are in the browser console.',
                              )}
                    </p>
                    {status === 'error' && (
                        <button onClick={() => location.reload()}> {t('Reload workspace')} </button>
                    )}
                </div>
            )}
            {status === 'ready' && (media.loading || media.error) && (
                <div className="media-state" role="status">
                    {media.error ?? t('Loading scene images…')}
                    {media.error && (
                        <button onClick={() => location.reload()}> {t('Reload scene')} </button>
                    )}
                </div>
            )}
        </>
    );
}
