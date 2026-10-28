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
        let mediaKey = '';
        const decoded = new Map<string, HTMLImageElement>();
        const syncMedia = () => {
            if (!instanceReady) return;
            const scene = store.getSnapshot().scene;
            const assets = [
                ...(scene.map ? [scene.map.asset] : []),
                ...scene.tokens.flatMap((t) => (t.image ? [t.image] : [])),
            ];
            const unique = [...new Map(assets.map((asset) => [asset.id, asset])).values()];
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
                    }
                })
                .catch((error) => {
                    if (active && !controller.signal.aborted && error.name !== 'AbortError')
                        setMedia({ loading: false, error: error.message });
                });
        };
        const unsubscribe = store.subscribe(syncMedia);
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
                }
            })
            .catch(fail);
        return () => {
            active = false;
            rendererRef.current = null;
            instance?.destroy();
            unsubscribe();
            mediaAbort?.abort();
        };
    }, [store, rendererRef, onZoom]);
    return (
        <>
            <div className="canvas-host" ref={host} />
            {status !== 'ready' && (
                <div className="canvas-message" role="status">
                    <span className="eyebrow">YTT / TABLETOP</span>
                    <h2>
                        {status === 'loading'
                            ? 'Setting the stage…'
                            : 'The tabletop could not start.'}
                    </h2>
                    <p>
                        {status === 'loading'
                            ? 'Preparing your scene.'
                            : 'Check that WebGL is enabled, then reload. Details are in the browser console.'}
                    </p>
                    {status === 'error' && (
                        <button onClick={() => location.reload()}>Reload workspace</button>
                    )}
                </div>
            )}
            {status === 'ready' && (media.loading || media.error) && (
                <div className="media-state" role="status">
                    {media.error ?? 'Loading scene images…'}
                    {media.error && <button onClick={() => location.reload()}>Reload scene</button>}
                </div>
            )}
        </>
    );
}
