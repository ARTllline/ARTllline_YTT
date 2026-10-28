import { t } from '../../i18n';
import type { FogStroke, SpatialEvent } from '../types/spatial';
import type { Tool } from '../types/scene';

/** Ephemeral projections are deliberately outside the saved scene and React's frame loop. */
export class SpatialState {
    tool: Tool = 'select';
    settings = {
        operation: 'reveal' as 'reveal' | 'cover',
        shape: 'brush' as 'brush' | 'rectangle',
        radius: 90,
        snap: true,
    };
    draft: FogStroke | null = null;
    identity = { id: 'local', name: t('You') };
    shareActive = false;
    connected = false;
    epoch = 0;
    private lastSessionTime = 0;
    nextSessionTime() {
        this.lastSessionTime = Math.max(Date.now(), this.lastSessionTime + 1);
        return this.lastSessionTime;
    }
    onSend?: (event: SpatialEvent) => void;
    readonly overlays = new Map<string, { event: SpatialEvent; expires: number; born: number }>();
    private order = new Map<
        string,
        { startedAt: number; sequence: number; terminal: boolean; sessionId: string }
    >();
    private listeners = new Set<() => void>();
    subscribe = (fn: () => void) => {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    };
    getTool = () => this.tool;
    configure(identity: { id: string; name: string }, active: boolean, epoch: number) {
        this.identity = identity;
        this.shareActive = active;
        this.epoch = epoch;
        this.clear();
    }
    setConnected(value: boolean) {
        this.connected = value;
        if (!value) this.clear();
    }
    setSettings(patch: Partial<typeof this.settings>) {
        this.settings = { ...this.settings, ...patch };
    }
    setTool(tool: Tool) {
        this.tool = tool;
        this.listeners.forEach((fn) => fn());
    }
    accept(event: SpatialEvent, now = performance.now()) {
        const key = event.participant.id;
        const last = this.order.get(key);
        if (
            last &&
            (event.startedAt < last.startedAt ||
                (event.sessionId === last.sessionId &&
                    ((last.terminal && event.phase !== 'cancel') ||
                        event.sequence <= last.sequence)))
        )
            return false;
        this.order.set(key, {
            startedAt: event.startedAt,
            sequence: event.sequence,
            terminal: event.phase !== 'update',
            sessionId: event.sessionId,
        });
        if (this.order.size > 256) this.order.delete(this.order.keys().next().value!);
        if (event.phase === 'cancel') this.overlays.delete(key);
        else
            this.overlays.set(key, {
                event,
                born: now,
                expires: now + (event.kind === 'ping' ? 2200 : event.phase === 'end' ? 5000 : 1800),
            });
        return true;
    }
    send(event: SpatialEvent) {
        this.accept(event);
        if (this.shareActive && this.connected) this.onSend?.(event);
    }
    expire(now = performance.now()) {
        for (const [key, value] of this.overlays)
            if (value.expires <= now) this.overlays.delete(key);
    }
    clear() {
        this.overlays.clear();
        this.draft = null;
    }
}
