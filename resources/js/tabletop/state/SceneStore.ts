import type { GridSettings, Point, Scene, TokenPatch } from '../types/scene';
import { clamp } from '../utils/coordinates';

export interface WorkspaceSnapshot {
    scene: Scene;
    selectedIds: readonly string[];
    preview: { id: string; position: Point } | null;
}
/** Local demo domain state. Camera, hover and raw drag coordinates belong to the renderer. */
export class SceneStore {
    private snapshot: WorkspaceSnapshot;
    private listeners = new Set<() => void>();
    constructor(scene: Scene) {
        this.snapshot = { scene, selectedIds: [], preview: null };
    }
    getSnapshot = () => this.snapshot;
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    private emit(next: WorkspaceSnapshot) {
        this.snapshot = next;
        this.listeners.forEach((listener) => listener());
    }
    select(id: string | null) {
        if (id && !this.snapshot.scene.tokens.some((token) => token.id === id)) return;
        this.emit({ ...this.snapshot, selectedIds: id ? [id] : [], preview: null });
    }
    previewMove(id: string, position: Point) {
        this.emit({ ...this.snapshot, preview: { id, position: { ...position } } });
    }
    clearPreview() {
        this.emit({ ...this.snapshot, preview: null });
    }
    updateToken(id: string, patch: TokenPatch) {
        const tokens = this.snapshot.scene.tokens.map((token) => {
            if (token.id !== id) return token;
            const next = { ...token, ...patch };
            for (const key of ['x', 'y', 'rotation', 'scale', 'hp', 'maxHp'] as const) {
                if (!Number.isFinite(next[key])) next[key] = token[key];
            }
            next.name = next.name.trim().slice(0, 80) || token.name;
            next.scale = clamp(next.scale, 0.4, 3);
            next.rotation = ((next.rotation % 360) + 360) % 360;
            next.maxHp = clamp(Math.round(next.maxHp), 1, 9999);
            next.hp = clamp(Math.round(next.hp), 0, next.maxHp);
            return next;
        });
        this.emit({ ...this.snapshot, scene: { ...this.snapshot.scene, tokens }, preview: null });
    }
    updateGrid(patch: Partial<GridSettings>) {
        const grid = { ...this.snapshot.scene.grid, ...patch };
        grid.size = Number.isFinite(grid.size)
            ? clamp(grid.size, 20, 160)
            : this.snapshot.scene.grid.size;
        if (!Number.isFinite(grid.offset.x) || !Number.isFinite(grid.offset.y)) return;
        this.emit({ ...this.snapshot, scene: { ...this.snapshot.scene, grid } });
    }
}
