import { useEffect, useRef, useState } from 'react';
import type { Scene } from '../../tabletop/types/scene';
import { SceneStore } from '../../tabletop/state/SceneStore';
import { TabletopRenderer } from '../../tabletop/renderer/TabletopRenderer';
import { loadImages } from '../../api/images';

/** The ordinary Pixi renderer, with input disabled for a read-only GM preview. */
export function ScenePreview({ scene }: { scene: Scene }) {
    const host = useRef<HTMLDivElement>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let active = true;
        const abort = new AbortController();
        const store = new SceneStore(scene);
        store.movementEnabled = false;
        store.objectEditingEnabled = false;
        const renderer = new TabletopRenderer(
            host.current!,
            store,
            () => {},
            () => {
                if (active)
                    setError('Не удалось загрузить preview. Откройте сцену для подготовки.');
            },
        );
        void (async () => {
            await renderer.init();
            if (!active) return;
            const assets = [
                ...(scene.map ? [scene.map.asset] : []),
                ...(scene.props ?? []).map((p) => p.image),
                ...scene.tokens.flatMap((t) => (t.image ? [t.image] : [])),
            ];
            const images = await loadImages(
                [...new Map(assets.map((a) => [a.id, a])).values()],
                abort.signal,
            );
            if (active) {
                renderer.setImages(images);
                setLoading(false);
            }
        })().catch(() => {
            if (active) {
                setError('Не удалось загрузить preview. Откройте сцену для подготовки.');
                setLoading(false);
            }
        });
        return () => {
            active = false;
            abort.abort();
            renderer.destroy();
        };
    }, [scene]);
    return (
        <div className="campaign-scene-preview" aria-label={`Preview сцены ${scene.name}`}>
            <div className="campaign-scene-preview-host" ref={host} inert />
            {error && <p role="alert">{error}</p>}
            {loading && (
                <p className="campaign-preview-status" role="status">
                    Загружаем изображения сцены…
                </p>
            )}
            <span className="campaign-preview-label">GM preview · включая скрытые объекты</span>
        </div>
    );
}
