import type DiceBox from '@3d-dice/dice-box-threejs';
import { diceNotation } from './diceNotation';

export type DiceStatus = 'settled' | 'static';
let runtimeSerial = 0;

/** One Player-owned graphics surface. It knows faces and presentation, never commands. */
export class DiceRuntime {
    readonly id = `ytt-dice-runtime-${++runtimeSerial}`;
    private surfaceNode?: HTMLDivElement;
    private parking: HTMLElement | null = null;
    private owner: HTMLElement | null = null;
    private box?: DiceBox;
    private initializing?: Promise<void>;
    private observer?: ResizeObserver;
    private frame = 0;
    private epoch = 0;
    private destroyed = false;
    private rolling = false;
    private resizePending = false;
    private size = { width: 0, height: 0 };
    private expected: number[] = [];
    private cancelCurrent?: () => void;
    private cancelCenter?: () => void;
    private previews: DiceBox['diceList'] = [];
    private lowQuality = false;
    private initializationCount = 0;
    private rollCount = 0;
    private resizeCount = 0;
    private slowFrames = 0;
    private samples = 0;

    constructor(private readonly cinematic = true) {}
    private get surface() {
        if (!this.surfaceNode) {
            this.surfaceNode = document.createElement('div');
            this.surfaceNode.id = this.id;
            this.surfaceNode.className = 'persistent-dice-surface';
        }
        return this.surfaceNode;
    }
    mount(parking: HTMLElement) {
        this.destroyed = false;
        this.lowQuality =
            matchMedia('(pointer: coarse)').matches || navigator.hardwareConcurrency <= 4;
        this.parking = parking;
        if (!this.surface.parentNode) parking.append(this.surface);
        this.diagnostics();
    }
    private diagnostics() {
        if (!this.parking) return;
        Object.assign(this.parking.dataset, {
            rendererId: this.id,
            initializations: String(this.initializationCount),
            rolls: String(this.rollCount),
            resizes: String(this.resizeCount),
            quality: this.lowQuality ? 'economy' : 'balanced',
            rolling: String(this.rolling),
        });
    }
    attach(host: HTMLElement) {
        this.owner = host;
        host.append(this.surface);
        this.observer?.disconnect();
        this.observer ??= new ResizeObserver(() => {
            if (this.rolling) this.resizePending = true;
            else this.resize();
        });
        this.observer.observe(host);
    }
    release(host: HTMLElement) {
        if (this.owner !== host) return;
        this.cancel();
        this.owner = null;
        this.observer?.disconnect();
        this.parking?.append(this.surface);
    }
    /** Lazy warm-up may start on HUD hover/focus, before a gameplay request exists. */
    async prepare() {
        if (this.destroyed) return;
        this.initializing ??= this.initialize().catch((error) => {
            this.initializing = undefined;
            throw error;
        });
        await this.initializing;
    }
    private async initialize() {
        const { default: Box } = await import('@3d-dice/dice-box-threejs');
        if (this.destroyed || !this.surface.isConnected) throw new Error('Dice surface closed');
        // Native dialogs enter the top layer after child effects; measure next frame.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (this.destroyed) return;
        const box = new Box(`#${this.id}`, {
            sounds: false,
            theme_texture: 'none',
            theme_material: 'plastic',
            theme_customColorset: {
                name: 'ytt-obsidian-brass',
                foreground: '#f1dba5',
                background: '#55352d',
                outline: '#21130e',
                texture: 'none',
                material: 'plastic',
            },
            color_spotlight: 0xffedce,
            light_intensity: 0.9,
            baseScale: this.cinematic ? (innerWidth < 700 ? 82 : 145) : 75,
            strength: 0.75,
            iterationLimit: 360,
            shadows: !this.lowQuality,
            onRollComplete: (presentation: {
                sets: { rolls: { value: number }[] }[];
                total: number;
            }) => {
                if (this.destroyed) return;
                // Pre-simulation may drift. Sample actual resting orientation first (d4 too).
                box.diceList.forEach((die, i) => {
                    die.position.copy(die.body.position);
                    die.quaternion.copy(die.body.quaternion);
                    die.storeRolledValue('natural');
                    if (die.getLastValue().value !== this.expected[i])
                        box.swapDiceFace(die, this.expected[i]);
                    die.storeRolledValue('forced');
                });
                Object.assign(presentation, box.getDiceResults());
                this.draw();
            },
        });
        this.box = box;
        box.resizeWorld = () => {}; // Own the only resize observer; no anonymous window listener.
        box.clearDice = () => this.clearDice(); // Upstream schedules an extra delayed render.
        box.animateThrow = (run, complete) => this.animate(run, complete);
        box.animateAfterThrow = () => {}; // No idle graphics loop between rolls.
        await box.initialize();
        if (this.destroyed) {
            this.dispose();
            return;
        }
        this.initializationCount++;
        box.world.solver.iterations = this.lowQuality ? 6 : 10;
        box.renderer!.setPixelRatio(Math.min(devicePixelRatio || 1, this.lowQuality ? 1 : 1.5));
        this.resize(true);
        this.applyQuality();
        // Prime the real material/number textures and shader before physical motion starts.
        this.preview(1);
        box.renderer!.compile(box.scene, box.camera);
        this.draw();
        this.diagnostics();
    }
    private applyQuality() {
        const box = this.box;
        if (!box?.renderer) return;
        if (this.lowQuality) box.disableShadows();
        if (box.light?.shadow) box.light.shadow.mapSize.set(512, 512);
    }
    private resize(force = false) {
        const box = this.box;
        if (!box?.renderer || this.destroyed) return;
        if (this.rolling) {
            this.resizePending = true;
            return;
        }
        const host = this.owner ?? this.parking;
        if (!host) return;
        const width = Math.round(host.clientWidth),
            height = Math.round(host.clientHeight);
        if (
            !width ||
            !height ||
            (!force && width === this.size.width && height === this.size.height)
        )
            return;
        this.size = { width, height };
        // Always explicit dimensions: never change physical scale via the no-arg branch.
        box.setDimensions({ x: width, y: height });
        this.resizeCount++;
        this.resizePending = false;
        this.applyQuality();
        this.diagnostics();
    }
    private clearDice() {
        const box = this.box;
        if (!box) return;
        box.running = false;
        for (const die of [...box.diceList, ...this.previews]) {
            box.scene.remove(die);
            if (die.body) box.world.removeBody(die.body);
            // Forced faces clone geometry; keep factory caches for subsequent rolls.
            if (!Object.values(box.DiceFactory.geometries).includes(die.geometry))
                die.geometry.dispose();
        }
        box.diceList.length = 0;
        this.previews = [];
        box.camera.position.set(0, 0, box.camera.position.z);
        box.camera.lookAt(0, 0, 0);
    }
    preview(count = 1) {
        const box = this.box;
        if (!box?.renderer || this.rolling || this.destroyed) return;
        this.clearDice();
        for (let i = 0; i < count; i++) {
            const die = box.DiceFactory.create('d20');
            if (!die) continue;
            die.position.set((i - (count - 1) / 2) * 250, 0, 130);
            die.rotation.set(0.18, -0.12, 0.15);
            die.castShadow = !this.lowQuality;
            box.scene.add(die);
            this.previews.push(die);
        }
        this.draw();
    }
    async roll(values: number[], sides: number): Promise<DiceStatus> {
        const notation = diceNotation(values, sides);
        this.cancel();
        const epoch = ++this.epoch;
        try {
            await this.prepare();
            if (this.destroyed || epoch !== this.epoch || !this.box) return 'static';
            this.resize();
            this.expected = [...values];
            this.rolling = true;
            this.rollCount++;
            this.diagnostics();
            let timer: ReturnType<typeof setTimeout> | undefined;
            const canceled = new Promise<null>((resolve) => {
                this.cancelCurrent = () => resolve(null);
                timer = setTimeout(() => resolve(null), 8500);
            });
            const result = await Promise.race([this.box.roll(notation), canceled]);
            clearTimeout(timer);
            if (epoch !== this.epoch || this.destroyed) return 'static';
            this.stopLoop();
            this.cancelCurrent = undefined;
            if (result && this.cinematic) await this.centerResult(epoch);
            if (epoch !== this.epoch || this.destroyed) return 'static';
            this.rolling = false;
            if (this.samples > 40 && this.slowFrames / this.samples > 0.08 && !this.lowQuality) {
                this.lowQuality = true;
                this.applyQuality(); // Apply between rolls, never reallocate the canvas mid-throw.
            }
            if (this.resizePending) this.resize();
            this.diagnostics();
            if (!result) return 'static';
            const actual = result.sets.flatMap((set) => set.rolls.map((roll) => roll.value));
            return actual.length === values.length && actual.every((v, i) => v === values[i])
                ? 'settled'
                : 'static';
        } catch {
            this.stopLoop();
            this.rolling = false;
            this.diagnostics();
            return 'static';
        }
    }
    /** Display-rate rendering with fixed-step Cannon interpolation, one rAF owner. */
    private animate(run: number, complete: () => void) {
        const box = this.box!;
        box.animstate = 'throw';
        this.stopLoop();
        const started = performance.now();
        for (const die of box.diceList) {
            die.body.previousPosition.copy(die.body.position);
            die.body.interpolatedPosition.copy(die.body.position);
            die.body.previousQuaternion.copy(die.body.quaternion);
            die.body.interpolatedQuaternion.copy(die.body.quaternion);
        }
        let previous = started;
        this.slowFrames = this.samples = 0;
        const tick = (now: number) => {
            if (this.destroyed || box.running !== run) return;
            const elapsed = now - previous;
            previous = now;
            this.samples++;
            if (elapsed > 22) this.slowFrames++;
            box.world.step(1 / 60, Math.min(elapsed / 1000, 0.05), 3);
            box.iteration = Math.floor((now - started) / (1000 / 60));
            for (const die of box.diceList) {
                die.position.copy(die.body.interpolatedPosition);
                die.quaternion.copy(die.body.interpolatedQuaternion);
            }
            if (box.throwFinished()) {
                box.running = false;
                box.rolling = false;
                box.animstate = 'afterthrow';
                complete.call(box);
                this.frame = 0;
                return;
            }
            this.draw();
            this.frame = requestAnimationFrame(tick);
        };
        this.frame = requestAnimationFrame(tick);
    }
    private draw() {
        if (!this.destroyed && this.box?.renderer)
            this.box.renderer.render(this.box.scene, this.box.camera);
    }
    private async centerResult(epoch: number) {
        const box = this.box;
        if (!box?.diceList.length) return;
        const x = box.diceList.reduce((sum, die) => sum + die.position.x, 0) / box.diceList.length;
        const y = box.diceList.reduce((sum, die) => sum + die.position.y, 0) / box.diceList.length;
        const fromX = box.camera.position.x,
            fromY = box.camera.position.y;
        const start = performance.now();
        await new Promise<void>((resolve) => {
            this.cancelCenter = resolve;
            const settle = (now: number) => {
                if (this.destroyed || epoch !== this.epoch) {
                    resolve();
                    return;
                }
                const t = Math.min(1, (now - start) / 240);
                const eased = t * t * (3 - 2 * t);
                const cx = fromX + (x - fromX) * eased,
                    cy = fromY + (y - fromY) * eased;
                box.camera.position.set(cx, cy, box.camera.position.z);
                box.camera.lookAt(cx, cy, 0);
                this.draw();
                if (t < 1) this.frame = requestAnimationFrame(settle);
                else {
                    this.frame = 0;
                    this.cancelCenter = undefined;
                    resolve();
                }
            };
            this.frame = requestAnimationFrame(settle);
        });
    }
    private stopLoop() {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
    }
    private cancel() {
        this.epoch++;
        this.cancelCurrent?.();
        this.cancelCurrent = undefined;
        this.cancelCenter?.();
        this.cancelCenter = undefined;
        this.stopLoop();
        if (this.box) this.box.running = false;
        this.rolling = false;
    }
    abort() {
        this.cancel();
        this.diagnostics();
    }
    dispose() {
        this.cancel();
        this.destroyed = true;
        this.observer?.disconnect();
        const box = this.box;
        if (box) {
            const geometries = new Set<{ dispose(): void }>();
            const materials = new Set<{
                dispose(): void;
                map?: { dispose(): void };
                bumpMap?: { dispose(): void };
            }>();
            box.scene.traverse((object) => {
                if (object.geometry) geometries.add(object.geometry);
                const list = Array.isArray(object.material) ? object.material : [object.material];
                list.forEach((material) => {
                    if (material) materials.add(material);
                });
            });
            Object.values(box.DiceFactory.geometries).forEach((geometry) =>
                geometries.add(geometry),
            );
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => {
                material.map?.dispose();
                material.bumpMap?.dispose();
                material.dispose();
            });
            if (box.renderer) {
                box.renderer.render = () => {};
                box.renderer.dispose();
                box.renderer.forceContextLoss();
            }
            box.scene.clear();
        }
        this.box = undefined;
        this.initializing = undefined;
        this.surface.replaceChildren();
        this.surface.remove();
    }
}
