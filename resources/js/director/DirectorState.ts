export interface DirectorEvent {
    type: 'director.action';
    sceneId: string;
    epoch: number;
    runId: string;
    eventId: string;
    sequence: number;
    action: string;
    sentAt: number;
    expiresAt: number;
    config: {
        x?: number;
        y?: number;
        zoom?: number;
        duration?: number;
        strength?: string;
        blackout?: boolean;
        title?: string;
        text?: string;
        terminal?: boolean;
        color?: string;
    };
}
export interface DirectorSnapshot {
    directed: boolean;
    blackout: boolean;
    fadeDuration: number;
    message: { title?: string; text: string } | null;
    pulse?: { id: string; kind: string; color: string; duration: number };
}
const empty = (): DirectorSnapshot => ({
    directed: false,
    blackout: false,
    fadeDuration: 0,
    message: null,
});

/** Presentation-only ordering/expiry. Never hydrates from scene snapshots. */
export class DirectorState {
    private snapshot = empty();
    private listeners = new Set<() => void>();
    private seen = new Set<string>();
    private orders = new Map<string, number>();
    private closed = new Set<string>();
    private current = '';
    private newestRunAt = 0;
    private expires = 0;
    private messageUntil = 0;
    onCamera: (event: DirectorEvent | null) => void = () => {};
    bindCamera(callback: (event: DirectorEvent | null) => void) {
        this.onCamera = callback;
    }
    constructor(
        private sceneId: string,
        private epoch: number,
    ) {}
    getSnapshot = () => this.snapshot;
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    private emit() {
        this.listeners.forEach((fn) => fn());
    }
    accept(event: DirectorEvent, now = Date.now()) {
        if (
            event.type !== 'director.action' ||
            event.sceneId !== this.sceneId ||
            event.epoch !== this.epoch ||
            event.expiresAt <= now ||
            this.seen.has(event.eventId) ||
            this.closed.has(event.runId) ||
            event.sequence < (this.orders.get(event.runId) ?? -1) ||
            (event.runId !== this.current && event.sentAt < this.newestRunAt)
        )
            return false;
        this.seen.add(event.eventId);
        this.orders.set(event.runId, event.sequence);
        if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
        if (this.orders.size > 128) this.orders.delete(this.orders.keys().next().value!);
        if (event.runId !== this.current) this.newestRunAt = event.sentAt;
        this.current = event.runId;
        this.expires = Math.min(event.expiresAt, now + 70000);
        if (event.action === 'clear') {
            if (event.config.terminal !== false) this.closeRun(event.runId);
            this.reset();
            return true;
        }
        const config = event.config;
        if (event.action === 'message') {
            this.snapshot = {
                ...this.snapshot,
                message: { title: config.title, text: config.text ?? '' },
            };
            this.messageUntil = now + (config.duration ?? 3000);
        } else if (event.action.startsWith('screen.')) {
            this.snapshot = {
                ...this.snapshot,
                pulse: {
                    id: event.eventId,
                    kind: event.action === 'screen.flash' ? 'flash' : 'vignette',
                    color: config.color ?? '#ffffff',
                    duration: config.duration ?? 600,
                },
            };
        } else if (event.action === 'camera.fade') {
            this.snapshot = {
                ...this.snapshot,
                blackout: !!config.blackout,
                fadeDuration: config.duration ?? 300,
            };
        } else if (event.action === 'camera.release') {
            this.onCamera(null);
            this.snapshot = { ...this.snapshot, directed: false };
        } else {
            this.onCamera(event);
            this.snapshot = { ...this.snapshot, directed: true };
        }
        this.emit();
        return true;
    }
    private closeRun(id: string) {
        this.closed.add(id);
        if (this.closed.size > 128) this.closed.delete(this.closed.values().next().value!);
    }
    release = () => {
        if (this.current) this.closeRun(this.current);
        this.reset();
    };
    reset = () => {
        this.onCamera(null);
        this.snapshot = empty();
        this.expires = 0;
        this.messageUntil = 0;
        this.emit();
    };
    tick(now = Date.now()) {
        if (this.expires && now >= this.expires) {
            this.release();
            return;
        }
        if (this.messageUntil && now >= this.messageUntil) {
            this.messageUntil = 0;
            this.snapshot = { ...this.snapshot, message: null };
            this.emit();
        }
    }
}
