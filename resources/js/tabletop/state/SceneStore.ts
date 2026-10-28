import type { GridSettings, Point, Scene, SceneMap, Token, TokenPatch } from '../types/scene';
import type { Mutation } from '../../api/workspace';
import { clamp } from '../utils/coordinates';

export interface WorkspaceSnapshot {
    scene: Scene;
    selectedIds: readonly string[];
    preview: { id: string; position: Point } | null;
}
export type SceneCommand =
    | { type: 'move'; id: string; position: Point }
    | { type: 'token'; id: string; patch: TokenPatch }
    | { type: 'grid'; grid: GridSettings }
    | { type: 'map'; map: SceneMap | null };
/** Observable domain projection. Network requests are delegated to the persistence adapter. */
export class SceneStore {
    private snapshot: WorkspaceSnapshot;
    private listeners = new Set<() => void>();
    private command?: (command: SceneCommand) => void;
    bindCommands(handler: (command: SceneCommand) => void) {
        this.command = handler;
    }
    hydrate(scene: Scene) {
        this.emit({ scene, selectedIds: [], preview: null });
    }
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
    updateToken(id: string, patch: TokenPatch, persist = true) {
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
        if (persist) {
            const token = tokens.find((token) => token.id === id);
            if (token) {
                const normalized: TokenPatch = {};
                for (const key of Object.keys(patch) as (keyof TokenPatch)[])
                    Object.assign(normalized, { [key]: token[key] });
                this.command?.({ type: 'token', id, patch: normalized });
            }
        }
    }
    moveToken(id: string, position: Point) {
        this.updateToken(id, position, false);
        this.command?.({ type: 'move', id, position });
    }
    setMap(map: SceneMap | null) {
        this.emit({ ...this.snapshot, scene: { ...this.snapshot.scene, map } });
        this.command?.({ type: 'map', map });
    }
    addToken(token: Token, revision: number) {
        this.emit({
            ...this.snapshot,
            scene: {
                ...this.snapshot.scene,
                revision: Math.max(this.snapshot.scene.revision ?? 0, revision),
                tokens: [...this.snapshot.scene.tokens, token],
            },
            selectedIds: [token.id],
        });
    }
    removeToken(id: string, revision: number) {
        this.emit({
            ...this.snapshot,
            scene: {
                ...this.snapshot.scene,
                revision: Math.max(this.snapshot.scene.revision ?? 0, revision),
                tokens: this.snapshot.scene.tokens.filter((token) => token.id !== id),
            },
            selectedIds: [],
            preview: null,
        });
    }
    accept(result: Mutation, apply: boolean) {
        let scene = {
            ...this.snapshot.scene,
            revision: Math.max(this.snapshot.scene.revision ?? 0, result.revision),
        };
        if (apply) {
            if (result.token)
                scene = {
                    ...scene,
                    tokens: scene.tokens.map((token) =>
                        token.id === result.token!.id ? result.token! : token,
                    ),
                };
            if (result.grid) scene = { ...scene, grid: result.grid };
            if ('map' in result) scene = { ...scene, map: result.map };
        }
        this.emit({ ...this.snapshot, scene });
    }
    updateGrid(patch: Partial<GridSettings>) {
        const grid = { ...this.snapshot.scene.grid, ...patch };
        grid.size = Number.isFinite(grid.size)
            ? clamp(grid.size, 20, 160)
            : this.snapshot.scene.grid.size;
        if (!Number.isFinite(grid.offset.x) || !Number.isFinite(grid.offset.y)) return;
        this.emit({ ...this.snapshot, scene: { ...this.snapshot.scene, grid } });
        this.command?.({ type: 'grid', grid });
    }
}
