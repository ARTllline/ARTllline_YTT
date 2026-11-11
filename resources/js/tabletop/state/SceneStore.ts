import { performanceMark } from '../../realtime/performance';
import {
    attachRoom,
    movedRoom,
    placementMode,
    roomOverlap,
    syncAssemblySurfaces,
    type RoomMode,
} from '../structure/roomAssembly';
import { translationError } from '../structure/buildSelection';
import { openingAnchor, type Placement } from '../structure/placement';
import { mapState, type MapSettings, type MapState } from '../mapWorld';
import {
    applyStructurePatch,
    emptyHash,
    structureOf,
    type Opening,
    type OpeningCommand,
    openingsError,
    type DoorCommand,
    defaultBuild,
    type BuildSettings,
    type Graph,
    type Selection,
} from '../structure/model';
import { terrainPatch, type TerrainStroke } from '../terrain/model';
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
import { applyFogPatch } from '../types/spatial';
import { clamp } from '../utils/coordinates';
import type { CombatCommand, TokenCombatCommand } from '../types/combat';

export interface WorkspaceSnapshot {
    roomProposal?: {
        incoming: Graph;
        before?: Graph;
        expected: string;
        mode: RoomMode;
        preview?: Graph;
        error?: string;
    };
    openingPlacements?: readonly Placement[];
    lightingDraft?: import('../lighting/model').LightingSettings;
    losDebug?: import('../vision/model').LosDebug;
    directNotice?: string;
    directControl?: { tokenId: string; follow: boolean };
    routePreview?: {
        status: 'searching' | 'ready' | 'sending' | 'error';
        tokenId: string;
        message: string;
        cost?: number;
        remaining?: number;
        allowed?: boolean;
    };
    build?: BuildSettings;
    structureSelection?: Selection;
    editorNotice?: string;
    mapEditor?: import('../mapEditor').MapEditorView | null;
    mapDraft?: MapSettings | null;
    mapCalibrationPoints?: readonly Point[];
    actingTokenId?: string;
    selectedRegionId?: string;
    showRegions?: boolean;
    regionShape?: Region['shape'];
    selectedPropIds?: readonly string[];
    spawnedEncounter?: { name: string; tokenIds: string[] };
    selectedNoteId?: string;
    showNotes?: boolean;
    combatNotice?: string;
    scene: Scene;
    movementUpdate?: {
        movements?: Mutation['tokenMovements'];
        reset?: boolean;
        geometryChanged?: boolean;
    };
    selectedIds: readonly string[];
    preview: { id: string; position: Point } | null;
}
export type SceneCommand =
    | ({ type: 'structure'; expected: string; placement?: Placement } & (
          | { value: Graph; door?: never; opening?: never }
          | { door: DoorCommand; value?: never; opening?: never }
          | { opening: OpeningCommand; value?: never; door?: never; onRejected: (error: Error) => void }
      ))
    | { type: 'terrain'; stroke: TerrainStroke; complete?: (error?: Error) => void }
    | { type: 'mapWorld'; value: MapState; expected: MapState; complete: (error?: Error) => void }
    | { type: 'region'; command: RegionCommand }
    | { type: 'objects'; command: ObjectCommand }
    | { type: 'note'; command: NoteCommand; debounce?: boolean }
    | { type: 'combat'; command: CombatCommand }
    | { type: 'tokenCombat'; id: string; command: TokenCombatCommand }
    | {
          type: 'move';
          id: string;
          position: Point;
          dragSessionId?: string;
          intent?: 'override' | 'teleport';
          waypoints?: Point[];
          instant?: boolean;
          playback?: boolean;
      }
    | { type: 'token'; id: string; patch: TokenPatch }
    | { type: 'fog'; stroke: FogStroke }
    | { type: 'fogReset'; base: FogBase }
    | { type: 'grid'; grid: GridSettings }
    | { type: 'map'; map: SceneMap | null };
/** Observable domain projection. Network requests are delegated to the persistence adapter. */
export class SceneStore {
    private lightingFrame?: import('../lighting/model').LightingFrame;
    onLightingFrame?: (frame: import('../lighting/model').LightingFrame) => void;
    onLightingReset?: () => void;
    getLightingFrame() {
        return this.lightingFrame;
    }
    acceptLighting(frame: import('../lighting/model').LightingFrame) {
        if (
            frame.sceneId !== this.snapshot.scene.id ||
            frame.revision < Math.max(this.visibilityRevision, this.snapshot.scene.revision ?? 0) ||
            (this.lightingFrame?.sceneId === frame.sceneId &&
                frame.revision < this.lightingFrame.revision)
        )
            return;
        this.lightingFrame = frame;
        this.onLightingFrame?.(frame);
    }
    private visibilityRevision = 0;
    revokeVisibility(scene: Scene, revision: number, geometryChanged?: boolean) {
        if (revision <= this.visibilityRevision) return;
        this.reconcile(scene, { geometryChanged }, revision);
    }
    onLightPlacement?: (point: Point) => void;
    bindLightPlacement(handler?: (point: Point) => void) {
        if (this.role === 'gm') this.onLightPlacement = handler;
    }
    setLightingDraft(lightingDraft?: import('../lighting/model').LightingSettings) {
        if (this.role === 'gm') this.emit({ ...this.snapshot, lightingDraft });
    }
    onLosProbe?: (point: Point) => void;
    bindLosProbe(handler?: (point: Point) => void) {
        if (this.role === 'gm') this.onLosProbe = handler;
    }
    setLosDebug(losDebug?: import('../vision/model').LosDebug) {
        if (this.role === 'gm') this.emit({ ...this.snapshot, losDebug });
    }
    toggleDirectControl?: () => void;
    stopDirectControl?: () => void;
    directCommandPending = false;
    queuedMovementPending = false;
    onMovementSettled?: () => void;
    onMovementReceipt?: (revision: number) => void;
    setDirectControl(directControl: WorkspaceSnapshot['directControl']) {
        this.emit({ ...this.snapshot, directControl });
    }
    setDirectNotice(directNotice?: string) {
        this.emit({ ...this.snapshot, directNotice });
    }
    confirmRoute?: () => void;
    cancelRoute?: () => void;
    setRoutePreview(routePreview: WorkspaceSnapshot['routePreview']) {
        this.emit({ ...this.snapshot, routePreview });
    }
    onGameplayFeedback?: (event: import('../../gameplay/model').GameplayFeedback) => void;
    history?: import('./SceneHistory').SceneHistory;
    readonly spatial = new SpatialState();
    abilityTargeting = false;
    setAbilityTargeting(value: boolean) {
        this.abilityTargeting = value;
    }
    movementEnabled = true;
    objectEditingEnabled = true;
    onStructureAction?: (action: 'split' | 'delete' | 'reverse' | 'join') => void;
    onStructureMove?: (delta: Point) => void;
    placementEnabled = true;
    cancelOpeningJob?: (id: string) => void;
    canBuild(placement = false) {
        return (
            this.role === 'gm' &&
            !!this.snapshot.mapEditor &&
            !this.snapshot.mapDraft &&
            !!this.snapshot.scene.mapWorld &&
            this.spatial.tool === 'build' &&
            (this.objectEditingEnabled || (placement && this.placementEnabled))
        );
    }
    placeOpening(opening: Opening) {
        if (!this.canBuild(true) || !this.command) return;
        const placements = this.snapshot.openingPlacements ?? [];
        if (placements.filter((p) => p.status === 'pending').length >= 16) {
            this.editorNotice(
                'Очередь заполнена (16). Дождитесь сохранения перед следующим кликом.',
            );
            return;
        }
        const graph = structureOf(this.snapshot.scene);
        const placement: Placement = {
            opening,
            anchor: openingAnchor(graph, opening.edgeId),
            status: 'pending',
        };
        this.emit({
            ...this.snapshot,
            openingPlacements: [
                ...placements.filter((p) => p.status === 'pending'),
                ...placements.filter((p) => p.status !== 'pending').slice(-15),
                placement,
            ],
        });
        this.command(
            { type: 'structure', value: graph, expected: '', placement },
            this.snapshot.scene,
        );
    }
    updateOpening(placement: Placement, patch: Partial<Placement>) {
        Object.assign(placement, patch);
        this.emit({
            ...this.snapshot,
            openingPlacements: [...(this.snapshot.openingPlacements ?? [])],
        });
    }
    cancelOpeningPlacements() {
        const placements = this.snapshot.openingPlacements ?? [];
        for (const p of placements)
            if (p.status === 'pending' && !p.sent) this.cancelOpeningJob?.(p.opening.id);
        this.emit({
            ...this.snapshot,
            openingPlacements: placements.filter((p) => p.status !== 'pending' || p.sent),
        });
    }
    saveStructure(value: Graph) {
        if (!this.canBuild()) return;
        try {
            value = syncAssemblySurfaces(value);
        } catch (error) {
            this.editorNotice((error as Error).message);
            return;
        }
        const error = openingsError(value);
        if (error) {
            this.editorNotice(error);
            return;
        }
        const current = this.snapshot.scene.structure;
        this.command?.(
            { type: 'structure', value, expected: current?.hash ?? emptyHash },
            this.snapshot.scene,
        );
    }
    addRoom(incoming: Graph) {
        const before = structureOf(this.snapshot.scene);
        if (!roomOverlap(before, incoming)) {
            this.saveStructure({
                ...before,
                vertices: [...before.vertices, ...incoming.vertices],
                edges: [...before.edges, ...incoming.edges],
                rooms: [...before.rooms, ...incoming.rooms],
            });
            return;
        }
        const mode = placementMode(before, incoming);
        if (mode) {
            this.placeRoomDirect(before, incoming, mode);
            return;
        }
        this.emit({
            ...this.snapshot,
            roomProposal: {
                incoming,
                expected: this.snapshot.scene.structure?.hash ?? emptyHash,
                mode: 'union',
            },
        });
        this.previewRoom('union');
    }
    proposeRoomMove(moved: Graph) {
        const prepared = movedRoom(
            structureOf(this.snapshot.scene),
            moved,
            this.snapshot.structureSelection,
        );
        if (!prepared) return false;
        const mode = placementMode(prepared.before, prepared.incoming);
        if (mode) {
            this.placeRoomDirect(prepared.before, prepared.incoming, mode);
            return true;
        }
        this.emit({
            ...this.snapshot,
            roomProposal: {
                ...prepared,
                expected: this.snapshot.scene.structure?.hash ?? emptyHash,
                mode: 'union',
            },
        });
        this.previewRoom('union');
        return true;
    }
    private placeRoomDirect(before: Graph, incoming: Graph, mode: RoomMode) {
        try {
            const next = attachRoom(before, incoming, mode);
            const error = translationError(
                this.snapshot.scene,
                structureOf(this.snapshot.scene),
                next,
                new Set(next.vertices.map((v) => v.id)),
            );
            if (error) this.editorNotice(error);
            else this.saveStructure(next);
        } catch (error) {
            this.editorNotice((error as Error).message);
        }
    }
    previewRoom(mode: RoomMode) {
        const proposal = this.snapshot.roomProposal;
        if (!proposal) return;
        try {
            const preview = attachRoom(
                proposal.before ?? structureOf(this.snapshot.scene),
                proposal.incoming,
                mode,
            );
            const error = translationError(
                this.snapshot.scene,
                structureOf(this.snapshot.scene),
                preview,
                new Set(preview.vertices.map((v) => v.id)),
            );
            this.emit({ ...this.snapshot, roomProposal: { ...proposal, mode, preview, error } });
        } catch (error) {
            this.emit({
                ...this.snapshot,
                roomProposal: {
                    ...proposal,
                    mode,
                    preview: undefined,
                    error: (error as Error).message,
                },
            });
        }
    }
    resolveRoom(commit: boolean) {
        const proposal = this.snapshot.roomProposal;
        if (!proposal) return;
        if (commit && proposal.expected !== (this.snapshot.scene.structure?.hash ?? emptyHash)) {
            this.emit({
                ...this.snapshot,
                roomProposal: undefined,
                editorNotice: 'Структура изменилась. Повторите размещение комнаты.',
            });
            return;
        }
        if (commit && (!proposal.preview || proposal.error)) return;
        this.emit({ ...this.snapshot, roomProposal: undefined });
        if (commit) this.saveStructure(proposal.preview!);
    }
    changeDoor(door: DoorCommand) {
        const scene = this.snapshot.scene;
        if (this.role !== 'gm' || !this.objectEditingEnabled || !scene.structure) return;
        this.command?.({ type: 'structure', door, expected: scene.structure.hash }, scene);
    }
    changeOpening(opening: OpeningCommand, onRejected: (error: Error) => void) {
        const scene = this.snapshot.scene;
        if (!this.objectEditingEnabled || !scene.structure) return;
        this.command?.({ type: 'structure', opening, expected: scene.structure.hash, onRejected }, scene);
    }
    configureBuild(patch: Partial<BuildSettings>) {
        if (this.role !== 'gm' || !this.snapshot.mapEditor) return;
        const build = { ...(this.snapshot.build ?? defaultBuild), ...patch };
        this.emit({
            ...this.snapshot,
            build,
        });
    }
    selectStructure(structureSelection: Selection | undefined) {
        this.emit({ ...this.snapshot, structureSelection });
    }
    terrainStroke(stroke: TerrainStroke, complete?: (error?: Error) => void) {
        if (
            this.role !== 'gm' ||
            !this.snapshot.mapEditor ||
            !this.objectEditingEnabled ||
            !this.snapshot.scene.mapWorld ||
            !this.command
        ) {
            complete?.(new Error('Рисование сейчас недоступно.'));
            return;
        }
        this.command?.({ type: 'terrain', stroke, complete }, this.snapshot.scene);
    }
    editorNotice(editorNotice: string) {
        this.emit({ ...this.snapshot, editorNotice });
    }
    setMapEditor(mapEditor: import('../mapEditor').MapEditorView | null) {
        if (this.role !== 'gm') return;
        this.emit({
            ...this.snapshot,
            mapEditor,
            losDebug: mapEditor ? this.snapshot.losDebug : undefined,
            build: mapEditor ? this.snapshot.build : undefined,
            roomProposal: mapEditor ? this.snapshot.roomProposal : undefined,
            structureSelection: mapEditor ? this.snapshot.structureSelection : undefined,
            selectedIds: [],
            selectedPropIds:
                this.snapshot.mapEditor && mapEditor?.objectsVisible && !mapEditor.objectsLocked
                    ? this.snapshot.selectedPropIds
                    : [],
            selectedNoteId: undefined,
            selectedRegionId: undefined,
        });
    }
    onMapCalibration?: (point: Point) => void;
    bindMapCalibration(handler?: (point: Point) => void) {
        this.onMapCalibration = handler;
    }
    previewMap(mapDraft: MapSettings | null, mapCalibrationPoints: readonly Point[] = []) {
        if (this.role === 'gm') this.emit({ ...this.snapshot, mapDraft, mapCalibrationPoints });
    }
    saveMapWorld(settings: MapSettings, expected: MapState): Promise<void> {
        if (this.role !== 'gm' || !this.command)
            return Promise.reject(new Error('Карту может изменять только мастер.'));
        const before = this.snapshot.scene;
        return new Promise((resolve, reject) =>
            this.command?.(
                {
                    type: 'mapWorld',
                    value: mapState(settings, true),
                    expected,
                    complete: (error) => (error ? reject(error) : resolve()),
                },
                before,
            ),
        );
    }
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
    reconcile(
        scene: Scene,
        movementUpdate: WorkspaceSnapshot['movementUpdate'] = { reset: true },
        visibilityRevision = scene.revision ?? 0,
    ) {
        if (scene.id !== this.snapshot.scene.id) this.visibilityRevision = 0;
        if (visibilityRevision < this.visibilityRevision) {
            // Earlier buffered revisions still advance canonical movement, but cannot
            // undo a later revocation already applied while awaiting our receipt.
            const current = this.snapshot.scene;
            scene = {
                ...scene,
                vision: current.vision,
                lighting: current.lighting,
                tokens: scene.tokens
                    .filter((t) => current.tokens.some((c) => c.id === t.id))
                    .map((t) => {
                        const latest = current.tokens.find((c) => c.id === t.id)!;
                        return latest.canMove === false ? latest : t;
                    }),
                props: scene.props?.filter((p) => current.props?.some((c) => c.id === p.id)),
            };
        }
        this.visibilityRevision = Math.max(this.visibilityRevision, visibilityRevision);
        this.emit({
            ...this.snapshot,
            scene,
            movementUpdate,
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
    private command?: (command: SceneCommand, before?: Scene) => void;
    bindCommands(handler: (command: SceneCommand, before?: Scene) => void) {
        this.command = handler;
    }
    hydrate(scene: Scene) {
        this.lightingFrame = undefined;
        this.onLightingReset?.();
        this.history?.clear();
        this.visibilityRevision = scene.revision ?? 0;
        this.emit({ scene, selectedIds: [], preview: null });
    }
    constructor(
        scene: Scene,
        readonly role: 'gm' | 'player' = 'gm',
    ) {
        this.snapshot = { scene, selectedIds: [], preview: null };
    }
    setActingToken(id?: string) {
        const token = this.snapshot.scene.tokens.find((t) => t.id === id);
        if (token?.characterId) {
            this.setActiveCharacter(token.characterId);
            return;
        }
        if (this.snapshot.scene.activeCharacterId) this.onActiveCharacterChange?.(null);
        this.snapshot = {
            ...this.snapshot,
            scene: { ...this.snapshot.scene, activeCharacterId: null },
        };
        this.emit({ ...this.snapshot, actingTokenId: id });
    }
    onActiveCharacterChange?: (id: string | null) => void;
    bindActiveCharacter(handler?: (id: string | null) => void) {
        this.onActiveCharacterChange = handler;
    }
    setActiveCharacter(id: string | null) {
        if (
            id &&
            this.role === 'player' &&
            !this.snapshot.scene.characters?.some((c) => c.id === id)
        )
            return;
        const actor = this.snapshot.scene.tokens.find(
            (t) => t.characterId === id && !t.isHidden && (this.role === 'gm' || t.isOwner),
        );
        this.emit({
            ...this.snapshot,
            actingTokenId: undefined,
            scene: { ...this.snapshot.scene, activeCharacterId: id },
            selectedIds: actor ? [actor.id] : [],
        });
        this.onActiveCharacterChange?.(id);
    }
    getSnapshot = () => this.snapshot;
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    private emit(next: WorkspaceSnapshot) {
        const geometryChanged =
            next.movementUpdate !== this.snapshot.movementUpdate &&
            next.movementUpdate?.geometryChanged;
        this.snapshot = next;
        // A later movement receipt cannot erase a real edit between two Pixi ticks.
        if (geometryChanged) {
            this.stopDirectControl?.();
            this.cancelRoute?.();
        }
        this.listeners.forEach((listener) => listener());
        performanceMark('state', {
            sceneId: this.snapshot.scene.id,
            revision: this.snapshot.scene.revision,
        });
    }
    select(id: string | null) {
        if (id && this.snapshot.mapEditor) return;
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
        const editor = this.snapshot.mapEditor;
        if (editor)
            selection = {
                tokenIds: [],
                propIds: editor.objectsVisible && !editor.objectsLocked ? selection.propIds : [],
            };
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
        const editor = this.snapshot.mapEditor;
        if (
            editor &&
            (editor.objectsLocked ||
                !editor.objectsVisible ||
                command.endpoint === 'spawn' ||
                (command.endpoint === 'selection' && command.data.tokenIds.length))
        )
            return;
        const before = this.snapshot.scene;
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
                              ...(patch.collider ? { collider: patch.collider } : {}),
                          }
                        : p,
                ),
            };
        }
        if (
            command.endpoint === 'selection' &&
            command.data.action === 'move' &&
            !command.data.tokenIds.length
        ) {
            const d = command.data;
            const anchor = (d.anchorKind === 'token' ? scene.tokens : (scene.props ?? [])).find(
                (o) => o.id === d.anchorId,
            );
            if (!anchor) return;
            const dx = d.x - anchor.x,
                dy = d.y - anchor.y;
            scene = {
                ...scene,
                props: scene.props?.map((p) =>
                    d.propIds.includes(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p,
                ),
            };
        }
        this.emit({ ...this.snapshot, scene, editorNotice: undefined });
        this.command?.({ type: 'objects', command }, before);
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
        const before = this.snapshot.scene;
        const patch = command.action === 'update' ? { region: command as Region } : {};
        this.emit({ ...this.snapshot, scene: applyRegionPatch(this.snapshot.scene, patch) });
        this.command?.({ type: 'region', command }, before);
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
        const before = this.snapshot.scene;
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
        this.command?.({ type: 'note', command, debounce }, before);
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
        if (this.role !== 'gm' && !(command.action === 'stand-up' && this.canMove(id))) return;
        this.combatNotice('');
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
        const before = this.snapshot.scene;
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
                this.command?.({ type: 'token', id, patch: normalized }, before);
            }
        }
    }
    moveToken(
        id: string,
        position: Point,
        intent?: 'override' | 'teleport',
        waypoints?: Point[],
        instant?: boolean,
        playback?: boolean,
    ) {
        this.combatNotice('');
        const before = this.snapshot.scene;
        this.clearPreview();
        this.command?.(
            {
                type: 'move',
                id,
                position,
                dragSessionId: this.dragSessionId,
                intent,
                waypoints,
                instant,
                playback,
            },
            before,
        );
        this.dragSessionId = undefined;
    }
    applyFog(stroke: FogStroke) {
        if (this.role !== 'gm' || !this.command) return;
        this.spatial.pendingFog = stroke;
        this.command({ type: 'fog', stroke }, this.snapshot.scene);
    }
    resetFog(base: FogBase) {
        if (this.role !== 'gm') return;
        this.command?.({ type: 'fogReset', base }, this.snapshot.scene);
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
        const visibilityStale = result.revision < this.visibilityRevision;
        if (stale) this.onRevisionGap?.();
        let scene = {
            ...this.snapshot.scene,
            revision: Math.max(this.snapshot.scene.revision ?? 0, result.revision),
        };
        if (apply && !stale && visibilityStale) {
            // Retain an accepted own position without restoring old masks/entities.
            // Removals and ownership revocations take precedence over the receipt.
            scene = {
                ...scene,
                tokens: scene.tokens.map((token) =>
                    token.id === result.token?.id && token.canMove === true
                        ? { ...token, x: result.token.x, y: result.token.y }
                        : token,
                ),
            };
        }
        if (apply && !stale && !visibilityStale) {
            scene = { ...terrainPatch(scene, result.terrain), revision: scene.revision };
            if (result.fog || result.fogAction || result.fogRemovedSequence)
                scene.fog = applyFogPatch(scene.fog, result);
            if (result.vision) scene = { ...scene, vision: result.vision };
            if (result.lighting) scene = { ...scene, lighting: result.lighting };
            if (result.scene) scene = { ...scene, ...result.scene, revision: scene.revision };
            if ('mapWorld' in result)
                scene = {
                    ...scene,
                    mapWorld: result.mapWorld,
                    structure: result.mapWorld ? scene.structure : null,
                };
            if (result.structure) scene = { ...scene, structure: result.structure };
            if (
                result.structureRefresh ||
                (result.structurePatch && result.structurePatch.base !== (scene.structure?.hash ?? emptyHash))
            ) {
                this.onRevisionGap?.();
            } else if (result.structurePatch) {
                scene.structure = applyStructurePatch(scene.structure, result.structurePatch);
            }
            if (result.character)
                scene = {
                    ...scene,
                    characters: [
                        ...(scene.characters ?? []).filter((c) => c.id !== result.character!.id),
                        result.character,
                    ],
                };
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
            movementUpdate: {
                geometryChanged: result.movementGeometryChanged,
                movements:
                    apply && result.revision === (this.snapshot.scene.revision ?? 0) + 1
                        ? result.tokenMovements
                        : undefined,
            },
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
