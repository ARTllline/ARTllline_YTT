import { lazy, Suspense, useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { request } from '../api/client';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { SaveQueue } from '../tabletop/state/SaveQueue';
const TriggerPanel = lazy(() =>
    import('./TriggerPanel').then((m) => ({ default: m.TriggerPanel })),
);
export function TriggerControl({
    store,
    queue,
    active,
}: {
    store: SceneStore;
    queue: SaveQueue;
    active: boolean;
}) {
    const scene = store.getSnapshot().scene.id;
    const [open, setOpen] = useState(false),
        [count, setCount] = useState<number | null>(null),
        [refresh, setRefresh] = useState(0);
    useEffect(() => {
        if (!scene) return;
        const abort = new AbortController();
        let pending = false;
        const load = async () => {
            if (pending) return;
            pending = true;
            try {
                const d = await request<{ enabled: number }>(
                    `/scenes/${scene}/triggers?summary=1`,
                    'GET',
                    undefined,
                    abort.signal,
                );
                if (!abort.signal.aborted) setCount(d.enabled);
            } catch {
                if (!abort.signal.aborted) setCount(null);
            } finally {
                pending = false;
            }
        };
        void load();
        const timer = setInterval(() => void load(), 10000);
        return () => {
            abort.abort();
            clearInterval(timer);
        };
    }, [scene, refresh]);
    if (!scene) return null;
    return (
        <>
            <button
                className="secondary-button trigger-launcher"
                title="Условия автоматического запуска событий текущей сцены"
                onClick={() => setOpen(true)}
            >
                <Zap size={14} />
                <span>
                    Триггеры: {count ?? '…'}
                    <small> включено</small>
                </span>
            </button>
            {open && (
                <Suspense fallback={<div className="error-banner">Открываем триггеры…</div>}>
                    <TriggerPanel
                        store={store}
                        queue={queue}
                        active={active}
                        onClose={() => setOpen(false)}
                        onUpdated={() => setRefresh((n) => n + 1)}
                    />
                </Suspense>
            )}
        </>
    );
}
