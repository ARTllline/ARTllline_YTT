declare module '@3d-dice/dice-box-threejs' {
    interface Vector {
        x: number;
        y: number;
        z: number;
        set(x: number, y: number, z: number): void;
        copy(other: unknown): void;
    }
    interface Material {
        dispose(): void;
        map?: { dispose(): void };
        bumpMap?: { dispose(): void };
    }
    interface Geometry {
        dispose(): void;
        computeBoundingSphere(): void;
        boundingSphere: { radius: number };
    }
    interface Mesh {
        position: Vector;
        quaternion: { copy(other: unknown): void };
        rotation: { set(x: number, y: number, z: number): void };
        geometry: Geometry;
        castShadow: boolean;
        body: {
            position: Vector;
            previousPosition: Vector;
            quaternion: unknown;
            previousQuaternion: { copy(other: unknown): void };
            interpolatedPosition: Vector;
            interpolatedQuaternion: { copy(other: unknown): void };
        };
        getLastValue(): { value: number };
        storeRolledValue(reason: string): void;
    }
    export default class DiceBox {
        constructor(selector: string, config: Record<string, unknown>);
        initialize(): Promise<void>;
        roll(notation: string): Promise<{ sets: { rolls: { value: number }[] }[] }>;
        resizeWorld(): void;
        setDimensions(size?: { x: number; y: number }): void;
        clearDice(): void;
        disableShadows(): void;
        animateThrow(run: number, complete: () => void): void;
        animateAfterThrow(): void;
        throwFinished(): boolean;
        running: boolean | number;
        rolling: boolean;
        iteration: number;
        animstate: string;
        diceList: Mesh[];
        swapDiceFace(die: Mesh, value: number): void;
        getDiceResults(): { sets: { rolls: { value: number }[] }[]; total: number };
        DiceFactory: { create(shape: string): Mesh | null; geometries: Record<string, Geometry> };
        world: {
            step(fixed: number, elapsed?: number, maxSubsteps?: number): void;
            removeBody(body: unknown): void;
            solver: { iterations: number };
        };
        light?: { shadow: { mapSize: { set(x: number, y: number): void } } };
        camera: { position: Vector; lookAt(x: number, y: number, z: number): void };
        scene: {
            add(mesh: Mesh): void;
            remove(mesh: Mesh): void;
            traverse(
                visitor: (object: {
                    geometry?: Geometry;
                    material?: Material | Material[];
                }) => void,
            ): void;
            clear(): void;
        };
        renderer?: {
            render(scene: unknown, camera: unknown): void;
            compile(scene: unknown, camera: unknown): void;
            setPixelRatio(value: number): void;
            dispose(): void;
            forceContextLoss(): void;
        };
    }
}
