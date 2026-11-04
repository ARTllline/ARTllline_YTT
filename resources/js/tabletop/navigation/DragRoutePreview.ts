import type { InteractionLayer } from '../layers/InteractionLayer';
import type { Point, Scene, Token } from '../types/scene';
import { movementCost, movementObstacles, movementPortals, movementRange } from '../utils/movement';
import type { RouteResult } from './pathfinding';

type Target = { scene: Scene; token: Token; point: Point };

/** One serial Worker per drag, latest target only. Never issues gameplay commands. */
export class DragRoutePreview {
    private latest?: Target;
    private job?: Target;
    private result?: RouteResult;
    private worker?: Worker;
    private timer?: ReturnType<typeof setTimeout>;
    private deadline?: ReturnType<typeof setTimeout>;
    private lastStarted = -Infinity;

    constructor(private overlay: InteractionLayer) {}

    preview(scene: Scene, token: Token, point: Point, zoom: number) {
        if (
            this.latest?.scene !== scene ||
            this.latest.token !== token ||
            this.latest.point.x !== point.x ||
            this.latest.point.y !== point.y
        ) {
            // Geometry, canonical state and budget changes invalidate all old work.
            if (this.latest && (this.latest.scene !== scene || this.latest.token !== token))
                this.cancel();
            this.latest = { scene, token, point };
            this.result = undefined;
            this.schedule();
        }
        const radius = (token.size * token.scale) / 2;
        const result = this.result;
        if (result?.status === 'found') {
            const range = movementRange(scene, token);
            const remaining =
                scene.combat?.combatants.find((c) => c.tokenId === token.id)?.budget
                    ?.movementRemaining ?? 0;
            const blocked =
                range !== undefined &&
                (range <= 0 || movementCost(scene, token, result.length) > remaining + 0.00005);
            this.overlay.showMovement(
                result.path[0],
                point,
                radius,
                zoom,
                blocked,
                scene.grid,
                range,
                false,
                [],
                result.path,
            );
        } else this.overlay.showDestination(point, radius, zoom, !!result);
    }

    private schedule() {
        if (this.job || this.timer || !this.latest) return;
        this.timer = setTimeout(
            () => {
                this.timer = undefined;
                this.start();
            },
            Math.max(0, 80 - (performance.now() - this.lastStarted)),
        );
    }

    private start() {
        const job = this.latest;
        if (!job) return;
        this.job = job;
        this.lastStarted = performance.now();
        const finish = (result: RouteResult) => {
            if (this.job !== job) return;
            clearTimeout(this.deadline);
            this.deadline = undefined;
            this.job = undefined;
            if (this.latest === job) this.result = result;
            else this.schedule();
        };
        const fail = () => {
            if (this.job !== job) return;
            this.worker?.terminate();
            this.worker = undefined;
            finish({ status: 'budget', path: [], length: 0, expanded: 0, elapsed: 0 });
        };
        try {
            this.worker ??= new Worker(new URL('./pathfinding.worker.ts', import.meta.url), {
                type: 'module',
            });
            this.worker.onmessage = ({ data }: MessageEvent<RouteResult>) => finish(data);
            this.worker.onerror = fail;
            this.deadline = setTimeout(fail, 2000);
            const { scene, token, point } = job;
            this.worker.postMessage({
                start: { x: token.x, y: token.y },
                target: point,
                radius: (token.size * token.scale) / 2,
                width: scene.width,
                height: scene.height,
                gridSize: scene.grid.size,
                obstacles: movementObstacles(scene),
                portals: movementPortals(scene, (token.size * token.scale) / 2),
            });
        } catch {
            fail();
        }
    }

    cancel() {
        clearTimeout(this.timer);
        clearTimeout(this.deadline);
        this.worker?.terminate();
        this.worker = undefined;
        this.timer = this.deadline = undefined;
        this.latest = this.job = undefined;
        this.result = undefined;
        this.lastStarted = -Infinity;
    }
}
