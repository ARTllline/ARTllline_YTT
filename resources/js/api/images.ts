import { t } from '../i18n';
import type { ImageAsset } from '../tabletop/types/scene';
import { resourceCache } from '../preload/ResourceCache';
export async function loadImages(
    assets: ImageAsset[],
    signal: AbortSignal,
): Promise<Map<string, HTMLImageElement>> {
    const images = new Map<string, HTMLImageElement>();
    let index = 0;
    const worker = async () => {
        while (index < assets.length) {
            signal.throwIfAborted();
            const asset = assets[index++];
            let blob = resourceCache.get(asset.url);
            if (!blob) {
                const response = await fetch(asset.url, {
                    credentials: 'same-origin',
                    signal,
                    cache: 'no-store',
                });
                if (!response.ok)
                    throw new Error(
                        t(
                            'An image could not be loaded. Check your connection and campaign access.',
                        ),
                    );
                blob = await response.blob();
            }
            const url = URL.createObjectURL(blob);
            try {
                const image = new Image();
                image.src = url;
                await image.decode();
                images.set(asset.id, image);
            } finally {
                URL.revokeObjectURL(url);
            }
        }
    };
    await Promise.all([worker(), worker()]);
    return images;
}
