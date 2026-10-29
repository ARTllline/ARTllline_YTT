import { t } from '../../i18n';
import { GameplayLayer } from '../layers/GameplayLayer';
import { AtmosphereLayer } from '../layers/AtmosphereLayer';
import type { Effect, Intensity } from '../../media/model';
import { DirectorCamera } from '../../director/DirectorCamera';
import type { DirectorEvent } from '../../director/DirectorState';
import { ScenePropLayer } from '../layers/ScenePropLayer';
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
import type { Tool } from '../types/scene';
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
    private textures = new Map<string, Texture>();
    private tokens = new TokenLayer();
    private props = new ScenePropLayer();
    private fog = new FogLayer();
    private spatial = new SpatialLayer();
    private notes?: GMLayer;
    private regions?: RegionLayer;
    private overlay = new InteractionLayer();
    private response = new Graphics();
    readonly gameplay = new GameplayLayer();
    setGameplayTarget(kind?: 'token' | 'prop' | 'point') {
        this.gameplay.targetKind = kind;
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
    ) {}
    async init() {
        await this.app.init({
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            preference: 'webgl',
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
        this.world.addChild(
            this.map,
            this.grid,
            this.props,
            this.tokens,
            this.fog,
            this.spatial,
            this.overlay,
            this.response,
            this.gameplay,
        );
        if (this.store.role === 'gm') {
            this.regions = new RegionLayer();
            this.world.addChildAt(this.regions, this.world.children.length - 1);
            this.notes = new GMLayer();
            this.world.addChildAt(this.notes, this.world.children.length - 1);
        }
        this.app.stage.addChild(this.world);
        this.app.stage.addChild(this.weather);
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
        );
        let previousScene = this.store.getSnapshot().scene;
        const sync = () => {
            const { scene } = this.store.getSnapshot();
            const state = this.store.getSnapshot();
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
            this.props.sync(scene.props ?? [], this.textures);
            this.tokens.sync(
                scene.tokens,
                this.store.role === 'player',
                currentTokenId(scene.combat),
            );
            if (scene !== previousScene) this.syncImages();
            this.input?.reapplyPreview();
            this.input?.refresh();
            previousScene = scene;
        };
        this.grid.update(previousScene.grid, previousScene.width, previousScene.height);
        sync();
        this.syncImages();
        this.unsubscribe = this.store.subscribe(sync);
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(this.host);
        this.resize();
        this.fit();
        this.app.ticker.add((ticker) => {
            this.input?.reapplyPreview();
            const now = performance.now();
            this.gameplay.tick(
                this.store.getSnapshot().scene,
                this.camera.state.zoom,
                now,
                this.reducedMotion.matches,
            );
            this.response.clear();
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
            for (const [id, view] of this.tokens.views) {
                view.tick(
                    ticker.deltaMS,
                    this.camera.state.zoom,
                    this.reducedMotion.matches,
                    this.input?.draggingToken === id ||
                        !!this.input?.draggingObjectTokens.includes(id),
                );
                if (
                    this.input?.draggingToken === id ||
                    this.input?.draggingObjectTokens.includes(id)
                )
                    continue;
                const target = this.store.remotePreviews.get(id);
                if (target || Math.hypot(view.x - view.model.x, view.y - view.model.y) > 0.1) {
                    const point = target ?? view.model;
                    const blend = this.reducedMotion.matches
                        ? 1
                        : 1 - Math.exp(-ticker.deltaMS / 45);
                    view.position.set(
                        view.x + (point.x - view.x) * blend,
                        view.y + (point.y - view.y) * blend,
                    );
                }
            }
            this.camera.tick(ticker.deltaMS);
            this.weather.configure(this.effects, this.reducedMotion.matches);
            this.weather.tick(ticker.deltaMS, this.width, this.height, this.reducedMotion.matches);
            this.director.tick(ticker.deltaMS);
            const camera = this.camera.state;
            this.notes?.zoom(camera.zoom);
            this.regions?.zoom(camera.zoom);
            const scene = this.store.getSnapshot().scene;
            this.fog.update(
                this.app.renderer,
                scene.fog,
                this.store.spatial.draft,
                scene.width,
                scene.height,
                this.store.role === 'gm',
            );
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
        const scene = this.store.getSnapshot().scene;
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
        if (token) return { kind: 'token' as const, id: token };
        const prop = this.props.hit(point);
        if (prop) return { kind: 'prop' as const, id: prop };
        const region = this.regions?.hit(point);
        if (region) return { kind: 'region' as const, id: region };
    }
    selectedContextPoint() {
        const state = this.store.getSnapshot();
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
        return worldToScreen(
            snapPoint(target.point, this.store.getSnapshot().scene.grid),
            this.camera.state,
        );
    }
    dropTarget(clientX: number, clientY: number) {
        const bounds = this.app.canvas.getBoundingClientRect();
        const point = screenToWorld(
            { x: clientX - bounds.left, y: clientY - bounds.top },
            this.camera.state,
        );
        return { point, tokenId: this.tokens.hit(point) };
    }
    setImages(images: Map<string, HTMLImageElement>) {
        for (const [id, image] of images) {
            if (!this.textures.has(id)) this.textures.set(id, Texture.from(image));
        }
        this.syncImages();
    }
    private syncImages() {
        const scene = this.store.getSnapshot().scene;
        this.map.update(scene, scene.map ? this.textures.get(scene.map.asset.id) : undefined);
        this.tokens.views.forEach((view) =>
            view.setImage(view.model.image ? this.textures.get(view.model.image.id) : undefined),
        );
        this.props.sync(scene.props ?? [], this.textures);
        const used = new Set([
            scene.map?.asset.id,
            ...scene.tokens.map((t) => t.image?.id),
            ...(scene.props ?? []).map((p) => p.image.id),
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
        if (this.input) {
            this.input.cancel();
            this.input.tool = tool;
            this.input.refresh();
        }
    }
    destroy() {
        this.destroyed = true;
        this.observer?.disconnect();
        this.input?.destroy();
        this.store.onGameplayFeedback = undefined;
        this.unsubscribe?.();
        if (this.ready) this.release();
    }
    private release() {
        this.app.canvas.removeEventListener('webglcontextlost', this.contextLost);
        this.app.destroy(true, { children: true });
        this.textures.forEach((texture) => texture.destroy(true));
        this.textures.clear();
        this.ready = false;
    }
}
