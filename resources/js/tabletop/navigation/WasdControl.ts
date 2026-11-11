import { sameMovementGeometry } from './movementContext';
import { request } from '../../api/client';
import { commandId, type Mutation, type ControlReceipt } from '../../api/workspace';
import { predictionRemainder } from './prediction';
import type { SceneStore } from '../state/SceneStore';
import type { Point, Scene } from '../types/scene';
import { movementBlocked, movementObstacles, routeLength } from '../utils/movement';

export const directTiming = {
    speed: 180,
    interval: 200,
    step: 35.9,
    ahead: 71.8,
    timeout: 900,
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const canonical = (p: Point) => ({
    x: Math.round(p.x * 1000) / 1000,
    y: Math.round(p.y * 1000) / 1000,
});
export const typing = () =>
    !!document.querySelector('dialog[open],[role="dialog"],[aria-modal="true"]') ||
    !!document.activeElement?.closest(
        'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]),textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
    );

export function inputDirection(keys: ReadonlySet<string>): Point {
    const x = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    const y = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));
    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
}

/** Input assistance only: every candidate uses the unchanged swept footprint check. */
export function directStep(
    current: Point,
    delta: Point,
    radius: number,
    obstacles: ReturnType<typeof movementObstacles>,
    bounds?: { width: number; height: number },
): Point {
    const safe = (p: Point) =>
        (!bounds ||
            (p.x >= radius &&
                p.y >= radius &&
                p.x <= bounds.width - radius &&
                p.y <= bounds.height - radius)) &&
        !movementBlocked(current, p, radius + 0.01, obstacles);
    const next = canonical({ x: current.x + delta.x, y: current.y + delta.y });
    if (safe(next)) return next;
    // Prefer a clear axis when pushing diagonally into a wall. No corner cutting,
    // increased speed or hidden-geometry inference; the server checks this path again.
    const candidates = [
        canonical({ x: next.x, y: current.y }),
        canonical({ x: current.x, y: next.y }),
    ].filter(safe);
    let low = 0,
        high = 1;
    for (let i = 0; i < 8; i++) {
        const middle = (low + high) / 2;
        if (safe(canonical({ x: current.x + delta.x * middle, y: current.y + delta.y * middle })))
            low = middle;
        else high = middle;
    }
    const partial = canonical({ x: current.x + delta.x * low, y: current.y + delta.y * low });
    if (safe(partial)) candidates.push(partial);
    return candidates.sort((a, b) => distance(current, b) - distance(current, a))[0] ?? current;
}

/** One bounded stream attached to Pixi's existing ticker; canonical state stays in SceneStore. */
export class WasdControl {
    private keys = new Set<string>();
    private abort = new AbortController();
    private generation = 0;
    private stream?: string;
    private sequence = 0;
    private busy = false;
    private lastSend = 0;
    private lastReceipt = 0;
    private networkMs = 200;
    private speed = directTiming.speed;
    private batch = directTiming.step;
    private batching = false;
    private recovery?: { update: ReturnType<SceneStore['getSnapshot']>['movementUpdate'] };
    private direction: Point = { x: 0, y: 0 };
    private authority?: Point;
    private pendingLength = 0;
    private path: Point[] = [];
    private context?: Scene;
    private update?: ReturnType<SceneStore['getSnapshot']>['movementUpdate'];
    private obstacles: ReturnType<typeof movementObstacles> = [];
    private tokenId?: string;
    private unsubscribe: () => void;
    constructor(
        private canvas: HTMLCanvasElement,
        private store: SceneStore,
        private cancelGesture: () => void,
    ) {
        store.toggleDirectControl = this.toggle;
        store.stopDirectControl = this.stop;
        this.unsubscribe = store.subscribe(() => this.recover());
        const signal = this.abort.signal;
        window.addEventListener('keydown', this.keyDown, { signal, capture: true });
        window.addEventListener('keyup', this.keyUp, { signal, capture: true });
        window.addEventListener('blur', this.stop, { signal });
        window.addEventListener('offline', this.stop, { signal });
        document.addEventListener(
            'visibilitychange',
            () => {
                if (document.hidden) this.stop();
            },
            { signal },
        );
        document.addEventListener(
            'focusin',
            () => {
                if (typing()) this.stop();
            },
            { signal },
        );
        // Pointer input explicitly hands control back to existing Drag / Click-to-Move.
        window.addEventListener(
            'pointerdown',
            (event) => {
                if (
                    !(event.target instanceof Element) ||
                    !event.target.closest('.direct-control-controls')
                )
                    this.stop();
            },
            { signal, capture: true },
        );
    }
    private recover() {
        const update = this.store.getSnapshot().movementUpdate;
        if (this.recovery && update !== this.recovery.update && update?.reset)
            this.recovery = undefined;
    }
    eligible(id: string) {
        const s = this.store.getSnapshot();
        if (this.recovery) return false;
        return (
            this.store.canMove(id) &&
            this.store.spatial.connected &&
            s.scene.tokens.some((t) => t.id === id && t.kind === 'player_character') &&
            s.scene.combat?.status !== 'active' &&
            !s.mapEditor &&
            !s.mapDraft &&
            !this.store.abilityTargeting &&
            !this.store.onMapCalibration &&
            this.store.spatial.tool === 'select' &&
            !s.routePreview
        );
    }
    toggle = () => {
        if (this.tokenId) {
            this.stop();
            return;
        }
        const state = this.store.getSnapshot(),
            id = state.selectedIds[0];
        if (
            this.busy ||
            this.store.directCommandPending ||
            state.selectedIds.length !== 1 ||
            !this.eligible(id)
        )
            return;
        this.cancelGesture();
        this.store.setDirectNotice();
        const token = state.scene.tokens.find((t) => t.id === id)!;
        this.tokenId = id;
        this.networkMs = 200;
        this.speed = directTiming.speed;
        this.batch = directTiming.step;
        this.batching = false;
        this.authority = { x: token.x, y: token.y };
        this.path = [this.authority];
        this.context = state.scene;
        this.update = state.movementUpdate;
        this.obstacles = movementObstacles(state.scene);
        this.canvas.focus({ preventScroll: true });
        this.store.setDirectControl({ tokenId: id, follow: false });
    };
    private keyDown = (e: KeyboardEvent) => {
        if (!this.tokenId) return;
        if (typing() || e.ctrlKey || e.metaKey || e.altKey) {
            this.stop();
            return;
        }
        if (e.code === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.stop();
            return;
        }
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.keys.add(e.code);
        } else if (!e.repeat) this.stop();
    };
    private keyUp = (e: KeyboardEvent) => {
        this.keys.delete(e.code);
    };
    stop = () => {
        const active = !!this.tokenId;
        this.generation++;
        this.keys.clear();
        this.tokenId = undefined;
        this.stream = undefined;
        this.path = [];
        this.pendingLength = 0;
        this.authority = undefined;
        this.direction = { x: 0, y: 0 };
        if (active) this.store.setDirectControl(undefined);
    };
    /** Called before rendering every frame, also checks non-observable connection/tool flags. */
    tick(
        deltaMs: number,
        now = performance.now(),
    ): { id: string; position: Point; follow: boolean } | undefined {
        const id = this.tokenId;
        if (!id) return;
        const state = this.store.getSnapshot(),
            scene = state.scene,
            before = this.context!;
        const token = scene.tokens.find((t) => t.id === id);
        const reset = this.update !== state.movementUpdate && state.movementUpdate?.reset;
        const geometryChanged =
            this.update !== state.movementUpdate
                ? state.movementUpdate?.geometryChanged
                : undefined;
        this.update = state.movementUpdate;
        if (
            !token ||
            !this.eligible(id) ||
            typing() ||
            reset ||
            scene.id !== before.id ||
            scene.width !== before.width ||
            scene.height !== before.height ||
            state.selectedIds.length !== 1 ||
            state.selectedIds[0] !== id ||
            (scene !== before && !sameMovementGeometry(scene, before, geometryChanged)) ||
            distance(token, this.authority!) > 0.002
        ) {
            this.stop();
            return;
        }
        if (scene.props !== before.props) this.obstacles = movementObstacles(scene);
        this.context = scene;
        const input = inputDirection(this.keys);
        const moving = !!(input.x || input.y);
        if (!moving)
            this.direction = input; // No inertia after keyup.
        else if (!this.direction.x && !this.direction.y) this.direction = input;
        else {
            const blend = 1 - Math.exp(-Math.min(32, deltaMs) / 45);
            const x = this.direction.x + (input.x - this.direction.x) * blend;
            const y = this.direction.y + (input.y - this.direction.y) * blend;
            const length = Math.hypot(x, y);
            // Opposite input must reverse promptly rather than asymptotically stick.
            this.direction =
                x * input.x + y * input.y < 0 || length < 0.001
                    ? input
                    : distance(this.direction, input) < 0.02
                      ? input
                      : { x: x / length, y: y / length };
        }
        const direction = this.direction;
        if (!this.busy && moving && (!this.stream || now - this.lastReceipt > 700)) {
            this.open(id); // Expired/idle streams never replay old inputs.
        }
        const current = this.path.at(-1)!;
        const backlog = routeLength(this.path) + this.pendingLength;
        const sustainable = this.batching
            ? directTiming.speed
            : Math.min(directTiming.speed, (directTiming.step * 1000) / this.networkMs);
        this.speed += (sustainable - this.speed) * (1 - Math.exp(-Math.min(32, deltaMs) / 150));
        const amount = Math.min(
            (this.speed * Math.min(32, deltaMs)) / 1000,
            (this.batching ? this.batch * 2 : directTiming.ahead) - backlog,
        );
        if (moving && amount > 0 && this.path.length < 18) {
            const r = (token.size * token.scale) / 2;
            const next = directStep(
                current,
                { x: direction.x * amount, y: direction.y * amount },
                r,
                this.obstacles,
                scene.mapWorld ? scene : undefined,
            );
            if (distance(current, next) > 0.001) {
                const previous = this.path.at(-2);
                // Collapse only collinear, same-direction samples; preserve collision corners.
                if (
                    previous &&
                    Math.abs(
                        (current.x - previous.x) * (next.y - current.y) -
                            (current.y - previous.y) * (next.x - current.x),
                    ) < 0.005 &&
                    (current.x - previous.x) * (next.x - current.x) +
                        (current.y - previous.y) * (next.y - current.y) >=
                        0
                )
                    this.path[this.path.length - 1] = next;
                else this.path.push(next);
            }
        }
        if (
            !this.busy &&
            this.stream &&
            now - this.lastSend >= directTiming.interval &&
            routeLength(this.path) > 0.01
        )
            this.send(id, now);
        return { id, position: this.path.at(-1)!, follow: !!state.directControl?.follow };
    }
    private async open(id: string) {
        this.busy = true;
        const generation = this.generation;
        const began = performance.now();
        try {
            const stream = commandId();
            const result = await request<
                Partial<ControlReceipt> & { streamId: string; position: Point }
            >(
                `/tokens/${id}/control/start`,
                'POST',
                { streamId: stream, batching: true, clientMutationId: commandId() },
                AbortSignal.timeout(directTiming.timeout),
            );
            if (generation !== this.generation) return;
            if (distance(result.position, this.authority!) > 0.002)
                throw Error('Позиция изменилась.');
            this.stream = result.streamId;
            this.sequence = 0;
            this.batching = result.maxBatchDistance !== undefined && result.acceptedSequence === 0;
            this.batch = this.batching
                ? Math.min(126, result.maxBatchDistance!) - 0.1
                : directTiming.step;
            this.lastReceipt = performance.now();
            this.networkMs = Math.max(200, this.lastReceipt - began);
            this.lastSend = this.lastReceipt; // Accrue server-time credit before first step.
        } catch {
            if (generation === this.generation) this.fail();
        } finally {
            this.busy = false;
        }
    }
    private async send(id: string, now: number) {
        const path = [this.path[0]];
        let remaining = this.batch;
        while (this.path.length > 1 && path.length < 18) {
            const a = this.path[0],
                b = this.path[1],
                length = distance(a, b);
            if (length > remaining) {
                const end = canonical({
                    x: a.x + ((b.x - a.x) * remaining) / length,
                    y: a.y + ((b.y - a.y) * remaining) / length,
                });
                path.push(end);
                this.path[0] = end;
                break;
            }
            path.push(b);
            this.path.shift();
            remaining -= length;
            if (remaining < 0.01) break;
        }
        const end = path.at(-1)!;
        const generation = this.generation,
            sceneId = this.context!.id;
        this.pendingLength = routeLength(path);
        this.busy = true;
        this.lastSend = now;
        this.store.directCommandPending = true;
        const mutationId = commandId();
        this.store.trackMutation(mutationId);
        try {
            const result = await request<Mutation>(
                `/tokens/${id}/control/step`,
                'POST',
                {
                    streamId: this.stream,
                    sequence: ++this.sequence,
                    origin: this.authority,
                    ...end,
                    waypoints: path.slice(1, -1),
                    clientMutationId: mutationId,
                },
                AbortSignal.timeout(directTiming.timeout),
            );
            if (generation === this.generation) {
                const receipt = result.controlReceipt;
                if (this.batching) {
                    if (
                        !receipt ||
                        receipt.streamId !== this.stream ||
                        receipt.acceptedSequence !== this.sequence ||
                        !result.token ||
                        distance(receipt.position, result.token) > 0.002
                    )
                        throw Error('Несогласованное подтверждение движения.');
                    this.path = predictionRemainder(
                        path,
                        receipt.acceptedDistance,
                        receipt.position,
                        this.path,
                    );
                }
                this.authority = { x: result.token!.x, y: result.token!.y };
                this.pendingLength = 0;
                this.lastReceipt = performance.now();
                const measured = Math.max(200, this.lastReceipt - now);
                this.networkMs = Math.max(measured, this.networkMs * 0.7 + measured * 0.3);
            }
            if (this.store.getSnapshot().scene.id === sceneId) {
                this.store.onMovementReceipt?.(result.revision);
                this.store.accept(result, true);
            }
        } catch {
            // Esc/blur cancels unsent input, not a server commit. An ambiguous
            // result still needs a snapshot even if that presentation generation ended.
            if (this.store.getSnapshot().scene.id === sceneId) this.fail();
        } finally {
            this.busy = false;
            this.store.directCommandPending = false;
            this.store.onMovementSettled?.();
        }
    }
    private fail() {
        if (this.abort.signal.aborted) {
            // A successor renderer owns presentation now. It still needs the
            // unknown commit resolved, but this disposed controller cannot stop it.
            this.store.onRevisionGap?.();
            return;
        }
        this.recovery = { update: this.store.getSnapshot().movementUpdate };
        this.stop();
        this.store.setDirectNotice('Перемещение остановлено. Синхронизация позиции…');
        this.store.onRevisionGap?.();
    }
    destroy() {
        this.stop();
        this.unsubscribe();
        this.abort.abort();
        this.store.toggleDirectControl = undefined;
        this.store.stopDirectControl = undefined;
    }
}
