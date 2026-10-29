import { t } from '../i18n';
import type { SpatialEvent } from '../tabletop/types/spatial';
import { api } from '../api/workspace';
import { request } from '../api/client';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { SaveQueue } from '../tabletop/state/SaveQueue';
import type { LiveEcho } from './useCampaignLive';
import { reduceEvent, PreviewOrder, type SceneEvent, type MovePreview } from './protocol';

/** One scene subscription. A disposed subscriber can never hydrate its successor. */
export class SceneSubscriber {
    private spatialPending?: SpatialEvent;
    private spatialBusy = false;
    private spatialTimer: ReturnType<typeof setInterval>;
    private alive = true;
    private loading = false;
    private deferred = false;
    private buffer: SceneEvent[] = [];
    private controller?: AbortController;
    private unsubscribe: () => void;
    private timer: ReturnType<typeof setInterval>;
    private previews = new PreviewOrder();
    private sequence = 0;
    private inFlight = false;
    private lastSession = '';
    constructor(
        private echo: LiveEcho,
        private channel: string,
        private store: SceneStore,
        private queue: SaveQueue,
        private status: (message: string) => void,
    ) {
        store.spatial.onSend = (event) => {
            this.spatialPending = event;
        };
        this.spatialTimer = setInterval(() => {
            if (this.spatialBusy || !this.spatialPending || !this.alive) return;
            const event = this.spatialPending;
            this.spatialPending = undefined;
            if (
                !store.spatial.connected ||
                !store.spatial.shareActive ||
                event.epoch !== store.spatial.epoch
            )
                return;
            this.spatialBusy = true;
            void request(`/scenes/${event.sceneId}/spatial`, 'POST', event)
                .catch(() => {
                    /* Expendable overlay expires; saved state is unaffected. */
                })
                .finally(() => {
                    this.spatialBusy = false;
                });
        }, 80);
        echo.private(channel)
            .listen('.tabletop', this.receive)
            .subscribed(() => void this.resync())
            .error(() => {
                if (this.alive) status(t('Scene access changed. Reconnecting…'));
            });
        let previous = queue.getSnapshot().status;
        this.unsubscribe = queue.subscribe(() => {
            const next = queue.getSnapshot().status;
            if (next === 'saved' && previous !== 'saved' && this.deferred) void this.resync();
            previous = next;
        });
        store.onRevisionGap = () => {
            this.deferred = true;
            queueMicrotask(() => {
                if (this.alive && this.queue.getSnapshot().status === 'saved') void this.resync();
            });
        };
        store.onPreview = (id, position, cancelled) => {
            const dragSessionId = store.dragSessionId;
            if (!dragSessionId || (this.inFlight && !cancelled)) return;
            if (dragSessionId !== this.lastSession) {
                this.lastSession = dragSessionId;
                this.sequence = 0;
            }
            this.inFlight = true;
            void request(`/tokens/${id}/preview`, 'POST', {
                ...position,
                dragSessionId,
                sequence: ++this.sequence,
                baseRevision: store.getSnapshot().scene.revision,
                cancelled,
            })
                .catch(() => {
                    /* Preview is expendable. Final save reports actionable failures. */
                })
                .finally(() => {
                    this.inFlight = false;
                });
        };
        this.timer = setInterval(() => {
            if (this.loading || !this.alive) return;
            const scene = store.getSnapshot().scene;
            void request<{ revision: number }>(`/scenes/${scene.id}/revision`)
                .then((value) => {
                    if (
                        this.alive &&
                        (value.revision !== store.getSnapshot().scene.revision || this.deferred)
                    )
                        void this.resync();
                })
                .catch(() => {
                    if (this.alive) {
                        this.deferred = true;
                        status(t('Cannot reach the scene. Retrying…'));
                    }
                });
        }, 15000);
    }
    private receive = (event: SceneEvent | MovePreview | SpatialEvent) => {
        if (!this.alive) return;
        const scene = this.store.getSnapshot().scene;
        if (event.sceneId !== scene.id) return;
        if (event.type === 'spatial') {
            const spatial = event as SpatialEvent;
            if (
                spatial.epoch === this.store.spatial.epoch &&
                this.store.spatial.shareActive &&
                this.store.spatial.connected
            )
                this.store.spatial.accept(spatial);
            return;
        }
        if (event.type === 'token.move-preview') {
            const preview = event as MovePreview;
            if (this.previews.accept(scene, preview)) {
                if (preview.cancelled) this.store.remotePreviews.delete(preview.tokenId);
                else
                    this.store.remotePreviews.set(preview.tokenId, {
                        x: preview.x,
                        y: preview.y,
                        expires: performance.now() + 1200,
                    });
            }
            return;
        }
        if (!('revision' in event)) return;
        const change = event as SceneEvent;
        if (change.revision <= (scene.revision ?? 0)) return;
        if (
            change.payload.gameplayFeedback &&
            scene.tokens.some((t) => t.id === change.payload.gameplayFeedback!.tokenId)
        )
            this.store.onGameplayFeedback?.(change.payload.gameplayFeedback);
        this.previews.finish(change.dragSessionId);
        this.store.remotePreviews.clear();
        if (this.store.localMutations.has(change.mutationId)) {
            if (change.revision > (scene.revision ?? 0) + 1) this.deferred = true;
            return;
        }
        if (this.loading) {
            this.buffer.push(change);
            return;
        }
        if (this.queue.getSnapshot().status !== 'saved') {
            this.deferred = true;
            // Permission revocation and hiding must cancel an active player gesture immediately,
            // even while a previous command is awaiting its HTTP response.
            if (this.store.role === 'player') {
                const id = change.payload.deletedId;
                const denied =
                    change.payload.token?.canMove === false ? change.payload.token : undefined;
                if (id || denied)
                    this.store.reconcile({
                        ...scene,
                        tokens: scene.tokens
                            .filter((t) => t.id !== id)
                            .map((t) => (t.id === denied?.id ? { ...t, canMove: false } : t)),
                    });
            }
            return;
        }
        const next = reduceEvent(scene, change);
        if (next === 'gap') void this.resync();
        else if (next !== scene) this.store.reconcile(next);
    };
    async resync() {
        if (!this.alive || this.loading) return;
        if (this.queue.getSnapshot().status !== 'saved') {
            this.deferred = true;
            return;
        }
        this.loading = true;
        this.deferred = false;
        this.status(t('Syncing scene…'));
        this.controller = new AbortController();
        let staleSnapshot = false;
        try {
            const snapshot = await api.snapshot(
                this.store.getSnapshot().scene.id!,
                this.controller.signal,
            );
            if (!this.alive) return;
            if (this.queue.getSnapshot().status === 'saved') {
                if ((snapshot.revision ?? 0) < (this.store.getSnapshot().scene.revision ?? 0)) {
                    staleSnapshot = true;
                    this.deferred = true;
                } else {
                    this.store.remotePreviews.clear();
                    this.store.reconcile(snapshot);
                    this.status('');
                }
            } else this.deferred = true;
        } catch (error) {
            if (this.alive) {
                this.deferred = true;
                this.status((error as Error).message);
            }
        } finally {
            this.loading = false;
            const events = this.buffer;
            this.buffer = [];
            events.forEach(this.receive);
            if (staleSnapshot) void this.resync();
        }
    }
    destroy() {
        this.alive = false;
        this.controller?.abort();
        this.unsubscribe();
        clearInterval(this.timer);
        clearInterval(this.spatialTimer);
        this.store.spatial.onSend = undefined;
        this.store.spatial.clear();
        this.store.onPreview = undefined;
        this.store.onRevisionGap = undefined;
        this.store.remotePreviews.clear();
        this.echo.leave(this.channel);
    }
}
