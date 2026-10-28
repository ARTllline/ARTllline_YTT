import { Application, Container } from 'pixi.js';
import { Camera } from './camera/Camera';
import { PointerController } from './interaction/PointerController';
import { MapLayer } from '../layers/MapLayer';
import { GridLayer } from '../layers/GridLayer';
import { PropLayer } from '../layers/PropLayer';
import { TokenLayer } from '../layers/TokenLayer';
import { InteractionLayer } from '../layers/InteractionLayer';
import type { SceneStore } from '../state/SceneStore';
import type { Tool } from '../types/scene';

export class TabletopRenderer {
    private app = new Application();
    private world = new Container();
    private camera = new Camera();
    private grid = new GridLayer();
    private tokens = new TokenLayer();
    private overlay = new InteractionLayer();
    private input?: PointerController;
    private observer?: ResizeObserver;
    private unsubscribe?: () => void;
    private destroyed = false;
    private ready = false;
    private width = 0;
    private height = 0;
    private lastZoom = 0;
    private contextLost = (event: Event) => {
        event.preventDefault();
        this.onError(new Error('WebGL context lost. Reload to restore the tabletop.'));
    };
    constructor(
        private host: HTMLElement,
        private store: SceneStore,
        private onZoom: (zoom: number) => void,
        private onError: (error: unknown) => void,
    ) {}
    async init() {
        await this.app.init({
            background: '#172020',
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
            'Tabletop. Select and drag tokens; hold Space and drag to pan.',
        );
        canvas.addEventListener('webglcontextlost', this.contextLost);
        this.host.appendChild(canvas);
        this.world.eventMode = 'none';
        this.world.addChild(new MapLayer(), this.grid, new PropLayer(), this.tokens, this.overlay);
        this.app.stage.addChild(this.world);
        this.input = new PointerController(
            canvas,
            this.camera,
            this.store,
            this.tokens,
            this.overlay,
        );
        let previousScene = this.store.getSnapshot().scene;
        const sync = () => {
            const { scene } = this.store.getSnapshot();
            if (scene.grid !== previousScene.grid)
                this.grid.update(scene.grid, scene.width, scene.height);
            this.tokens.sync(scene.tokens);
            this.input?.refresh();
            previousScene = scene;
        };
        this.grid.update(previousScene.grid, previousScene.width, previousScene.height);
        sync();
        this.unsubscribe = this.store.subscribe(sync);
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(this.host);
        this.resize();
        this.fit();
        this.app.ticker.add((ticker) => {
            this.camera.tick(ticker.deltaMS);
            const camera = this.camera.state;
            this.world.position.set(camera.x, camera.y);
            this.world.scale.set(camera.zoom);
            const percentage = Math.round(camera.zoom * 100);
            if (percentage !== this.lastZoom) {
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
        this.input?.cancel();
        const scene = this.store.getSnapshot().scene;
        this.camera.fit(this.width, this.height, scene.width, scene.height);
    }
    zoom(factor: number) {
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
        this.unsubscribe?.();
        if (this.ready) this.release();
    }
    private release() {
        this.app.canvas.removeEventListener('webglcontextlost', this.contextLost);
        this.app.destroy(true, { children: true });
        this.ready = false;
    }
}
