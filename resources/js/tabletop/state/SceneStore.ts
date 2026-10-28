import { applyObjectPatch } from './objectPatch';
import { applyRegionPatch, type Region, type RegionCommand } from '../../automation/model';
import type { ObjectCommand, ObjectSelection } from '../types/scene';
import type {
    GridSettings,
    Point,
    Scene,
    SceneMap,
    Token,
    TokenPatch,
    NoteCommand,
    SceneNote,
} from '../types/scene';
import type { Mutation } from '../../api/workspace';
import { SpatialState } from './SpatialState';
import type { FogStroke, FogBase } from '../types/spatial';
import { clamp } from '../utils/coordinates';
import type { CombatCommand, TokenCombatCommand } from '../types/combat';

export interface WorkspaceSnapshot {
    selectedRegionId?: string;
    showRegions?: boolean;
    regionShape?: Region['shape'];
    selectedPropIds?: readonly string[];
    spawnedEncounter?: { name: string; tokenIds: string[] };
    selectedNoteId?: string;
    showNotes?: boolean;
    combatNotice?: string;
    scene: Scene;
    selectedIds: readonly string[];
    preview: { id: string; position: Point } | null;
}
export type SceneCommand =
    | { type: 'region'; command: RegionCommand }
    | { type: 'objects'; command: ObjectCommand }
    | { type: 'note'; command: NoteCommand; debounce?: boolean }
    | { type: 'combat'; command: CombatCommand }
    | { type: 'tokenCombat'; id: string; command: TokenCombatCommand }
    | { type: 'move'; id: string; position: Point; dragSessionId?: string }
    | { type: 'token'; id: string; patch: TokenPatch }
    | { type: 'fog'; stroke: FogStroke; localId: string }
    | { type: 'fogReset'; base: FogBase }
    | { type: 'grid'; grid: GridSettings }
    | { type: 'map'; map: SceneMap | null };
/** Observable domain projection. Network requests are delegated to the persistence adapter. */
export class SceneStore {
    readonly spatial = new SpatialState();
    movementEnabled = true;
    objectEditingEnabled = true;
    onRevisionGap?: () => void;
    onSelectionAction?: (action: 'duplicate' | 'delete') => void;
    bindSelectionActions(handler?: (action: 'duplicate' | 'delete') => void) {
        this.onSelectionAction = handler;
    }
    readonly localMutations = new Set<string>();
    trackMutation(id: string) {
        this.localMutations.add(id);
        if (this.localMutations.size > 500)
            this.localMutations.delete(this.localMutations.values().next().value!);
    }
    private acknowledge(revision: number) {
        if (revision > (this.snapshot.scene.revision ?? 0) + 1) this.onRevisionGap?.();
    }
    setMovementEnabled(enabled: boolean) {
        this.movementEnabled = enabled;
    }
    dragSessionId?: string;
    onPreview?: (id: string, position: Point, cancelled: boolean) => void;
    readonly remotePreviews = new Map<string, { x: number; y: number; expires: number }>();
    canMove(id: string) {
        const token = this.snapshot.scene.tokens.find((t) => t.id === id);
        return (
            this.movementEnabled &&
            !!token &&
            !token.isLocked &&
            (this.role === 'gm' || token.canMove === true)
        );
    }
    reconcile(scene: Scene) {
        this.emit({
            ...this.snapshot,
            scene,
            selectedRegionId: scene.regions?.some((r) => r.id === this.snapshot.selectedRegionId)
                ? this.snapshot.selectedRegionId
                : undefined,
            selectedNoteId: scene.notes?.some((n) => n.id === this.snapshot.selectedNoteId)
                ? this.snapshot.selectedNoteId
                : undefined,
            selectedPropIds: this.snapshot.selectedPropIds?.filter((id) =>
                scene.props?.some((p) => p.id === id),
            ),
            selectedIds: this.snapshot.selectedIds.filter((id) =>
                scene.tokens.some((t) => t.id === id),
            ),
            preview: this.snapshot.preview,
        });
    }
    private snapshot: WorkspaceSnapshot;
    private listeners = new Set<() => void>();
    private command?: (command: SceneCommand) => void;
    bindCommands(handler: (command: SceneCommand) => void) {
        this.command = handler;
    }
    hydrate(scene: Scene) {
        this.emit({ scene, selectedIds: [], preview: null });
    }
    constructor(
        scene: Scene,
        readonly role: 'gm' | 'player' = 'gm',
    ) {
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
        this.emit({
            ...this.snapshot,
            selectedIds: id ? [id] : [],
            selectedPropIds: [],
            selectedNoteId: undefined,
            selectedRegionId: undefined,
            preview: null,
        });
    }
    selection(): ObjectSelection {
        return {
            tokenIds: [...this.snapshot.selectedIds],
            propIds: [...(this.snapshot.selectedPropIds ?? [])],
        };
    }
    selectObject(kind: 'token' | 'prop', id: string, toggle = false) {
        if (this.role !== 'gm') {
            if (kind === 'token') this.select(id);
            else if (this.snapshot.scene.props?.some((p) => p.id === id))
                this.emit({
                    ...this.snapshot,
                    selectedIds: [],
                    selectedPropIds: [id],
                    preview: null,
                });
            return;
        }
        const selection = toggle
            ? this.selection()
            : ({ tokenIds: [], propIds: [] } as ObjectSelection);
        const key = kind === 'token' ? 'tokenIds' : 'propIds';
        selection[key] =
            toggle && selection[key].includes(id)
                ? selection[key].filter((v) => v !== id)
                : [...selection[key], id];
        this.selectObjects(selection);
    }
    selectObjects(selection: ObjectSelection) {
        if (this.role !== 'gm') return;
        this.emit({
            ...this.snapshot,
            selectedIds: selection.tokenIds,
            selectedPropIds: selection.propIds,
            selectedNoteId: undefined,
            selectedRegionId: undefined,
            preview: null,
        });
    }
    objectCommand(command: ObjectCommand) {
        if (this.role !== 'gm') return;
        let scene = this.snapshot.scene;
        if (
            command.endpoint === 'props' &&
            command.data.action === 'update' &&
            command.data.patch
        ) {
            const { id, patch } = command.data;
            scene = {
                ...scene,
                props: scene.props?.map((p) =>
                    p.id === id
                        ? {
                              ...p,
                              ...('name' in patch ? { name: patch.name! } : {}),
                              ...('x' in patch ? { x: patch.x! } : {}),
                              ...('y' in patch ? { y: patch.y! } : {}),
                              ...('rotation' in patch ? { rotation: patch.rotation! } : {}),
                              ...('scale_x' in patch ? { scaleX: patch.scale_x! } : {}),
                              ...('scale_y' in patch ? { scaleY: patch.scale_y! } : {}),
                              ...('is_hidden' in patch ? { isHidden: patch.is_hidden! } : {}),
                              ...('is_locked' in patch ? { isLocked: patch.is_locked! } : {}),
                          }
                        : p,
                ),
            };
        }
        if (command.endpoint === 'selection' && command.data.action === 'move') {
            const d = command.data;
            const anchor = (d.anchorKind === 'token' ? scene.tokens : (scene.props ?? [])).find(
                (o) => o.id === d.anchorId,
            );
            if (!anchor) return;
            const dx = d.x - anchor.x,
                dy = d.y - anchor.y;
            scene = {
                ...scene,
                tokens: scene.tokens.map((t) =>
                    d.tokenIds.includes(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t,
                ),
                props: scene.props?.map((p) =>
                    d.propIds.includes(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p,
                ),
            };
        }
        this.emit({ ...this.snapshot, scene });
        this.command?.({ type: 'objects', command });
    }
    encounterPlaced(name: string, tokenIds: string[]) {
        this.emit({ ...this.snapshot, spawnedEncounter: { name, tokenIds } });
    }
    clearEncounterNotice() {
        this.emit({ ...this.snapshot, spawnedEncounter: undefined });
    }
    selectNote(id?: string) {
        if (this.role !== 'gm') return;
        this.emit({
            ...this.snapshot,
            selectedIds: [],
            selectedPropIds: [],
            selectedNoteId: id,
            selectedRegionId: undefined,
        });
    }
    selectRegion(id?: string) {
        if (this.role !== 'gm') return;
        this.emit({
            ...this.snapshot,
            selectedRegionId: id,
            selectedIds: [],
            selectedPropIds: [],
            selectedNoteId: undefined,
        });
    }
    regionSettings(patch: { showRegions?: boolean; regionShape?: Region['shape'] }) {
        if (this.role !== 'gm') return;
        this.emit({
            ...this.snapshot,
            ...patch,
            ...(patch.showRegions === false ? { selectedRegionId: undefined } : {}),
        });
    }
    regionCommand(command: RegionCommand) {
        if (this.role !== 'gm') return;
        const patch = command.action === 'update' ? { region: command as Region } : {};
        this.emit({ ...this.snapshot, scene: applyRegionPatch(this.snapshot.scene, patch) });
        this.command?.({ type: 'region', command });
    }
    toggleNotes() {
        this.emit({
            ...this.snapshot,
            showNotes: this.snapshot.showNotes === false,
            selectedNoteId: undefined,
        });
    }
    noteCommand(command: NoteCommand, debounce = false) {
        if (this.role !== 'gm') return;
        if (command.action === 'update') {
            const noteId = command.id;
            const note = this.snapshot.scene.notes?.find((n) => n.id === noteId);
            if (!note) return;
            const updated = { ...note, ...command.patch };
            this.emit({
                ...this.snapshot,
                scene: {
                    ...this.snapshot.scene,
                    notes: this.snapshot.scene.notes!.map((n) => (n.id === note.id ? updated : n)),
                },
            });
            // Coalesced body drafts carry the complete current note, preserving earlier fields.
            const { id, ...patch } = updated;
            command = { action: 'update', id, patch };
        }
        this.command?.({ type: 'note', command, debounce });
    }
    updateNote(id: string, patch: Partial<Omit<SceneNote, 'id'>>, debounce = false) {
        this.noteCommand({ action: 'update', id, patch }, debounce);
    }
    combatCommand(command: CombatCommand) {
        if (this.role !== 'gm') return;
        this.combatNotice('');
        this.command?.({ type: 'combat', command });
    }
    tokenCombat(id: string, command: TokenCombatCommand) {
        if (this.role !== 'gm') return;
        this.command?.({ type: 'tokenCombat', id, command });
    }
    combatNotice(message: string) {
        this.emit({ ...this.snapshot, combatNotice: message });
    }
    previewMove(id: string, position: Point) {
        this.onPreview?.(id, position, false);
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
                if (!Number.isFinite(next[key])) Object.assign(next, { [key]: token[key] });
            }
            next.name = next.name.trim().slice(0, 80) || token.name;
            next.scale = clamp(next.scale, 0.4, 3);
            next.rotation = ((next.rotation % 360) + 360) % 360;
            if (next.maxHp !== undefined) next.maxHp = clamp(Math.round(next.maxHp), 1, 9999);
            if (next.hp !== undefined) next.hp = clamp(Math.round(next.hp), 0, next.maxHp ?? 9999);
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
        this.command?.({ type: 'move', id, position, dragSessionId: this.dragSessionId });
        this.dragSessionId = undefined;
    }
    applyFog(stroke: FogStroke) {
        if (this.role !== 'gm') return;
        const localId = crypto.randomUUID();
        const fog = this.snapshot.scene.fog ?? { base: 'clear' as const, actions: [] };
        this.emit({
            ...this.snapshot,
            scene: {
                ...this.snapshot.scene,
                fog: {
                    ...fog,
                    actions: [...fog.actions, { ...stroke, id: localId, sequence: -1 }],
                },
            },
        });
        this.command?.({ type: 'fog', stroke, localId });
    }
    resetFog(base: FogBase) {
        if (this.role !== 'gm') return;
        this.emit({
            ...this.snapshot,
            scene: { ...this.snapshot.scene, fog: { base, actions: [] } },
        });
        this.command?.({ type: 'fogReset', base });
    }
    acceptFog(result: Mutation, localId?: string) {
        // Replace only this optimistic stroke. Later strokes/resets remain visible.
        const fog = this.snapshot.scene.fog;
        if (fog && localId && result.fogAction)
            this.emit({
                ...this.snapshot,
                scene: {
                    ...this.snapshot.scene,
                    fog: {
                        ...fog,
                        actions: fog.actions.map((a) =>
                            a.id === localId
                                ? {
                                      ...a,
                                      id: result.fogAction!.id,
                                      sequence: result.fogAction!.sequence,
                                  }
                                : a,
                        ),
                    },
                },
            });
        this.accept(result, false);
    }
    setMap(map: SceneMap | null) {
        this.emit({ ...this.snapshot, scene: { ...this.snapshot.scene, map } });
        this.command?.({ type: 'map', map });
    }
    addToken(token: Token, revision: number) {
        this.acknowledge(revision);
        this.emit({
            ...this.snapshot,
            scene: {
                ...this.snapshot.scene,
                revision: Math.max(this.snapshot.scene.revision ?? 0, revision),
                tokens: [...this.snapshot.scene.tokens.filter((t) => t.id !== token.id), token],
            },
            selectedIds: [token.id],
            selectedPropIds: [],
            selectedNoteId: undefined,
        });
    }
    removeToken(id: string, revision: number) {
        this.acknowledge(revision);
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
        this.acknowledge(result.revision);
        const stale = result.revision < (this.snapshot.scene.revision ?? 0);
        if (stale) this.onRevisionGap?.();
        let scene = {
            ...this.snapshot.scene,
            revision: Math.max(this.snapshot.scene.revision ?? 0, result.revision),
        };
        if (apply && !stale) {
            scene = {
                ...applyRegionPatch(
                    applyObjectPatch(scene, result),
                    this.role === 'gm' ? result : {},
                ),
                revision: scene.revision,
            };
            if (this.role === 'gm' && result.note)
                scene = {
                    ...scene,
                    notes: [
                        ...(scene.notes ?? []).filter((n) => n.id !== result.note!.id),
                        result.note,
                    ],
                };
            if (result.deletedNoteId)
                scene = {
                    ...scene,
                    notes: scene.notes?.filter((n) => n.id !== result.deletedNoteId),
                };
            if (result.token)
                scene = {
                    ...scene,
                    tokens: scene.tokens.map((token) =>
                        token.id === result.token!.id ? result.token! : token,
                    ),
                };
            if (result.grid) scene = { ...scene, grid: result.grid };
            if ('map' in result) scene = { ...scene, map: result.map };
            if ('combat' in result) scene = { ...scene, combat: result.combat };
            if (result.deletedId)
                scene = { ...scene, tokens: scene.tokens.filter((t) => t.id !== result.deletedId) };
        }
        this.emit({
            ...this.snapshot,
            scene,
            selectedPropIds: this.snapshot.selectedPropIds?.filter((id) =>
                scene.props?.some((p) => p.id === id),
            ),
            selectedIds: this.snapshot.selectedIds.filter((id) =>
                scene.tokens.some((t) => t.id === id),
            ),
            selectedRegionId: scene.regions?.some((r) => r.id === this.snapshot.selectedRegionId)
                ? this.snapshot.selectedRegionId
                : undefined,
        });
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
