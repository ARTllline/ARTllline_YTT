import type { ImageAsset } from '../tabletop/types/scene';
export async function loadImages(
    assets: ImageAsset[],
    signal: AbortSignal,
): Promise<Map<string, HTMLImageElement>> {
    const images = new Map<string, HTMLImageElement>();
    await Promise.all(
        assets.map(async (asset) => {
            const response = await fetch(asset.url, {
                credentials: 'same-origin',
                signal,
                cache: 'no-store',
            });
            if (!response.ok)
                throw new Error(
                    'An image could not be loaded. Check your connection and campaign access.',
                );
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            try {
                const image = new Image();
                image.src = url;
                await image.decode();
                images.set(asset.id, image);
            } finally {
                URL.revokeObjectURL(url);
            }
        }),
    );
    return images;
}
