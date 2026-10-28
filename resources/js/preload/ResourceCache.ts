export interface PreloadManifest {
    id: string;
    expiresAt: number;
    resources: { url: string; bytes: number; kind: 'image' | 'audio' }[];
}

/** Bounded, page-local private bytes. No persistence, filenames or playback here. */
export class ResourceCache {
    private entries = new Map<string, { blob: Blob; expires: number; objectUrl: string }>();
    private bytes = 0;
    constructor(private limit = 128 * 1024 * 1024) {}
    imageUrl(url: string): string {
        const entry = this.entries.get(url);
        return entry && entry.expires > Date.now() ? entry.objectUrl : url;
    }
    get(url: string): Blob | undefined {
        const entry = this.entries.get(url);
        if (!entry) return;
        if (entry.expires <= Date.now()) {
            this.remove(url);
            return;
        }
        this.entries.delete(url);
        this.entries.set(url, entry);
        return entry.blob;
    }
    private remove(url: string) {
        const entry = this.entries.get(url);
        if (entry) {
            this.bytes -= entry.blob.size;
            URL.revokeObjectURL(entry.objectUrl);
        }
        this.entries.delete(url);
    }
    clear() {
        for (const url of this.entries.keys()) this.remove(url);
        this.bytes = 0;
    }
    async prepare(
        manifest: PreloadManifest,
        signal: AbortSignal,
        progress: (loaded: number) => void,
    ) {
        if (
            manifest.resources.length > 128 ||
            manifest.resources.reduce((n, r) => n + r.bytes, 0) > this.limit
        )
            throw new Error('Набор ресурсов превышает размер кеша.');
        let index = 0,
            loaded = 0;
        const worker = async () => {
            while (index < manifest.resources.length) {
                signal.throwIfAborted();
                const resource = manifest.resources[index++];
                if (!/^\/api\/media\/[a-f0-9-]{36}$/.test(resource.url))
                    throw new Error('Недопустимый адрес ресурса.');
                if (!this.get(resource.url)) {
                    const response = await fetch(resource.url, {
                        credentials: 'same-origin',
                        cache: 'no-store',
                        signal,
                    });
                    if (!response.ok)
                        throw new Error('Ресурс не загрузился. Можно повторить подготовку.');
                    const blob = await response.blob();
                    signal.throwIfAborted();
                    if (blob.size > resource.bytes || blob.size > this.limit)
                        throw new Error('Размер ресурса изменился.');
                    while (this.bytes + blob.size > this.limit && this.entries.size)
                        this.remove(this.entries.keys().next().value!);
                    this.remove(resource.url);
                    this.entries.set(resource.url, {
                        blob,
                        expires: manifest.expiresAt,
                        objectUrl: URL.createObjectURL(blob),
                    });
                    this.bytes += blob.size;
                } else {
                    this.entries.get(resource.url)!.expires = manifest.expiresAt;
                }
                progress(++loaded);
            }
        };
        await Promise.all([worker(), worker()]);
    }
}
export const resourceCache = new ResourceCache();
