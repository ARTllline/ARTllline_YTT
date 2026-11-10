import {
    Container,
    Graphics,
    Matrix,
    RenderTexture,
    Sprite,
    Texture,
    type Renderer,
} from 'pixi.js';
import type { FogState, FogStroke } from '../types/spatial';
import { rectangle } from '../utils/spatialGeometry';

const emptyFog: FogState = { base: 'clear', actions: [] };
type DisplayMode = 'plain' | 'encoded' | 'gm' | 'gm-plain';

/** A bounded GPU surface; history is replayed only on hydration/reset, then appended. */
export class FogLayer extends Container {
    private saved?: RenderTexture;
    private preview?: RenderTexture;
    private display = new Sprite();
    private brush = new Graphics();
    private paintRoot = new Container();
    private copy = new Sprite();
    private prior?: FogState;
    private draft?: FogStroke | null;
    private scaleFactor = 1;
    private w = 0;
    private h = 0;
    private mode?: DisplayMode;
    get texture() {
        return this.saved ?? Texture.EMPTY;
    }
    constructor() {
        super();
        this.addChild(this.display);
        this.paintRoot.addChild(this.brush);
    }
    update(
        renderer: Renderer,
        state: FogState | undefined,
        draft: FogStroke | null,
        width: number,
        height: number,
        mode: DisplayMode,
    ) {
        const fog = state ?? emptyFog;
        const resized = width !== this.w || height !== this.h;
        const modeChanged = this.mode !== mode;
        this.mode = mode;
        if (resized) {
            this.display.texture = Texture.EMPTY;
            this.copy.texture = Texture.EMPTY;
            this.saved?.destroy(true);
            this.preview?.destroy(true);
            this.w = width;
            this.h = height;
            this.scaleFactor = Math.min(1, 2048 / Math.max(width, height));
            const options = {
                width: Math.ceil(width * this.scaleFactor),
                height: Math.ceil(height * this.scaleFactor),
                resolution: 1,
                antialias: true,
            };
            this.saved = RenderTexture.create(options);
            this.preview = RenderTexture.create(options);
            this.prior = undefined;
        }
        if (this.prior !== fog || resized || modeChanged) {
            const append =
                !modeChanged &&
                this.prior &&
                this.prior.base === fog.base &&
                this.prior.actions.length <= fog.actions.length &&
                this.prior.actions.every(
                    (a, i) =>
                        a.geometry === fog.actions[i].geometry &&
                        a.operation === fog.actions[i].operation,
                );
            if (!append) {
                this.brush.clear();
                this.brush.blendMode = 'normal';
                if (fog.base === 'covered')
                    this.brush.rect(0, 0, width, height).fill(this.coverColor);
                renderer.render({
                    container: this.paintRoot,
                    target: this.saved,
                    clear: true,
                    transform: new Matrix().scale(this.scaleFactor, this.scaleFactor),
                });
            }
            for (const action of fog.actions.slice(append ? this.prior!.actions.length : 0))
                this.paint(renderer, action, this.saved!);
            this.prior = fog;
            this.draft = undefined;
        }
        if (draft !== this.draft) {
            if (draft) {
                this.copy.texture = this.saved!;
                renderer.render({ container: this.copy, target: this.preview, clear: true });
                this.paint(renderer, draft, this.preview!);
            }
            this.display.texture = draft ? this.preview! : this.saved!;
            this.display.width = width;
            this.display.height = height;
            this.draft = draft;
        }
        this.display.alpha = mode.startsWith('gm') ? 0.55 : 1;
    }
    private get coverColor() {
        return this.mode === 'encoded' ? 0x000000 : 0x101820;
    }
    private paint(renderer: Renderer, stroke: FogStroke, target: RenderTexture) {
        const points = stroke.geometry.points;
        this.brush.clear();
        const explore = stroke.operation === 'explore';
        const color = explore ? (this.mode === 'encoded' ? 0xff0000 : 0x347a79) : this.coverColor;
        this.brush.blendMode =
            stroke.operation === 'reveal' || (explore && this.mode?.endsWith('plain'))
                ? 'erase'
                : 'normal';
        if (stroke.shape === 'rectangle') {
            const rect = rectangle(points[0], points[1] ?? points[0]);
            this.brush.rect(rect.x, rect.y, rect.width, rect.height).fill(color);
        } else {
            const radius = stroke.geometry.radius ?? 90;
            if (points.length === 1)
                this.brush.circle(points[0].x, points[0].y, radius).fill(color);
            else {
                this.brush.moveTo(points[0].x, points[0].y);
                for (const p of points.slice(1)) this.brush.lineTo(p.x, p.y);
                this.brush.stroke({
                    color,
                    width: radius * 2,
                    cap: 'round',
                    join: 'round',
                });
            }
        }
        renderer.render({
            container: this.paintRoot,
            target,
            clear: false,
            transform: new Matrix().scale(this.scaleFactor, this.scaleFactor),
        });
    }
    override destroy() {
        this.paintRoot.destroy({ children: true });
        this.copy.destroy();
        this.saved?.destroy(true);
        this.preview?.destroy(true);
        super.destroy({ children: true });
    }
}
