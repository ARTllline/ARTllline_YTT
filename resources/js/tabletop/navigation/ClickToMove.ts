import type { SceneStore } from '../state/SceneStore';
import type { InteractionLayer } from '../layers/InteractionLayer';
import type { Point, Scene, Token } from '../types/scene';
import {
    movementCost,
    movementObstacles,
    movementPortals,
    movementRange,
    routeLength,
} from '../utils/movement';
import { snapPoint } from '../utils/coordinates';
import type { RouteResult } from './pathfinding';

/** A bounded ordinary movement command. Esc never needs to undo committed state. */
export function routeStep(path: readonly Point[], maximum = 72): { step: Point[]; rest: Point[] } {
    const step = [path[0]];
    let remaining = maximum;
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1],
            b = path[i],
            length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length > remaining) {
            const end = {
                x: Math.round((a.x + ((b.x - a.x) * remaining) / length) * 1000) / 1000,
                y: Math.round((a.y + ((b.y - a.y) * remaining) / length) * 1000) / 1000,
            };
            step.push(end);
            return { step, rest: [end, ...path.slice(i)] };
        }
        step.push(b);
        remaining -= length;
    }
    return { step, rest: [] };
}

export function routeCost(scene: Scene, token: Token, path: Point[]) {
    let cost = 0,
        remaining = path;
    while (remaining.length > 1) {
        const { step, rest } = routeStep(remaining);
        cost += movementCost(scene, token, routeLength(step));
        remaining = rest;
    }
    return Math.round(cost * 10000) / 10000;
}

const messages = {
    unreachable: 'Маршрут не найден. Выберите другую точку.',
    budget: 'Маршрут слишком сложен для быстрого поиска. Выберите более близкую точку.',
    waypoints:
        'Найденный маршрут не укладывается в 16 промежуточных точек. Выберите более близкую цель.',
};

/** Presentation only: proposes normal token.move; MAP-07A owns acceptance. */
export class ClickToMove {
    private worker?: Worker;
    private timeout?: ReturnType<typeof setTimeout>;
    private awaiting?: {
        scene: Scene;
        tokenId: string;
        update: ReturnType<SceneStore['getSnapshot']>['movementUpdate'];
    };
    private deferred?: { id: string; destination: Point; instant: boolean };
    private running?: { path: Point[]; nextAt: number };
    private context?: {
        scene: Scene;
        token: Token;
        target: Point;
        instant: boolean;
        path?: Point[];
        length?: number;
    };
    constructor(
        private store: SceneStore,
        private overlay: InteractionLayer,
    ) {
        store.confirmRoute = this.confirm;
        store.cancelRoute = this.cancel;
    }
    eligible(id: string) {
        const state = this.store.getSnapshot();
        return (
            !state.directControl &&
            this.store.canMove(id) &&
            !this.store.abilityTargeting &&
            this.store.spatial.tool === 'select' &&
            !state.mapEditor &&
            !state.mapDraft &&
            !this.store.onMapCalibration
        );
    }
    request(id: string, destination: Point, instant = false) {
        this.cancel();
        if (!this.eligible(id)) return;
        const scene = this.store.getSnapshot().scene;
        const token = scene.tokens.find((t) => t.id === id)!;
        const target = snapPoint(destination, scene.grid);
        const context = (this.context = { scene, token, target, instant });
        if (this.awaiting) {
            this.deferred = { id, destination, instant };
            this.store.setRoutePreview({
                status: 'searching',
                tokenId: id,
                message: 'Ожидание предыдущего перемещения… · Esc — отмена',
            });
            return;
        }
        if (Math.hypot(target.x - token.x, target.y - token.y) < 0.001) {
            this.context = undefined;
            return;
        }
        this.store.setRoutePreview({
            status: 'searching',
            tokenId: id,
            message: 'Поиск маршрута… · Esc — отмена',
        });
        const fail = (message: string) => {
            if (this.context !== context) return;
            this.stopWorker();
            this.store.setRoutePreview({ status: 'error', tokenId: id, message });
        };
        try {
            const worker = (this.worker = new Worker(
                new URL('./pathfinding.worker.ts', import.meta.url),
                { type: 'module' },
            ));
            worker.onerror = () => fail('Не удалось рассчитать маршрут. Повторите перемещение.');
            worker.onmessage = ({ data }: MessageEvent<RouteResult>) => {
                if (this.context !== context) return;
                this.stopWorker();
                if (!this.valid()) {
                    this.cancel();
                    return;
                }
                if (data.status !== 'found') {
                    fail(messages[data.status]);
                    return;
                }
                this.context = { ...context, path: data.path, length: data.length };
                const range = movementRange(scene, token);
                const cost = instant
                    ? movementCost(scene, token, data.length)
                    : routeCost(scene, token, data.path);
                const entry = scene.combat?.combatants.find((c) => c.tokenId === id);
                const remaining = entry?.budget?.movementRemaining ?? 0;
                const allowed = range === undefined || (range > 0 && cost <= remaining + 0.00005);
                this.store.setRoutePreview({
                    status: 'ready',
                    tokenId: id,
                    allowed,
                    cost,
                    remaining: range === undefined ? undefined : remaining,
                    message: allowed
                        ? 'Маршрут готов · Esc — отмена'
                        : 'Недостаточно перемещения или сейчас не ваш ход. Выберите более близкую точку.',
                });
                if (range === undefined || instant) this.confirm();
            };
            this.timeout = setTimeout(() => fail(messages.budget), 2000);
            worker.postMessage({
                start: { x: token.x, y: token.y },
                target,
                radius: (token.size * token.scale) / 2,
                width: scene.width,
                height: scene.height,
                gridSize: scene.grid.size,
                obstacles: movementObstacles(scene),
                portals: movementPortals(scene, (token.size * token.scale) / 2),
            });
        } catch {
            fail('Не удалось запустить поиск маршрута. Повторите перемещение.');
        }
    }
    private valid() {
        const state = this.store.getSnapshot(),
            context = this.context;
        return (
            !!context &&
            context.scene === state.scene &&
            state.selectedIds.length === 1 &&
            state.selectedIds[0] === context.token.id &&
            this.eligible(context.token.id)
        );
    }
    confirm = () => {
        const preview = this.store.getSnapshot().routePreview;
        if (!this.valid()) {
            this.cancel();
            return;
        }
        const context = this.context!;
        if (preview?.status !== 'ready' || !preview.allowed || !context.path) return;
        this.awaiting = {
            scene: context.scene,
            tokenId: context.token.id,
            update: this.store.getSnapshot().movementUpdate,
        };
        this.store.setRoutePreview({
            ...preview,
            status: 'sending',
            message: 'Движение · Esc — остановить',
        });
        const { step, rest } = context.instant
            ? { step: context.path, rest: [] }
            : routeStep(context.path);
        if (!context.instant) this.running = { path: rest, nextAt: performance.now() + 200 };
        this.store.moveToken(
            context.token.id,
            step.at(-1)!,
            undefined,
            step.slice(1, -1),
            context.instant ? true : undefined,
        );
    };
    sync(zoom: number) {
        const state = this.store.getSnapshot(),
            awaiting = this.awaiting;
        if (
            awaiting &&
            state.movementUpdate !== awaiting.update &&
            (state.movementUpdate?.reset ||
                state.movementUpdate?.movements?.some((move) => move.tokenId === awaiting.tokenId))
        ) {
            this.awaiting = undefined;
            if (this.running && this.context) {
                const before = awaiting.scene,
                    next = state.scene;
                if (
                    state.movementUpdate?.reset ||
                    before.structure !== next.structure ||
                    before.props !== next.props ||
                    before.grid !== next.grid ||
                    before.mapWorld !== next.mapWorld ||
                    before.id !== next.id ||
                    before.width !== next.width ||
                    before.height !== next.height ||
                    before.combat?.status !== next.combat?.status ||
                    before.combat?.round !== next.combat?.round ||
                    JSON.stringify(before.combat?.currentTurn) !==
                        JSON.stringify(next.combat?.currentTurn)
                ) {
                    this.cancel();
                    return;
                }
                const token = next.tokens.find((t) => t.id === awaiting.tokenId);
                const expected = this.running.path[0];
                if (
                    !token ||
                    token.size !== this.context.token.size ||
                    token.scale !== this.context.token.scale ||
                    (expected && (token.x !== expected.x || token.y !== expected.y))
                ) {
                    this.cancel();
                    return;
                }
                this.context = { ...this.context, scene: next, token, path: this.running.path };
                if (!this.running.path.length) {
                    this.cancel();
                    return;
                }
            }
            const deferred = this.deferred;
            this.deferred = undefined;
            if (deferred) {
                const before = awaiting.scene,
                    next = state.scene;
                const sameGeometry =
                    before.structure === next.structure &&
                    before.props === next.props &&
                    before.grid === next.grid &&
                    before.mapWorld === next.mapWorld &&
                    before.width === next.width &&
                    before.height === next.height;
                const sameTurn =
                    before.combat?.status === next.combat?.status &&
                    before.combat?.id === next.combat?.id &&
                    before.combat?.round === next.combat?.round &&
                    JSON.stringify(before.combat?.currentTurn) ===
                        JSON.stringify(next.combat?.currentTurn);
                if (
                    !state.movementUpdate?.reset &&
                    sameGeometry &&
                    sameTurn &&
                    state.selectedIds[0] === deferred.id &&
                    state.selectedIds.length === 1 &&
                    this.eligible(deferred.id)
                )
                    this.request(deferred.id, deferred.destination, deferred.instant);
                else this.cancel();
                return;
            }
        }
        if (!this.context) return;
        if (!this.valid()) {
            this.cancel();
            return;
        }
        if (this.running && !this.awaiting && performance.now() >= this.running.nextAt) {
            const context = this.context!,
                { step, rest } = routeStep(this.running.path);
            this.running = { path: rest, nextAt: performance.now() + 200 };
            this.awaiting = {
                scene: state.scene,
                tokenId: context.token.id,
                update: state.movementUpdate,
            };
            this.store.moveToken(context.token.id, step.at(-1)!, undefined, step.slice(1, -1));
            return;
        }
        const { path, token, scene, target } = this.context;
        if (path)
            this.overlay.showMovement(
                path[0],
                path.at(-1)!,
                (token.size * token.scale) / 2,
                zoom,
                !this.store.getSnapshot().routePreview?.allowed,
                scene.grid,
                movementRange(scene, token),
                false,
                [],
                path,
            );
        else
            this.overlay.showDestination(
                target,
                (token.size * token.scale) / 2,
                zoom,
                state.routePreview?.status === 'error',
            );
    }
    private stopWorker() {
        this.worker?.terminate();
        this.worker = undefined;
        clearTimeout(this.timeout);
        this.timeout = undefined;
    }
    cancel = () => {
        this.running = undefined;
        this.stopWorker();
        this.deferred = undefined;
        this.context = undefined;
        this.overlay.clear();
        if (this.store.getSnapshot().routePreview) this.store.setRoutePreview(undefined);
    };
    destroy() {
        this.cancel();
        this.awaiting = undefined;
        this.store.confirmRoute = undefined;
        this.store.cancelRoute = undefined;
    }
}
