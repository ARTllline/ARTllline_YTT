import type { LibraryAsset } from '../../api/preparation';
export const ASSET_MIME = 'application/x-ytt-asset';
export function readAssetDrag(value: string): LibraryAsset | null {
    try {
        const asset = JSON.parse(value) as LibraryAsset;
        return typeof asset.id === 'string' &&
            /^\d+$/.test(asset.id) &&
            ['map', 'token', 'handout'].includes(asset.kind) &&
            typeof asset.name === 'string' &&
            Number.isFinite(asset.width) &&
            Number.isFinite(asset.height)
            ? asset
            : null;
    } catch {
        return null;
    }
}
export async function uploadBatch(
    files: File[],
    upload: (file: File) => Promise<unknown>,
    progress: (index: number, state: 'uploading' | 'saved' | 'failed', error?: string) => void,
) {
    for (const [index, file] of files.entries()) {
        progress(index, 'uploading');
        try {
            await upload(file);
            progress(index, 'saved');
        } catch (error) {
            progress(index, 'failed', (error as Error).message);
        }
    }
}
