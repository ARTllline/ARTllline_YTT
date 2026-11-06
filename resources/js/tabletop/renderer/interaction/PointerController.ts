import { ObjectGesture } from './ObjectGesture';
import type { Graphics } from 'pixi.js';
import { BuildGesture } from '../../structure/BuildGesture';
import { TerrainGesture } from '../../terrain/TerrainGesture';
import type { TerrainLayer } from '../../terrain/TerrainLayer';
import { editorInteractionScene } from '../../mapEditor';
import { marqueeSelection } from '../../utils/marquee';
import type { ObjectSelection } from '../../types/scene';
import { RegionGesture } from './RegionGesture';
import type { RegionLayer } from '../../layers/RegionLayer';
import type { ScenePropLayer } from '../../layers/ScenePropLayer';
import { SpatialGesture } from './SpatialGesture';
import type { Point, Tool } from '../../types/scene';
import type { SceneStore } from '../../state/SceneStore';
import type { Camera } from '../camera/Camera';
import type { TokenLayer } from '../../layers/TokenLayer';
import type { InteractionLayer } from '../../layers/InteractionLayer';
import type { GMLayer } from '../../layers/GMLayer';
import { screenToWorld, snapPoint } from '../../utils/coordinates';
import { movementBlocked, movementObstacles, movementRange } from '../../utils/movement';
import type { Scene } from '../../types/scene';
import { ClickToMove } from '../../navigation/ClickToMove';
import { DragRoutePreview } from '../../navigation/DragRoutePreview';

type Gesture = {
    route?: string;
    build?: boolean;
    terrain?: boolean;
    marquee?: { previous?: ObjectSelection };
    region?: boolean;
    objects?: boolean;
    note?: string;
    spatial?: boolean;
    pointer: number;
    start: Point;
    last: Point;
    token: string | null;
    origin: Point;
    pointerOrigin?: Point;
    override?: boolean;
    moved: boolean;
};
const isEditing = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    !!target.closest('input,textarea,select,[contenteditable="true"]');

export class PointerController {
    private clickMove: ClickToMove;
    private dragRoute: DragRoutePreview;
    private spatial: SpatialGesture;
    private objects?: ObjectGesture;
    private regionGesture?: RegionGesture;
    private buildGesture?: BuildGesture;
    private buildZoom = 0;
    private terrainGesture?: TerrainGesture;
    get tool(): Tool {
        return this.store.spatial.tool;
    }
    set tool(tool: Tool) {
        this.store.spatial.setTool(tool);
    }
    private gesture: Gesture | null = null;
    private space = false;
    private inside = false;
    private terrainCursor?: Point;
    private terrainCursorState?: string;
    private hover: string | null = null;
    private propHover: string | null = null;
    private geometryScene?: Scene;
    private obstacles: ReturnType<typeof movementObstacles> = [];
    private movementFrame?: { scene: Scene; point: Point; camera: Camera['state'] };
    private abort = new AbortController();
    constructor(
        private canvas: HTMLCanvasElement,
        private camera: Camera,
        private store: SceneStore,
        private tokens: TokenLayer,
        private overlay: InteractionLayer,
        private notes?: GMLayer,
        private props?: ScenePropLayer,
        private regions?: RegionLayer,
        terrain?: TerrainLayer,
        buildGuide?: Graphics,
    ) {
        this.clickMove = new ClickToMove(store, overlay);
        this.dragRoute = new DragRoutePreview(overlay);
        this.spatial = new SpatialGesture(store);
        if (buildGuide) {
            this.buildGesture = new BuildGesture(store, buildGuide);
            if (store.role === 'gm')
                store.onStructureAction = (action) => this.buildGesture?.action(action);
        }
        if (terrain) this.terrainGesture = new TerrainGesture(store, terrain);
        if (props) this.objects = new ObjectGesture(store, tokens, props, overlay);
        if (regions) this.regionGesture = new RegionGesture(store, regions);
        const signal = this.abort.signal;
        canvas.addEventListener('pointerdown', this.down, { signal });
        canvas.addEventListener(
            'dblclick',
            () => {
                if (this.tool === 'build') this.buildGesture?.commit();
            },
            { signal },
        );
        canvas.addEventListener(
            'pointerenter',
            () => {
                this.inside = true;
            },
            { signal },
        );
        canvas.addEventListener('pointermove', this.move, { signal });
        canvas.addEventListener('pointerup', this.up, { signal });
        canvas.addEventListener('pointercancel', this.cancel, { signal });
        canvas.addEventListener(
            'lostpointercapture',
            () => {
                if (this.gesture) this.cancel();
            },
            { signal },
        );
        canvas.addEventListener(
            'pointerleave',
            () => {
                this.inside = false;
                this.terrainCursor = undefined;
                if (this.tool === 'build' && !this.gesture)
                    this.buildGesture?.draw(undefined, this.camera.state.zoom);
                if (!this.gesture) {
                    this.hover = null;
                    this.propHover = null;
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
        this.props?.selection(
            this.store.getSnapshot().selectedPropIds ?? [],
            this.propHover,
            this.store.role === 'gm',
        );
        this.canvas.style.cursor =
            !this.space && !['select', 'pan'].includes(this.tool)
                ? 'crosshair'
                : this.gesture?.marquee
                  ? 'crosshair'
                  : this.gesture
                    ? 'grabbing'
                    : this.space || this.tool === 'pan'
                      ? 'grab'
                      : this.hover
                        ? this.store.canMove(this.hover)
                            ? 'grab'
                            : 'pointer'
                        : this.propHover && this.store.role === 'gm'
                          ? 'grab'
                          : 'default';
    };
    private down = (e: PointerEvent) => {
        this.terrainCursorState = undefined;
        if (this.camera.directed) return;
        if (this.gesture || !e.isPrimary || (e.button !== 0 && e.button !== 1)) return;
        e.preventDefault();
        this.canvas.focus({ preventScroll: true });
        this.camera.stop();
        const point = this.local(e),
            world = screenToWorld(point, this.camera.state);
        const panning = e.button === 1 || this.space || this.tool === 'pan';
        const selected = this.store.getSnapshot().selectedIds;
        const routeClick =
            !panning &&
            e.button === 0 &&
            !e.shiftKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey &&
            selected.length === 1 &&
            this.clickMove.eligible(selected[0]) &&
            !this.tokens.hit(world) &&
            !this.props?.hit(world) &&
            !this.notes?.hit(world, this.camera.state.zoom);
        if (!panning && !routeClick) this.clickMove.cancel();
        if (e.button === 0 && !panning && this.store.onLightPlacement) {
            this.store.onLightPlacement(world);
            return;
        }
        if (e.button === 0 && !panning && this.store.onLosProbe) {
            this.store.onLosProbe(world);
            return;
        }
        if (e.button === 0 && !panning && this.store.onMapCalibration) {
            this.store.onMapCalibration(world);
            return;
        }
        if (this.store.getSnapshot().mapDraft && !panning) return;
        if (!panning && this.tool === 'build') {
            if (!this.buildGesture?.down(world, this.camera.state.zoom)) return;
            this.gesture = {
                build: true,
                pointer: e.pointerId,
                start: point,
                last: point,
                origin: world,
                token: null,
                moved: false,
            };
            this.canvas.setPointerCapture(e.pointerId);
            this.refresh();
            return;
        }
        if (!panning && this.tool === 'terrain') {
            if (!this.terrainGesture?.down(world)) return;
            this.gesture = {
                terrain: true,
                pointer: e.pointerId,
                start: point,
                last: point,
                token: null,
                origin: world,
                moved: false,
            };
            this.canvas.setPointerCapture(e.pointerId);
            this.refresh();
            return;
        }
        if (!panning && this.tool === 'region' && this.regionGesture) {
            this.regionGesture.down(world);
            this.gesture = {
                region: true,
                pointer: e.pointerId,
                start: point,
                last: point,
                token: null,
                origin: world,
                moved: false,
            };
            this.canvas.setPointerCapture(e.pointerId);
            this.refresh();
            return;
        }
        if (!panning && this.tool === 'note' && this.store.role === 'gm') {
            this.store.noteCommand({ action: 'create', ...world });
            this.tool = 'select';
            this.refresh();
            return;
        }
        const noteId =
            !panning && this.tool === 'select' && !this.store.getSnapshot().mapEditor
                ? this.notes?.hit(world, this.camera.state.zoom)
                : null;
        if (noteId) {
            const note = this.store.getSnapshot().scene.notes!.find((n) => n.id === noteId)!;
            this.store.selectNote(noteId);
            this.gesture = {
                pointer: e.pointerId,
                start: point,
                last: point,
                token: null,
                note: noteId,
                origin: { x: note.x, y: note.y },
                moved: false,
            };
            this.canvas.setPointerCapture(e.pointerId);
            this.refresh();
            return;
        }
        if (!panning && !['select', 'pan'].includes(this.tool)) {
            this.tokens.finishMovements();
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
        if (
            !panning &&
            (!e.altKey || this.store.getSnapshot().mapEditor || !this.tokens.hit(world)) &&
            this.objects?.down(world, e.shiftKey, this.camera.state.zoom)
        ) {
            this.gesture = {
                pointer: e.pointerId,
                start: point,
                last: point,
                token: null,
                origin: world,
                moved: false,
                objects: true,
            };
            this.canvas.setPointerCapture(e.pointerId);
            this.refresh();
            return;
        }
        const token = panning || this.store.getSnapshot().mapEditor ? null : this.tokens.hit(world);
        const prop =
            !panning && !token && this.store.role === 'player' ? this.props?.hit(world) : null;
        if (prop) {
            this.store.selectObject('prop', prop);
            this.refresh();
            return;
        }
        if (!panning && !token) {
            const state = this.store.getSnapshot();
            const id =
                state.selectedIds.length === 1 && !state.selectedPropIds?.length
                    ? state.selectedIds[0]
                    : undefined;
            const route =
                id &&
                this.clickMove.eligible(id) &&
                !e.shiftKey &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.altKey
                    ? id
                    : undefined;
            if (this.store.role === 'gm' || route) {
                this.gesture = {
                    pointer: e.pointerId,
                    start: point,
                    last: point,
                    token: null,
                    origin: world,
                    moved: false,
                    route,
                    ...(this.store.role === 'gm'
                        ? { marquee: { previous: e.shiftKey ? this.store.selection() : undefined } }
                        : {}),
                };
                this.canvas.setPointerCapture(e.pointerId);
            } else this.store.select(null);
            this.refresh();
            return;
        }
        if (!panning) this.store.select(token);
        if (token) this.tokens.finishMovement(token);
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
            pointerOrigin: world,
            override: e.altKey && this.store.role === 'gm',
            moved: false,
        };
        if (token) this.store.dragSessionId = crypto.randomUUID();
        this.canvas.setPointerCapture(e.pointerId);
        this.refresh();
    };
    private move = (e: PointerEvent) => {
        const point = this.local(e),
            gesture = this.gesture;
        this.terrainCursor = point;
        this.inside =
            point.x >= 0 &&
            point.y >= 0 &&
            point.x < this.canvas.clientWidth &&
            point.y < this.canvas.clientHeight;
        if (
            this.tool === 'build' &&
            !this.space &&
            (!gesture || (gesture.build && e.pointerId === gesture.pointer))
        ) {
            const world = screenToWorld(point, this.camera.state);
            if (gesture?.build) {
                this.buildGesture?.move(world, this.camera.state.zoom, gesture.origin);
            } else this.buildGesture?.draw(world, this.camera.state.zoom);
            return;
        }
        if (!gesture) {
            const world = screenToWorld(point, this.camera.state);
            this.regions?.hover(this.tool === 'region' ? this.regions.hit(world) : undefined);
            const editor = this.store.getSnapshot().mapEditor;
            this.hover = editor ? null : this.tokens.hit(world);
            this.propHover =
                this.hover || (editor && (!editor.objectsVisible || editor.objectsLocked))
                    ? null
                    : (this.props?.hit(world) ?? null);
            if (this.tool === 'terrain') this.updateTerrainCursor();
            else if (
                this.tool === 'fog' &&
                this.store.spatial.settings.shape === 'brush' &&
                !this.space
            )
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
        if (gesture.terrain) {
            const world = screenToWorld(point, this.camera.state);
            this.terrainGesture?.move(world);
            this.updateTerrainCursor();
            return;
        }
        if (gesture.marquee) {
            gesture.moved ||= Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 3;
            if (gesture.moved) this.clickMove.cancel();
            if (gesture.moved)
                this.overlay.showMarquee(
                    gesture.origin,
                    screenToWorld(point, this.camera.state),
                    this.camera.state.zoom,
                );
            return;
        }
        if (gesture.region) {
            this.regionGesture?.move(screenToWorld(point, this.camera.state));
            return;
        }
        if (gesture.objects) {
            gesture.last = point;
            this.objects?.move(screenToWorld(point, this.camera.state), this.camera.state.zoom);
            return;
        }
        if (gesture.spatial) {
            this.spatial.move(screenToWorld(point, this.camera.state));
            gesture.last = point;
            return;
        }
        gesture.moved ||= Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 3;
        if (!gesture.moved) return;
        if (gesture.route) this.clickMove.cancel();
        if (gesture.note) {
            gesture.last = point;
            this.notes?.preview(gesture.note, this.dragPosition(point, gesture));
            return;
        }
        if (!gesture.token) this.camera.pan(point.x - gesture.last.x, point.y - gesture.last.y);
        else {
            gesture.last = point;
            this.previewDrag(gesture, point);
        }
        gesture.last = point;
    };
    private previewDrag(gesture: Gesture, point: Point) {
        const { scene } = this.store.getSnapshot();
        const camera = this.camera.state;
        const previous = this.movementFrame;
        const token = scene.tokens.find((item) => item.id === gesture.token);
        if (!token) return;
        const position = snapPoint(this.dragPosition(point, gesture), scene.grid);
        if (scene.mapWorld && !gesture.override) {
            this.dragRoute.preview(scene, token, position, camera.zoom);
            return;
        }
        if (previous?.scene === scene && previous.point === point && previous.camera === camera)
            return;
        const radius = (token.size * token.scale) / 2;
        const gm = this.store.role === 'gm';
        if (
            gm &&
            (scene.structure !== this.geometryScene?.structure ||
                scene.props !== this.geometryScene?.props ||
                scene.mapWorld !== this.geometryScene?.mapWorld)
        ) {
            this.obstacles = movementObstacles(scene);
            this.geometryScene = scene;
        }
        const range = gesture.override ? undefined : movementRange(scene, token);
        const distance = Math.hypot(position.x - gesture.origin.x, position.y - gesture.origin.y);
        const blocked =
            !gesture.override &&
            ((range !== undefined && distance > range + 0.001) ||
                (gm &&
                    distance > 0 &&
                    movementBlocked(gesture.origin, position, radius, this.obstacles)));
        if (gesture.override) this.tokens.preview(token.id, position);
        this.overlay.showMovement(
            gesture.origin,
            position,
            radius,
            this.camera.state.zoom,
            blocked,
            scene.grid,
            range,
            gm,
        );
        this.movementFrame = { scene, point, camera };
    }
    private dragPosition(point: Point, gesture: Gesture): Point {
        if (gesture.token && gesture.pointerOrigin) {
            const world = screenToWorld(point, this.camera.state);
            return {
                x: gesture.origin.x + world.x - gesture.pointerOrigin.x,
                y: gesture.origin.y + world.y - gesture.pointerOrigin.y,
            };
        }
        return {
            x: gesture.origin.x + (point.x - gesture.start.x) / this.camera.state.zoom,
            y: gesture.origin.y + (point.y - gesture.start.y) / this.camera.state.zoom,
        };
    }
    private up = (e: PointerEvent) => {
        this.terrainCursorState = undefined;
        const gesture = this.gesture;
        if (!gesture || gesture.pointer !== e.pointerId) return;
        if (gesture.route && !gesture.moved) {
            this.finish();
            this.clickMove.chooseDestination(
                gesture.route,
                screenToWorld(this.local(e), this.camera.state),
                5 / this.camera.state.zoom,
            );
            return;
        }
        if (gesture.build) {
            this.buildGesture?.up(
                screenToWorld(this.local(e), this.camera.state),
                gesture.origin,
                this.camera.state.zoom,
            );
            this.finish();
            return;
        }
        if (gesture.terrain) {
            void this.terrainGesture?.up(screenToWorld(this.local(e), this.camera.state));
            this.finish();
            return;
        }
        if (gesture.marquee) {
            if (gesture.moved)
                this.store.selectObjects(
                    marqueeSelection(
                        editorInteractionScene(
                            this.store.getSnapshot().scene,
                            this.store.getSnapshot().mapEditor,
                        ),
                        gesture.origin,
                        screenToWorld(this.local(e), this.camera.state),
                        gesture.marquee.previous,
                    ),
                );
            else if (!gesture.marquee.previous) this.store.select(null);
            this.finish();
            return;
        }
        if (gesture.region) {
            this.regionGesture?.up(screenToWorld(this.local(e), this.camera.state));
            this.finish();
            return;
        }
        if (gesture.objects) {
            this.objects?.up(screenToWorld(this.local(e), this.camera.state));
            this.finish();
            return;
        }
        if (gesture.spatial) {
            this.spatial.up(screenToWorld(this.local(e), this.camera.state));
            this.finish();
            return;
        }
        if (gesture.note) {
            const position = this.dragPosition(this.local(e), gesture);
            this.finish();
            if (gesture.moved) this.store.updateNote(gesture.note, position);
            return;
        }
        if (gesture.token && gesture.moved) {
            const position = snapPoint(
                this.dragPosition(this.local(e), gesture),
                this.store.getSnapshot().scene.grid,
            );
            this.finish();
            if (!gesture.override && this.store.getSnapshot().scene.mapWorld) {
                this.clickMove.request(gesture.token, position, true);
                return;
            }
            this.store.moveToken(
                gesture.token,
                position,
                gesture.override ? 'override' : undefined,
            );
            return;
        }
        this.finish();
    };
    private finish() {
        this.dragRoute.cancel();
        this.movementFrame = undefined;
        const tokenId = this.gesture?.token;
        const token = this.store.getSnapshot().scene.tokens.find((item) => item.id === tokenId);
        if (token) this.tokens.preview(token.id, token);
        const pointer = this.gesture?.pointer;
        this.gesture = null;
        if (pointer !== undefined && this.canvas.hasPointerCapture(pointer))
            this.canvas.releasePointerCapture(pointer);
        this.overlay.clear();
        this.store.clearPreview();
        this.refresh();
    }
    cancel = () => {
        this.dragRoute.cancel();
        this.clickMove.cancel();
        this.buildGesture?.cancel();
        this.terrainGesture?.cancel();
        this.spatial.cancel();
        this.objects?.cancel();
        this.regionGesture?.cancel();
        if (!this.gesture) return;
        if (this.gesture.note) {
            const note = this.store
                .getSnapshot()
                .scene.notes?.find((n) => n.id === this.gesture!.note);
            if (note) this.notes?.preview(note.id, note);
        }
        this.store.dragSessionId = undefined;
        this.finish();
    };
    reapplyPreview() {
        this.clickMove.sync(this.camera.state.zoom);
        this.spatial.tick();
        this.regionGesture?.preview();
        const gesture = this.gesture;
        if (gesture?.objects)
            this.objects?.move(
                screenToWorld(gesture.last, this.camera.state),
                this.camera.state.zoom,
            );
        if (gesture?.note && gesture.moved)
            this.notes?.preview(gesture.note, this.dragPosition(gesture.last, gesture));
        if (gesture?.spatial && this.store.role === 'player' && !this.store.movementEnabled) {
            this.cancel();
            return;
        }
        const token = this.store.getSnapshot().scene.tokens.find((t) => t.id === gesture?.token);
        if (
            gesture?.token &&
            (!token ||
                !this.store.canMove(gesture.token) ||
                token.x !== gesture.origin.x ||
                token.y !== gesture.origin.y)
        ) {
            this.cancel();
            return;
        }
        if (gesture?.token && gesture.moved) this.previewDrag(gesture, gesture.last);
    }
    refreshBuild() {
        if (this.tool === 'build') this.buildGesture?.refresh(this.camera.state.zoom);
    }
    updateBuildZoom() {
        const zoom = this.camera.state.zoom;
        if (zoom === this.buildZoom) return;
        this.buildZoom = zoom;
        this.refreshBuild();
    }
    updateTerrainCursor() {
        if (this.tool !== 'terrain') {
            if (this.terrainCursorState) this.overlay.clear();
            this.terrainCursorState = undefined;
            return;
        }
        const brush = this.terrainGesture?.brush ?? this.store.getSnapshot().mapEditor?.terrain;
        const point = this.terrainCursor;
        if (
            !brush ||
            !point ||
            !this.inside ||
            this.space ||
            (this.gesture && !this.gesture.terrain)
        ) {
            this.overlay.clear();
            this.terrainCursorState = undefined;
            return;
        }
        const { zoom, x, y } = this.camera.state;
        const signature = `${point.x}/${point.y}/${zoom}/${x}/${y}/${brush.size}/${brush.softness}/${brush.operation}`;
        if (signature === this.terrainCursorState) return;
        this.terrainCursorState = signature;
        const radius = brush.size / 2;
        this.overlay.showBrush(
            screenToWorld(point, this.camera.state),
            radius,
            zoom,
            brush.operation === 'erase',
            radius * (1 - brush.softness / 255),
        );
    }
    get draggingObjectTokens() {
        return this.objects?.tokenIds ?? [];
    }
    get draggingToken() {
        return this.gesture?.token;
    }
    private blur = () => {
        this.space = false;
        this.terrainCursor = undefined;
        this.cancel();
        this.refresh();
    };
    private wheel = (e: WheelEvent) => {
        if (this.camera.directed) {
            e.preventDefault();
            return;
        }
        e.preventDefault();
        if (this.gesture) return;
        const delta =
            e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.canvas.clientHeight : 1);
        this.camera.zoomBy(Math.exp(-Math.max(-160, Math.min(160, delta)) * 0.002), this.local(e));
    };
    private keyDown = (e: KeyboardEvent) => {
        if (isEditing(e.target) || document.querySelector('dialog[open]')) return;
        if (this.store.getSnapshot().mapDraft && e.code !== 'Space') return;
        if (
            this.store.role === 'gm' &&
            (e.ctrlKey || e.metaKey) &&
            e.code === 'KeyZ' &&
            !e.altKey
        ) {
            e.preventDefault();
            if (!e.repeat && !this.gesture) this.store.history?.run(e.shiftKey);
            return;
        }
        if (this.tool === 'build' && ['Enter', 'Escape', 'Delete'].includes(e.key)) {
            e.preventDefault();
            if (e.repeat) return;
            if (e.key === 'Escape') {
                this.cancel();
                this.store.selectStructure(undefined);
            } else if (!this.gesture && e.key === 'Enter') this.buildGesture?.commit();
            else if (!this.gesture && e.key === 'Delete') this.buildGesture?.action('delete');
            return;
        }
        if (
            this.store.role === 'gm' &&
            !e.repeat &&
            (e.key === 'Delete' || ((e.ctrlKey || e.metaKey) && e.code === 'KeyD'))
        ) {
            e.preventDefault();
            this.store.onSelectionAction?.(e.key === 'Delete' ? 'delete' : 'duplicate');
            return;
        }
        if (e.code === 'Space' && (document.activeElement === this.canvas || this.inside)) {
            e.preventDefault();
            this.space = true;
            this.refresh();
        }
        const shortcut = (
            { KeyV: 'select', KeyH: 'pan', KeyF: 'fog', KeyR: 'ruler', KeyP: 'ping' } as Record<
                string,
                Tool
            >
        )[e.code];
        if (this.store.getSnapshot().mapEditor && shortcut && !['select', 'pan'].includes(shortcut))
            return;
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
        this.clickMove.destroy();
        this.dragRoute.cancel();
        this.abort.abort();
        if (this.buildGesture) this.store.onStructureAction = undefined;
    }
}
