import { sameMovementGeometry } from '../navigation/movementContext';
import { performanceMark, observingPerformance } from '../../realtime/performance';
import { WasdControl } from '../navigation/WasdControl';
import { displayScene } from '../mapWorld';
import { StructureLayer } from '../structure/StructureLayer';
import { along, distance, openingEnds, project, vertexIndex } from '../structure/model';
import { doorLeaf } from '../structure/openingArt';
import { maskBytes, pointInPolygons } from '../lighting/model';
import type { PresetSettings } from '../objects/collider';
import { StructureCollisionOverlay } from '../structure/StructureCollisionOverlay';
import { LightingLayer } from '../lighting/LightingLayer';
import { PlayerVisionLayer } from '../vision/PlayerVisionLayer';
import { LosOverlay } from '../vision/LosOverlay';
import { TerrainLayer } from '../terrain/TerrainLayer';
import { t } from '../../i18n';
import { GameplayLayer } from '../layers/GameplayLayer';
import { AtmosphereLayer } from '../layers/AtmosphereLayer';
import type { Effect, Intensity } from '../../media/model';
import { DirectorCamera } from '../../director/DirectorCamera';
import type { DirectorEvent } from '../../director/DirectorState';
import { ScenePropLayer } from '../layers/ScenePropLayer';
import { PlacementGhost } from '../layers/PlacementGhost';
import { CompositionGhost } from '../layers/CompositionGhost';
import type { CompositionMember } from '../../api/compositions';
import { Application, Container, Texture, Graphics } from 'pixi.js';
import { FogLayer } from '../layers/FogLayer';
import { SpatialLayer } from '../layers/SpatialLayer';
import { GMLayer } from '../layers/GMLayer';
import { RegionLayer } from '../layers/RegionLayer';
import { Camera } from './camera/Camera';
import { PointerController } from './interaction/PointerController';
import { BattleMapLayer } from '../layers/BattleMapLayer';
import { GridLayer } from '../layers/GridLayer';
import { TokenLayer } from '../layers/TokenLayer';
import { InteractionLayer } from '../layers/InteractionLayer';
import type { SceneStore } from '../state/SceneStore';
import type { Point, Tool } from '../types/scene';
import { currentTokenId } from '../types/combat';
import { screenToWorld, snapPoint, worldToScreen } from '../utils/coordinates';

export class TabletopRenderer {
    private app = new Application();
    private world = new Container();
    private weather = new AtmosphereLayer();
    private effects: Partial<Record<Effect, Intensity>> = {};
    atmosphere(effects: Partial<Record<Effect, Intensity>>) {
        this.effects = effects;
    }
    private camera = new Camera();
    private director = new DirectorCamera(this.camera);
    private grid = new GridLayer();
    private map = new BattleMapLayer();
    private terrain = new TerrainLayer(
        (message) => this.store.editorNotice(message),
        () => this.store.onRevisionGap?.(),
    );
    private structure = new StructureLayer();
    private collision = new StructureCollisionOverlay();
    private los = new LosOverlay();
    private vision = new PlayerVisionLayer();
    private lighting: LightingLayer;
    private currentContent = new Container();
    private buildGuide = new Graphics();
    private textures = new Map<string, Texture>();
    private tokens = new TokenLayer();
    private props = new ScenePropLayer();
    private fog = new FogLayer();
    private spatial = new SpatialLayer();
    private notes?: GMLayer;
    private regions?: RegionLayer;
    private overlay = new InteractionLayer();
    private response = new Graphics();
    private placementGhost = new PlacementGhost();
    private compositionGhost = new CompositionGhost();
    private compositionPlacement = false;
    private mapGuide = new Graphics();
    readonly gameplay = new GameplayLayer();
    setGameplayTarget(
        kind?: 'token' | 'prop' | 'point',
        ability?: import('../../gameplay/model').Ability,
        actorId?: string,
    ) {
        if (kind) this.tokens.finishMovements();
        this.gameplay.targetKind = kind;
        this.gameplay.ability = ability;
        this.gameplay.actorId = actorId;
    }
    hoverGameplayTarget(target?: {
        kind: string;
        id?: string;
        point?: import('../types/scene').Point;
    }) {
        this.gameplay.hover = target;
    }
    private responseTarget?: { kind: 'token' | 'prop'; id: string; until: number };
    private input?: PointerController;
    private directControl?: WasdControl;
    private observer?: ResizeObserver;
    private unsubscribe?: () => void;
    private destroyed = false;
    private ready = false;
    private width = 0;
    private height = 0;
    private lastZoom = 0;
    private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    private contextLost = (event: Event) => {
        event.preventDefault();
        this.onError(new Error(t('WebGL context lost. Reload to restore the tabletop.')));
    };
    constructor(
        private host: HTMLElement,
        private store: SceneStore,
        private onZoom: (zoom: number) => void,
        private onError: (error: unknown) => void,
    ) {
        this.lighting = new LightingLayer(store.role === 'player');
    }
    async init() {
        await this.app.init({
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            preference: 'webgl',
            // PointerController owns input. Pixi's unused federated event pool
            // otherwise retains native pointer events and closed HUD DOM paths.
            eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
        });
        this.ready = true;
        if (this.destroyed) {
            this.release();
            return;
        }
        const canvas = this.app.canvas;
        canvas.tabIndex = 0;
        canvas.setAttribute(
            'aria-label',
            t('Tabletop. Select and drag tokens; hold Space and drag to pan.'),
        );
        canvas.addEventListener('webglcontextlost', this.contextLost);
        this.host.appendChild(canvas);
        this.world.eventMode = 'none';
        this.currentContent.addChild(
            this.structure.walls,
            this.props,
            this.tokens,
            this.spatial,
            this.response,
            this.gameplay,
        );
        this.world.addChild(
            this.map,
            this.terrain,
            this.structure.floors,
            this.grid,
            this.structure.baseWalls,
            this.currentContent,
            this.lighting,
            this.vision,
            this.fog,
            this.lighting.guides,
            // Local interaction guides remain visible beyond LOS and manual fog.
            this.overlay,
            this.placementGhost,
            this.compositionGhost,
            this.mapGuide,
            this.buildGuide,
            this.collision,
            this.los,
        );
        if (this.store.role === 'gm') {
            this.regions = new RegionLayer();
            this.world.addChildAt(this.regions, this.world.children.length - 1);
            this.notes = new GMLayer();
            this.world.addChildAt(this.notes, this.world.children.length - 1);
        }
        if (observingPerformance()) {
            let lastRevision: number | undefined;
            this.app.renderer.runners.postrender.add({
                postrender: () => {
                    const scene = this.store.getSnapshot().scene;
                    if (scene.revision !== lastRevision) {
                        lastRevision = scene.revision;
                        performanceMark('pixi', { sceneId: scene.id, revision: scene.revision });
                    }
                },
            });
        }
        this.app.stage.addChild(this.world);
        this.app.stage.addChild(this.weather);
        this.store.onLightingFrame = (frame) => this.lighting.frame(frame);
        this.store.onLightingReset = () => this.lighting.reset();
        const lightingFrame = this.store.getLightingFrame();
        if (lightingFrame) this.lighting.frame(lightingFrame);
        this.store.onGameplayFeedback = (event) => this.gameplay.feedback(event);
        this.input = new PointerController(
            canvas,
            this.camera,
            this.store,
            this.tokens,
            this.overlay,
            this.notes,
            this.props,
            this.regions,
            this.terrain,
            this.buildGuide,
        );
        this.directControl = new WasdControl(canvas, this.store, () => {
            this.input?.cancel();
            this.tokens.finishMovements();
        });
        let previousScene = displayScene(
            this.store.getSnapshot().scene,
            this.store.getSnapshot().mapDraft,
        );
        let movementUpdate = this.store.getSnapshot().movementUpdate;
        let previousBuild = this.store.getSnapshot().build;
        let previousAuthoring = this.store.getSnapshot().entityAuthoring;
        let previousEditor = this.store.getSnapshot().mapEditor;
        const sync = () => {
            const state = this.store.getSnapshot();
            if (
                state.entityAuthoring !== previousAuthoring ||
                state.mapEditor !== previousEditor ||
                state.build?.mode !== previousBuild?.mode
            )
                this.input?.cancel();
            previousAuthoring = state.entityAuthoring;
            previousBuild = state.build;
            this.input?.refreshBuild();
            previousEditor = state.mapEditor;
            this.map.visible = state.mapEditor?.backgroundVisible !== false;
            this.props.visible = state.mapEditor?.objectsVisible !== false;
            this.tokens.alpha = state.mapEditor ? 0.35 : 1;
            if (this.notes) this.notes.visible = !state.mapEditor;
            if (this.regions) this.regions.visible = !state.mapEditor;
            const scene = displayScene(state.scene, state.mapDraft);
            this.terrain.sync(scene);
            this.vision.sync(
                this.app.renderer,
                this.store.role === 'player'
                    ? scene.vision
                    : this.store.spatial.tool === 'fog'
                      ? this.store.spatial.fogVision
                      : undefined,
                scene.width,
                scene.height,
                movementUpdate !== state.movementUpdate
                    ? state.movementUpdate?.movements
                    : undefined,
                this.store.directCommandPending || this.store.queuedMovementPending,
                movementUpdate !== state.movementUpdate &&
                    !!(state.movementUpdate?.reset || state.movementUpdate?.geometryChanged),
            );
            this.lighting.sync(
                scene,
                this.store.role === 'player' ? this.vision.currentMask.texture : undefined,
                state.lightingDraft,
            );
            if ('backBuffer' in this.app.renderer) {
                // Only the Darkvision saturation pass samples the already rendered map.
                this.app.renderer.backBuffer.useBackBuffer =
                    this.store.role === 'player' && !!scene.vision?.raster?.darkvision;
            }
            const lightFrame = this.store.getLightingFrame();
            if (lightFrame) this.lighting.frame(lightFrame);
            this.structure.baseWalls.visible =
                this.store.role === 'player' && !!scene.vision?.enabled;
            this.currentContent.mask =
                this.store.role === 'player' && scene.vision?.enabled
                    ? this.vision.currentMask
                    : null;
            this.regions?.sync(
                scene.regions ?? [],
                state.selectedRegionId,
                state.showRegions !== false,
            );
            this.notes?.sync(
                scene.notes ?? [],
                this.store.getSnapshot().selectedNoteId,
                this.store.getSnapshot().showNotes !== false,
            );
            if (
                scene.grid !== previousScene.grid ||
                scene.width !== previousScene.width ||
                scene.height !== previousScene.height
            )
                this.grid.update(scene.grid, scene.width, scene.height);
            const debug = this.store.role === 'gm' && !!state.mapEditor?.collisionDebug;
            this.collision.sync(debug ? scene.structure : null);
            this.los.sync(
                this.store.role === 'gm' &&
                    state.mapEditor &&
                    state.losDebug?.sceneId === scene.id &&
                    state.losDebug?.revision === (scene.revision ?? 0)
                    ? state.losDebug
                    : undefined,
            );
            this.props.sync(scene.props ?? [], this.textures);
            this.props.collisionDebug(debug);
            const previousCombat = previousScene.combat;
            const combat = scene.combat;
            const movementReset =
                state.movementUpdate?.reset && state.movementUpdate !== movementUpdate;
            const contextChanged =
                scene.id !== previousScene.id ||
                scene.structure?.hash !== previousScene.structure?.hash ||
                combat?.id !== previousCombat?.id ||
                combat?.status !== previousCombat?.status ||
                combat?.round !== previousCombat?.round ||
                currentTokenId(combat) !== currentTokenId(previousCombat) ||
                !!combat?.currentTurn !== !!previousCombat?.currentTurn;
            const geometryChanged = !sameMovementGeometry(
                scene,
                previousScene,
                movementUpdate !== state.movementUpdate
                    ? state.movementUpdate?.geometryChanged
                    : undefined,
            );
            if (movementReset || contextChanged || geometryChanged) this.tokens.finishMovements();
            this.tokens.sync(
                scene.tokens,
                this.store.role === 'player',
                currentTokenId(scene.combat),
                !movementReset &&
                    !contextChanged &&
                    !this.reducedMotion.matches &&
                    !this.gameplay.targetKind &&
                    movementUpdate !== state.movementUpdate
                    ? state.movementUpdate?.movements
                    : undefined,
            );
            movementUpdate = state.movementUpdate;
            if (scene !== previousScene) this.syncImages();
            // Route completion can synchronously emit UI state from reapplyPreview.
            // Publish the consumed scene before that nested sync: recipient prop
            // deltas must not look like a second geometry edit and cancel playback.
            previousScene = scene;
            this.input?.reapplyPreview();
            this.input?.refresh();
        };
        this.grid.update(previousScene.grid, previousScene.width, previousScene.height);
        sync();
        this.syncImages();
        this.unsubscribe = this.store.subscribe(sync);
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(this.host);
        this.resize();
        this.fit();
        let movementConnected = this.store.spatial.connected;
        this.app.ticker.add((ticker) => {
            const connected = this.store.spatial.connected;
            if (movementConnected && !connected) {
                this.tokens.finishMovements();
                this.vision.finishPresentation();
            }
            movementConnected = connected;
            this.input?.reapplyPreview();
            const now = performance.now();
            this.gameplay.tick(
                this.store.getSnapshot().scene,
                this.camera.state.zoom,
                now,
                this.reducedMotion.matches,
            );
            if (this.response.context.instructions.length) this.response.clear();
            if (this.responseTarget && this.responseTarget.until > now) {
                const target = this.responseTarget;
                const scene = this.store.getSnapshot().scene;
                const object =
                    target.kind === 'token'
                        ? scene.tokens.find((t) => t.id === target.id)
                        : scene.props?.find((p) => p.id === target.id);
                if (object) {
                    const progress = this.reducedMotion.matches
                        ? 0
                        : 1 - (target.until - now) / 420;
                    const radius =
                        'size' in object
                            ? (object.size * object.scale) / 2
                            : Math.max(
                                  object.image.width * object.scaleX,
                                  object.image.height * object.scaleY,
                              ) / 2;
                    this.response.circle(object.x, object.y, radius + 5 + progress * 16).stroke({
                        color: 0xa6d9c3,
                        width: 2 / this.camera.state.zoom,
                        alpha: 1 - progress,
                    });
                }
            }
            for (const [id, preview] of this.store.remotePreviews) {
                if (preview.expires < now) this.store.remotePreviews.delete(id);
            }
            if (this.camera.directed) this.directControl?.stop();
            const controlled = this.directControl?.tick(ticker.elapsedMS, now);
            const draggedToken = this.input?.draggingToken;
            const draggedGroup = this.input?.draggingObjectTokens;
            for (const [id, view] of this.tokens.views) {
                const dragging = draggedToken === id || !!draggedGroup?.includes(id);
                view.tick(
                    ticker.deltaMS,
                    this.camera.state.zoom,
                    this.reducedMotion.matches,
                    dragging,
                );
                if (controlled?.id === id) {
                    this.tokens.finishMovement(id);
                    this.tokens.preview(id, controlled.position);
                    continue;
                }
                if (dragging) {
                    this.tokens.finishMovement(id);
                    continue;
                }
                if (this.tokens.tickMovement(id, ticker.elapsedMS, this.reducedMotion.matches))
                    continue;
                if (view.x !== view.model.x || view.y !== view.model.y)
                    view.position.set(view.model.x, view.model.y);
            }
            const selected = this.store.getSnapshot().selectedIds;
            const focus =
                connected && this.store.role === 'player' && selected.length === 1
                    ? this.tokens.views.get(selected[0])
                    : undefined;
            this.vision.focus(
                focus?.model.canMove && focus.model.kind === 'player_character' ? focus : undefined,
                focus?.model.visionRange ?? 0,
                this.camera.state.zoom,
            );
            this.vision.tick(
                ticker.elapsedMS,
                this.reducedMotion.matches,
                this.tokens.views,
                this.store.directCommandPending || this.store.queuedMovementPending,
            );
            this.lighting.tick(this.app.renderer, this.tokens.views);
            this.tokens.drawMovements(this.camera.state.zoom, this.store.getSnapshot().selectedIds);
            this.camera.tick(ticker.deltaMS);
            if (controlled?.follow && !this.camera.directed) {
                const { x, y, zoom } = this.camera.state;
                const factor = this.reducedMotion.matches
                    ? 1
                    : 1 - Math.exp(-ticker.elapsedMS / 180);
                // Follow shifts translation without cancelling the wheel's zoom target.
                this.camera.state = {
                    x: x + (this.width / 2 - x - controlled.position.x * zoom) * factor,
                    y: y + (this.height / 2 - y - controlled.position.y * zoom) * factor,
                    zoom,
                };
            }
            this.input?.updateTerrainCursor();
            this.input?.updateBuildCamera();
            this.weather.configure(this.effects, this.reducedMotion.matches);
            this.weather.tick(ticker.deltaMS, this.width, this.height, this.reducedMotion.matches);
            this.director.tick(ticker.deltaMS);
            const camera = this.camera.state;
            this.terrain.tick(camera, this.width, this.height);
            this.notes?.zoom(camera.zoom);
            this.regions?.zoom(camera.zoom);
            const state = this.store.getSnapshot();
            const scene = displayScene(state.scene, state.mapDraft);
            if (this.mapGuide.context.instructions.length) this.mapGuide.clear();
            for (const p of state.mapCalibrationPoints ?? []) {
                const r = 9 / camera.zoom;
                this.mapGuide
                    .moveTo(p.x - r, p.y)
                    .lineTo(p.x + r, p.y)
                    .moveTo(p.x, p.y - r)
                    .lineTo(p.x, p.y + r)
                    .stroke({ color: 0xb7e1ce, width: 2 / camera.zoom });
            }
            const gm = this.store.role === 'gm';
            const fogTool = gm && this.store.spatial.tool === 'fog';
            const encoded = !gm && !!scene.vision?.enabled;
            this.fog.visible = !encoded && (!state.mapEditor || fogTool);
            this.fog.update(
                this.app.renderer,
                scene.fog,
                fogTool
                    ? (this.store.spatial.draft ?? this.store.spatial.pendingFog ?? null)
                    : null,
                scene.width,
                scene.height,
                encoded ? 'encoded' : fogTool ? 'gm' : gm ? 'gm-plain' : 'plain',
            );
            if (gm)
                this.vision.sync(
                    this.app.renderer,
                    fogTool ? this.store.spatial.fogVision : undefined,
                    scene.width,
                    scene.height,
                );
            const manualFog = scene.fog?.base === 'covered' || !!scene.fog?.actions.length;
            this.vision.setFogPresentation(encoded && manualFog ? this.fog.texture : undefined, gm);
            this.spatial.update(
                this.store.spatial,
                scene.grid,
                camera.zoom,
                this.reducedMotion.matches,
            );
            this.world.position.set(
                camera.x + this.director.offset.x,
                camera.y + this.director.offset.y,
            );
            this.world.scale.set(camera.zoom);
            const percentage = Math.round(camera.zoom * 100);
            if (percentage !== this.lastZoom && !this.camera.directed) {
                this.lastZoom = percentage;
                this.onZoom(percentage);
            }
        });
    }
    private resize() {
        const width = this.host.clientWidth,
            height = this.host.clientHeight;
        if (!width || !height) return;
        this.input?.cancel();
        if (this.width) this.camera.pan((width - this.width) / 2, (height - this.height) / 2);
        this.width = width;
        this.height = height;
        this.app.renderer.resize(width, height);
    }
    fit() {
        if (this.camera.directed) return;
        this.input?.cancel();
        const state = this.store.getSnapshot();
        const scene = displayScene(state.scene, state.mapDraft);
        this.camera.fit(this.width, this.height, scene.width, scene.height);
    }
    contextTarget(clientX: number, clientY: number) {
        if (this.camera.directed) return;
        const bounds = this.host.getBoundingClientRect();
        const point = screenToWorld(
            { x: clientX - bounds.left, y: clientY - bounds.top },
            this.camera.state,
        );
        const token = this.tokens.hit(point);
        if (token) {
            this.tokens.finishMovement(token);
            return { kind: 'token' as const, id: token };
        }
        const prop = this.props.hit(point);
        if (prop) return { kind: 'prop' as const, id: prop };
        const opening = this.contextOpening(point);
        if (opening) return { kind: 'opening' as const, id: opening };
        const region = this.regions?.hit(point);
        if (region) return { kind: 'region' as const, id: region };
    }
    private contextOpening(point: Point) {
        const { structure, vision } = this.store.getSnapshot().scene;
        const graph = structure?.graph;
        if (!graph?.openings?.length) return;
        const playerVision = this.store.role === 'player' && vision?.enabled ? vision : undefined;
        const raster = playerVision?.raster;
        const bits = raster ? maskBytes(raster.bits) : '';
        const visible = (p: Point) => {
            if (!raster) return !playerVision || pointInPolygons(p, playerVision.polygons);
            const x = Math.floor(p.x / raster.cellSize);
            const y = Math.floor(p.y / raster.cellSize);
            if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) return false;
            const index = y * raster.width + x;
            return !!(bits.charCodeAt(index >> 3) & (1 << (index & 7)));
        };
        const vertices = vertexIndex(graph);
        const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
        const radius = Math.max(4, 8 / this.camera.state.zoom);
        let nearest = Infinity;
        let id: string | undefined;
        for (const opening of graph.openings) {
            const edge = edges.get(opening.edgeId);
            if (!edge) continue;
            const [a, b] = openingEnds(edge, vertices, opening);
            let d = distance(point, project(point, a, b));
            if (opening.type === 'door' && opening.open) {
                const { hinge, angle } = doorLeaf(a, b, opening);
                const length = distance(a, b);
                const tip = {
                    x: hinge.x + length * Math.cos(angle),
                    y: hinge.y + length * Math.sin(angle),
                };
                d = Math.min(d, distance(point, project(point, hinge, tip)));
            }
            if (d > radius || d >= nearest) continue;
            if (playerVision) {
                // Sample both faces so a closed panel can be clicked from the visible side.
                const reach = Math.min(4, edge.thickness / 2) + (raster?.cellSize ?? 0) / 2 + 0.01;
                const scale = reach / distance(a, b);
                const dx = (b.y - a.y) * scale;
                const dy = (b.x - a.x) * scale;
                const seen = [0.25, 0.5, 0.75].some((t) => {
                    const p = along(a, b, t);
                    return (
                        visible({ x: p.x - dx, y: p.y + dy }) ||
                        visible({ x: p.x + dx, y: p.y - dy })
                    );
                });
                if (!seen) continue;
            }
            nearest = d;
            id = opening.id;
        }
        return id;
    }
    isTokenInMotion(id: string) {
        return (
            this.store.getSnapshot().directControl?.tokenId === id ||
            this.tokens.isMoving(id) ||
            this.input?.draggingToken === id ||
            !!this.input?.draggingObjectTokens.includes(id)
        );
    }
    focusToken(id: string) {
        if (this.camera.directed) return;
        const token = this.store.getSnapshot().scene.tokens.find((t) => t.id === id);
        if (!token) return;
        this.tokens.finishMovement(id);
        this.input?.cancel();
        const center = this.center();
        this.camera.pan(
            (center.x - token.x) * this.camera.state.zoom,
            (center.y - token.y) * this.camera.state.zoom,
        );
    }
    screenPoint(point: import('../types/scene').Point) {
        const bounds = this.host.getBoundingClientRect();
        return {
            x: bounds.left + this.camera.state.x + point.x * this.camera.state.zoom,
            y: bounds.top + this.camera.state.y + point.y * this.camera.state.zoom,
        };
    }
    selectedContextPoint() {
        const state = this.store.getSnapshot();
        if (this.store.role === 'gm' && state.structureSelection?.kind === 'opening') {
            const id = state.structureSelection.id;
            const graph = state.scene.structure?.graph;
            const opening = graph?.openings?.find((o) => o.id === id);
            const edge = graph?.edges.find((e) => e.id === opening?.edgeId);
            if (graph && edge && opening) {
                const [a, b] = openingEnds(edge, vertexIndex(graph), opening);
                return this.screenPoint(along(a, b, 0.5));
            }
        }
        const region = state.scene.regions?.find((r) => r.id === state.selectedRegionId);
        const target =
            state.scene.tokens.find((t) => t.id === state.selectedIds[0]) ??
            state.scene.props?.find((p) => p.id === state.selectedPropIds?.[0]) ??
            (region
                ? {
                      x:
                          region.geometry.x +
                          (region.shape === 'rectangle' ? (region.geometry.width ?? 0) / 2 : 0),
                      y:
                          region.geometry.y +
                          (region.shape === 'rectangle' ? (region.geometry.height ?? 0) / 2 : 0),
                  }
                : undefined);
        if (!target) return;
        const bounds = this.host.getBoundingClientRect(),
            camera = this.camera.state;
        return {
            x: bounds.left + camera.x + target.x * camera.zoom,
            y: bounds.top + camera.y + target.y * camera.zoom,
        };
    }
    cancelActiveGesture() {
        return this.input?.cancelActiveGesture() ?? false;
    }
    cancelGesture() {
        this.input?.cancel();
    }
    respondToObject(kind: 'token' | 'prop', id: string) {
        this.responseTarget = { kind, id, until: performance.now() + 420 };
    }
    center() {
        return screenToWorld({ x: this.width / 2, y: this.height / 2 }, this.camera.state);
    }
    direct(event: DirectorEvent | null) {
        this.input?.cancel();
        if (event) this.director.apply(event, this.width, this.height, this.reducedMotion.matches);
        else this.director.release();
    }
    placementPreview(clientX: number, clientY: number) {
        const target = this.dropTarget(clientX, clientY);
        if (this.compositionPlacement) {
            const point = snapPoint(target.point, this.store.getSnapshot().scene.grid);
            this.compositionGhost.move(point, this.camera.state.zoom);
            return worldToScreen(point, this.camera.state);
        }
        this.placementGhost.position.copyFrom(
            snapPoint(target.point, this.store.getSnapshot().scene.grid),
        );
        this.placementGhost.visible = true;
        return worldToScreen(
            snapPoint(target.point, this.store.getSnapshot().scene.grid),
            this.camera.state,
        );
    }
    beginPlacement(
        name: string,
        url?: string,
        prop?: { width: number; height: number },
        preset?: PresetSettings,
        composition?: CompositionMember[],
    ) {
        this.endPlacement();
        if (composition) {
            this.compositionPlacement = true;
            this.compositionGhost.configure(composition);
            return;
        }
        const grid = this.store.getSnapshot().scene.grid;
        const size = prop
            ? grid.visible
                ? grid.size * 2
                : 120
            : grid.visible
              ? Math.max(20, Math.min(300, grid.size))
              : 60;
        const ratio = prop ? size / Math.max(prop.width, prop.height) : 1;
        this.placementGhost.configure(
            url,
            preset ? preset.width * preset.scaleX : prop ? prop.width * ratio : size,
            preset ? preset.height * preset.scaleY : prop ? prop.height * ratio : size,
            !prop && !preset,
            name,
            preset?.pivotX,
            preset?.pivotY,
        );
    }
    transformPlacement(rotation: number, scale: number) {
        this.placementGhost.angle = rotation;
        this.placementGhost.scale.set(scale);
    }
    hidePlacement() {
        this.placementGhost.visible = false;
        this.compositionGhost.visible = false;
    }
    endPlacement() {
        this.placementGhost.clear();
        this.compositionGhost.clear();
        this.compositionPlacement = false;
    }
    dropTarget(clientX: number, clientY: number) {
        const bounds = this.app.canvas.getBoundingClientRect();
        const point = screenToWorld(
            { x: clientX - bounds.left, y: clientY - bounds.top },
            this.camera.state,
        );
        const tokenId = this.tokens.hit(point);
        if (tokenId) this.tokens.finishMovement(tokenId);
        return { point, tokenId };
    }
    setImages(images: Map<string, HTMLImageElement>) {
        for (const [id, image] of images) {
            if (!this.textures.has(id)) this.textures.set(id, Texture.from(image));
        }
        this.syncImages();
    }
    private syncImages() {
        const state = this.store.getSnapshot();
        const scene = displayScene(state.scene, state.mapDraft);
        this.map.update(
            scene,
            scene.map ? this.textures.get(scene.map.asset.id) : undefined,
            !!state.mapDraft,
        );
        this.tokens.views.forEach((view) =>
            view.setImage(view.model.image ? this.textures.get(view.model.image.id) : undefined),
        );
        this.props.sync(scene.props ?? [], this.textures);
        this.structure.sync(scene.structure, this.textures);
        const used = new Set([
            scene.map?.asset.id,
            ...scene.tokens.map((t) => t.image?.id),
            ...(scene.props ?? []).map((p) => p.image.id),
            ...(scene.structure?.materials ?? []).map((material) => material.asset.id),
        ]);
        for (const [id, texture] of this.textures)
            if (!used.has(id)) {
                texture.destroy(true);
                this.textures.delete(id);
            }
    }
    zoom(factor: number) {
        if (this.camera.directed) return;
        this.camera.zoomBy(factor, { x: this.width / 2, y: this.height / 2 });
    }
    setTool(tool: Tool) {
        if (tool === 'fog' && this.store.abilityTargeting) return;
        if (this.input) {
            this.input.cancel();
            this.input.tool = tool;
            this.input.refresh();
        }
    }
    destroy() {
        this.store.onLightingFrame = undefined;
        this.store.onLightingReset = undefined;
        this.destroyed = true;
        this.observer?.disconnect();
        this.directControl?.destroy();
        this.input?.destroy();
        this.store.onGameplayFeedback = undefined;
        this.unsubscribe?.();
        if (this.ready) this.release();
    }
    private release() {
        this.app.canvas.removeEventListener('webglcontextlost', this.contextLost);
        this.tokens.finishMovements();
        this.structure.releaseArt();
        this.app.destroy(true, { children: true });
        this.textures.forEach((texture) => texture.destroy(true));
        this.textures.clear();
        this.ready = false;
    }
}
