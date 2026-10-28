import { useEffect, useRef, useState, type RefObject } from 'react';
import type { TabletopRenderer } from '../tabletop/renderer/TabletopRenderer';
import type { SceneStore } from '../tabletop/state/SceneStore';
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
    useEffect(() => {
        let active = true;
        const fail = (error: unknown) => {
            console.error('Tabletop renderer:', error);
            if (active) setStatus('error');
        };
        let instance: TabletopRenderer | undefined;
        void import('../tabletop/renderer/TabletopRenderer')
            .then(async ({ TabletopRenderer }) => {
                if (!active) return;
                instance = new TabletopRenderer(host.current!, store, onZoom, fail);
                rendererRef.current = instance;
                await instance.init();
                if (active) setStatus('ready');
            })
            .catch(fail);
        return () => {
            active = false;
            rendererRef.current = null;
            instance?.destroy();
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
                            ? 'Preparing the observatory.'
                            : 'Check that WebGL is enabled, then reload. Details are in the browser console.'}
                    </p>
                    {status === 'error' && (
                        <button onClick={() => location.reload()}>Reload workspace</button>
                    )}
                </div>
            )}
        </>
    );
}
