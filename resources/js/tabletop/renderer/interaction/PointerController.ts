import type { Point, Tool } from '../../types/scene';
import type { SceneStore } from '../../state/SceneStore';
import type { Camera } from '../camera/Camera';
import type { TokenLayer } from '../../layers/TokenLayer';
import type { InteractionLayer } from '../../layers/InteractionLayer';
import { screenToWorld, snapPoint } from '../../utils/coordinates';

type Gesture = {
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
    tool: Tool = 'select';
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
        this.canvas.style.cursor = this.gesture
            ? 'grabbing'
            : this.space || this.tool === 'pan'
              ? 'grab'
              : this.hover
                ? 'pointer'
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
        const token = panning ? null : this.tokens.hit(world);
        if (!panning) this.store.select(token);
        if (!panning && !token) {
            this.refresh();
            return;
        }
        const model = this.store.getSnapshot().scene.tokens.find((item) => item.id === token);
        this.gesture = {
            pointer: e.pointerId,
            start: point,
            last: point,
            token,
            origin: model ? { x: model.x, y: model.y } : world,
            moved: false,
        };
        this.canvas.setPointerCapture(e.pointerId);
        this.refresh();
    };
    private move = (e: PointerEvent) => {
        const point = this.local(e),
            gesture = this.gesture;
        if (!gesture) {
            this.hover = this.tokens.hit(screenToWorld(point, this.camera.state));
            this.refresh();
            return;
        }
        if (e.pointerId !== gesture.pointer) return;
        gesture.moved ||= Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 3;
        if (!gesture.moved) return;
        if (!gesture.token) this.camera.pan(point.x - gesture.last.x, point.y - gesture.last.y);
        else {
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
        if (gesture.token && gesture.moved) {
            const position = snapPoint(
                this.dragPosition(this.local(e), gesture),
                this.store.getSnapshot().scene.grid,
            );
            this.store.updateToken(gesture.token, position);
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
        if (!this.gesture) return;
        if (this.gesture.token) this.tokens.preview(this.gesture.token, this.gesture.origin);
        this.finish();
    };
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
        if (e.key === 'Escape') {
            this.cancel();
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
