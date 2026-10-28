import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResourceCache, type PreloadManifest } from './ResourceCache';
const url = (id: number) => `/api/media/00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
const manifest = (count = 1): PreloadManifest => ({
    id: 'batch',
    expiresAt: Date.now() + 60000,
    resources: Array.from({ length: count }, (_, i) => ({ url: url(i), bytes: 10, kind: 'image' })),
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
describe('private preload cache', () => {
    it('reuses a blob for DOM portraits, extends its lease and releases URLs on teardown', async () => {
        let time = 1000;
        vi.spyOn(Date, 'now').mockImplementation(() => time);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(new Blob(['small']))),
        );
        const revoke = vi.spyOn(URL, 'revokeObjectURL');
        const cache = new ResourceCache();
        await cache.prepare(
            { ...manifest(), expiresAt: 2000 },
            new AbortController().signal,
            () => {},
        );
        const cachedUrl = cache.imageUrl(url(0));
        expect(cachedUrl.startsWith('blob:')).toBe(true);
        await cache.prepare(
            { ...manifest(), id: 'next', expiresAt: 4000 },
            new AbortController().signal,
            () => {},
        );
        time = 3000;
        expect(cache.imageUrl(url(0))).toBe(cachedUrl);
        expect(cache.get(url(0))).toBeDefined();
        cache.clear();
        expect(revoke).toHaveBeenCalledWith(cachedUrl);
        expect(cache.imageUrl(url(0))).toBe(url(0));
    });
    it('downloads with two workers at most and reuses exact URLs without another transfer', async () => {
        let concurrent = 0,
            maximum = 0;
        const fetcher = vi.fn(async () => {
            concurrent++;
            maximum = Math.max(maximum, concurrent);
            await new Promise((r) => setTimeout(r, 2));
            concurrent--;
            return new Response(new Blob(['1234567890']));
        });
        vi.stubGlobal('fetch', fetcher);
        const cache = new ResourceCache(),
            progress = vi.fn();
        await cache.prepare(manifest(5), new AbortController().signal, progress);
        expect(maximum).toBe(2);
        expect(progress).toHaveBeenLastCalledWith(5);
        await cache.prepare(manifest(5), new AbortController().signal, progress);
        expect(fetcher).toHaveBeenCalledTimes(5);
        expect(cache.get(url(0))?.size).toBe(10);
    });
    it('bounds bytes, evicts old resources and clears on campaign teardown', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(new Blob(['1234567890']))),
        );
        const cache = new ResourceCache(10);
        await expect(
            cache.prepare(manifest(2), new AbortController().signal, () => {}),
        ).rejects.toThrow();
        await cache.prepare(manifest(), new AbortController().signal, () => {});
        await cache.prepare(
            { ...manifest(), resources: [{ url: url(2), bytes: 10, kind: 'audio' }] },
            new AbortController().signal,
            () => {},
        );
        expect(cache.get(url(0))).toBeUndefined();
        expect(cache.get(url(2))).toBeDefined();
        cache.clear();
        expect(cache.get(url(2))).toBeUndefined();
    });
    it('does not cache denied, aborted, oversized or expired resources', async () => {
        const cache = new ResourceCache();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('', { status: 403 })),
        );
        await expect(
            cache.prepare(manifest(), new AbortController().signal, () => {}),
        ).rejects.toThrow();
        expect(cache.get(url(0))).toBeUndefined();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(new Blob(['too big for declared size']))),
        );
        await expect(
            cache.prepare(manifest(), new AbortController().signal, () => {}),
        ).rejects.toThrow();
        const abort = new AbortController();
        abort.abort();
        await expect(cache.prepare(manifest(), abort.signal, () => {})).rejects.toThrow();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(new Blob(['small']))),
        );
        await cache.prepare(
            { ...manifest(), expiresAt: Date.now() - 1 },
            new AbortController().signal,
            () => {},
        );
        expect(cache.get(url(0))).toBeUndefined();
    });
});
