import { SpatialGesture } from './SpatialGesture';
import type { Point, Tool } from '../../types/scene';
import type { SceneStore } from '../../state/SceneStore';
import type { Camera } from '../camera/Camera';
import type { TokenLayer } from '../../layers/TokenLayer';
import type { InteractionLayer } from '../../layers/InteractionLayer';
import { screenToWorld, snapPoint } from '../../utils/coordinates';

type Gesture = {
    spatial?: boolean;
    pointer: number;
    start: Point;
    last: Point;
    token: string | null;
    origin: Point;
    moved: boolean;
};
const isEditing = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    !!target.closest('input,textarea,select,[contenteditable="true"]');

export class PointerController {
    private spatial: SpatialGesture;
    get tool(): Tool {
        return this.store.spatial.tool;
    }
    set tool(tool: Tool) {
        this.store.spatial.setTool(tool);
    }
    private gesture: Gesture | null = null;
    private space = false;
    private hover: string | null = null;
    private lastPreview = 0;
    private previewTimer: ReturnType<typeof setTimeout> | undefined;
    private abort = new AbortController();
    constructor(
        private canvas: HTMLCanvasElement,
        private camera: Camera,
        private store: SceneStore,
        private tokens: TokenLayer,
        private overlay: InteractionLayer,
    ) {
        this.spatial = new SpatialGesture(store);
        const signal = this.abort.signal;
        canvas.addEventListener('pointerdown', this.down, { signal });
        canvas.addEventListener('pointermove', this.move, { signal });
        canvas.addEventListener('pointerup', this.up, { signal });
        canvas.addEventListener('pointercancel', this.cancel, { signal });
        canvas.addEventListener('lostpointercapture', this.cancel, { signal });
        canvas.addEventListener(
            'pointerleave',
            () => {
                if (!this.gesture) {
                    this.hover = null;
                    this.overlay.clear();
                    this.refresh();
                }
            },
            { signal },
        );
        canvas.addEventListener('wheel', this.wheel, { passive: false, signal });
        canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
        window.addEventListener('keydown', this.keyDown, { signal });
        window.addEventListener('keyup', this.keyUp, { signal });
        window.addEventListener('blur', this.blur, { signal });
        this.refresh();
    }
    private local = (e: MouseEvent): Point => {
        const bounds = this.canvas.getBoundingClientRect();
        return { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
    };
    refresh = () => {
        this.tokens.selection(this.store.getSnapshot().selectedIds, this.hover);
        this.canvas.style.cursor =
            !this.space && !['select', 'pan'].includes(this.tool)
                ? 'crosshair'
                : this.gesture
                  ? 'grabbing'
                  : this.space || this.tool === 'pan'
                    ? 'grab'
                    : this.hover
                      ? this.store.canMove(this.hover)
                          ? 'grab'
                          : 'pointer'
                      : 'default';
    };
    private down = (e: PointerEvent) => {
        if (this.gesture || !e.isPrimary || (e.button !== 0 && e.button !== 1)) return;
        e.preventDefault();
        this.canvas.focus({ preventScroll: true });
        this.camera.stop();
        const point = this.local(e),
            world = screenToWorld(point, this.camera.state);
        const panning = e.button === 1 || this.space || this.tool === 'pan';
        if (!panning && !['select', 'pan'].includes(this.tool)) {
            if (this.store.role === 'player' && !this.store.movementEnabled) return;
            this.gesture = {
                pointer: e.pointerId,
                start: point,
                last: point,
                token: null,
                origin: world,
                moved: false,
                spatial: true,
            };
            this.spatial.down(this.tool, world);
            this.canvas.setPointerCapture(e.pointerId);
            this.refresh();
            return;
        }
        const token = panning ? null : this.tokens.hit(world);
        if (!panning) this.store.select(token);
        if (!panning && !token) {
            this.refresh();
            return;
        }
        const model = this.store.getSnapshot().scene.tokens.find((item) => item.id === token);
        if (model && !this.store.canMove(model.id)) {
            this.refresh();
            return;
        }
        this.gesture = {
            pointer: e.pointerId,
            start: point,
            last: point,
            token,
            origin: model ? { x: model.x, y: model.y } : world,
            moved: false,
        };
        if (token) this.store.dragSessionId = crypto.randomUUID();
        this.canvas.setPointerCapture(e.pointerId);
        this.refresh();
    };
    private move = (e: PointerEvent) => {
        const point = this.local(e),
            gesture = this.gesture;
        if (!gesture) {
            const world = screenToWorld(point, this.camera.state);
            this.hover = this.tokens.hit(world);
            if (this.tool === 'fog' && this.store.spatial.settings.shape === 'brush' && !this.space)
                this.overlay.showBrush(
                    world,
                    this.store.spatial.settings.radius,
                    this.camera.state.zoom,
                    this.store.spatial.settings.operation === 'cover',
                );
            else this.overlay.clear();
            this.refresh();
            return;
        }
        if (e.pointerId !== gesture.pointer) return;
        if (gesture.spatial) {
            this.spatial.move(screenToWorld(point, this.camera.state));
            gesture.last = point;
            return;
        }
        gesture.moved ||= Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 3;
        if (!gesture.moved) return;
        if (!gesture.token) this.camera.pan(point.x - gesture.last.x, point.y - gesture.last.y);
        else {
            gesture.last = point;
            const position = this.dragPosition(point, gesture);
            this.tokens.preview(gesture.token, position);
            const grid = this.store.getSnapshot().scene.grid;
            this.overlay.showSnap(snapPoint(position, grid), grid);
            clearTimeout(this.previewTimer);
            if (performance.now() - this.lastPreview > 80) {
                this.lastPreview = performance.now();
                this.store.previewMove(gesture.token, position);
            } else {
                this.previewTimer = setTimeout(
                    () => {
                        if (this.gesture?.token) {
                            this.lastPreview = performance.now();
                            this.store.previewMove(this.gesture.token, position);
                        }
                    },
                    80 - (performance.now() - this.lastPreview),
                );
            }
        }
        gesture.last = point;
    };
    private dragPosition(point: Point, gesture: Gesture): Point {
        return {
            x: gesture.origin.x + (point.x - gesture.start.x) / this.camera.state.zoom,
            y: gesture.origin.y + (point.y - gesture.start.y) / this.camera.state.zoom,
        };
    }
    private up = (e: PointerEvent) => {
        const gesture = this.gesture;
        if (!gesture || gesture.pointer !== e.pointerId) return;
        if (gesture.spatial) {
            this.spatial.up(screenToWorld(this.local(e), this.camera.state));
            this.finish();
            return;
        }
        if (gesture.token && gesture.moved) {
            const position = snapPoint(
                this.dragPosition(this.local(e), gesture),
                this.store.getSnapshot().scene.grid,
            );
            this.finish();
            this.store.moveToken(gesture.token, position);
            return;
        }
        this.finish();
    };
    private finish() {
        clearTimeout(this.previewTimer);
        const pointer = this.gesture?.pointer;
        this.gesture = null;
        if (pointer !== undefined && this.canvas.hasPointerCapture(pointer))
            this.canvas.releasePointerCapture(pointer);
        this.overlay.clear();
        this.store.clearPreview();
        this.refresh();
    }
    cancel = () => {
        this.spatial.cancel();
        if (!this.gesture) return;
        if (this.gesture.token) {
            const token = this.store
                .getSnapshot()
                .scene.tokens.find((t) => t.id === this.gesture!.token);
            const position = token ?? this.gesture.origin;
            this.store.onPreview?.(this.gesture.token, position, true);
            this.tokens.preview(this.gesture.token, position);
        }
        this.store.dragSessionId = undefined;
        this.finish();
    };
    reapplyPreview() {
        this.spatial.tick();
        const gesture = this.gesture;
        if (gesture?.spatial && this.store.role === 'player' && !this.store.movementEnabled) {
            this.cancel();
            return;
        }
        if (gesture?.token && !this.store.canMove(gesture.token)) {
            this.cancel();
            return;
        }
        if (gesture?.token && gesture.moved)
            this.tokens.preview(gesture.token, this.dragPosition(gesture.last, gesture));
    }
    get draggingToken() {
        return this.gesture?.token;
    }
    private blur = () => {
        this.space = false;
        this.cancel();
        this.refresh();
    };
    private wheel = (e: WheelEvent) => {
        e.preventDefault();
        if (this.gesture) return;
        const delta =
            e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.canvas.clientHeight : 1);
        this.camera.zoomBy(Math.exp(-Math.max(-160, Math.min(160, delta)) * 0.002), this.local(e));
    };
    private keyDown = (e: KeyboardEvent) => {
        if (isEditing(e.target)) return;
        if (e.code === 'Space' && document.activeElement === this.canvas) {
            e.preventDefault();
            this.space = true;
            this.refresh();
        }
        const shortcut = (
            { v: 'select', h: 'pan', f: 'fog', r: 'ruler', p: 'ping' } as Record<string, Tool>
        )[e.key.toLowerCase()];
        if (
            shortcut &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey &&
            (shortcut !== 'fog' || this.store.role === 'gm')
        ) {
            this.cancel();
            this.tool = shortcut;
            this.refresh();
        }
        if (e.key === 'Escape') {
            this.cancel();
            this.spatial.clearFinished();
            this.tool = 'select';
            this.store.select(null);
        }
    };
    private keyUp = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
            this.space = false;
            this.refresh();
        }
    };
    destroy() {
        this.cancel();
        this.abort.abort();
    }
}
