import { objects } from '../../api/objects';
import { automation } from '../../automation/model';
import { api, commandId, type Mutation } from '../../api/workspace';
import type { SceneStore, SceneCommand } from './SceneStore';
import { SaveQueue } from './SaveQueue';
import { ApiError } from '../../api/client';
import { SceneHistory } from './SceneHistory';
import type { Scene } from '../types/scene';

export class ScenePersistence {
    readonly queue = new SaveQueue();
    private versions = new Map<string, number>();
    constructor(
        private store: SceneStore,
        private sceneId: string,
    ) {
        if (store.role === 'gm') store.history = new SceneHistory(store, this.queue, sceneId);
        store.bindCommands((command, before) => this.submit(command, before));
        this.queue.subscribe(() => {
            store.objectEditingEnabled = this.queue.getSnapshot().status === 'saved';
        });
    }
    private submit(command: SceneCommand, before?: Scene) {
        const mutationId = commandId();
        this.store.trackMutation(mutationId);
        const key =
            command.type === 'terrain'
                ? `terrain:${mutationId}`
                : command.type === 'token' || command.type === 'tokenCombat'
                  ? `token:${command.id}`
                  : command.type === 'move'
                    ? `move:${command.id}`
                    : command.type === 'objects'
                      ? `objects:${mutationId}`
                      : command.type === 'region'
                        ? `region:${command.command.id ?? mutationId}`
                        : command.type === 'note'
                          ? `note:${command.command.action === 'create' ? mutationId : command.command.id}`
                          : command.type;
        const version = (this.versions.get(key) ?? 0) + 1;
        this.versions.set(key, version);
        this.queue.enqueue(
            key,
            async () => {
                if (command.type === 'move') this.store.queuedMovementPending = true;
                try {
                    let result: Mutation;
                    if (command.type === 'structure') {
                        result = await api.structure(
                            this.sceneId,
                            command.door ? { door: command.door } : { value: command.value },
                            command.expected,
                            mutationId,
                        );
                        this.store.history?.record(command, before, result);
                        this.store.accept(result, true);
                        return;
                    }
                    if (command.type === 'terrain') {
                        result = await api.terrain(this.sceneId, command.stroke, mutationId);
                        this.store.history?.record(command, before, result);
                        this.store.accept(result, true);
                        command.complete?.();
                        return;
                    }
                    if (command.type === 'mapWorld') {
                        result = await api.mapWorld(
                            this.sceneId,
                            command.value,
                            command.expected,
                            mutationId,
                        );
                        this.store.history?.record(command, before, result);
                        this.store.accept(result, true);
                        command.complete();
                        return;
                    }
                    if (command.type === 'region') {
                        result = await automation.region(this.sceneId, command.command, mutationId);
                        this.store.history?.record(command, before, result);
                        this.store.accept(result, this.versions.get(key) === version);
                        if (command.command.action === 'create' && result.region)
                            this.store.selectRegion(result.region.id);
                        return;
                    }
                    if (command.type === 'objects') {
                        result = await objects.command(this.sceneId, command.command, mutationId);
                        this.store.history?.record(command, before, result);
                        this.store.accept(result, true);
                        const data = command.command.data;
                        if (
                            command.command.endpoint === 'spawn' ||
                            ('action' in data && ['create', 'duplicate'].includes(data.action))
                        )
                            this.store.selectObjects({
                                tokenIds: result.tokens?.map((t) => t.id) ?? [],
                                propIds: result.props?.map((p) => p.id) ?? [],
                            });
                        if (command.command.endpoint === 'spawn' && command.command.encounter)
                            this.store.encounterPlaced(
                                command.command.encounter,
                                result.tokens?.map((t) => t.id) ?? [],
                            );
                        return;
                    }
                    if (command.type === 'note') {
                        result = await api.note(this.sceneId, command.command, mutationId);
                        this.store.history?.record(command, before, result);
                        this.store.accept(result, this.versions.get(key) === version);
                        if (command.command.action === 'create' && result.note)
                            this.store.selectNote(result.note.id);
                        return;
                    }
                    if (command.type === 'combat' || command.type === 'tokenCombat') {
                        result =
                            command.type === 'combat'
                                ? await api.combat(this.sceneId, command.command, mutationId)
                                : await api.tokenCombat(command.id, command.command, mutationId);
                        const current = this.versions.get(key) === version;
                        this.store.accept(result, current);
                        if (!current) this.store.onRevisionGap?.();
                        return;
                    }
                    if (command.type === 'fog' || command.type === 'fogReset') {
                        result =
                            command.type === 'fog'
                                ? await api.fog(this.sceneId, command.stroke, mutationId)
                                : await api.resetFog(this.sceneId, command.base, mutationId);
                        this.store.acceptFog(
                            result,
                            command.type === 'fog' ? command.localId : undefined,
                        );
                        return;
                    }
                    if (command.type === 'token')
                        result = await api.token(command.id, command.patch, mutationId);
                    else if (command.type === 'move')
                        result = await api.move(
                            command.id,
                            command.position,
                            mutationId,
                            command.dragSessionId,
                            command.intent,
                            command.waypoints,
                            command.instant,
                        );
                    else if (command.type === 'grid')
                        result = await api.grid(this.sceneId, command.grid, mutationId);
                    else result = await api.map(this.sceneId, command.map, mutationId);
                    this.store.history?.record(command, before, result);
                    if (command.type === 'move') this.store.onMovementReceipt?.(result.revision);
                    this.store.accept(
                        result,
                        command.type === 'move' || this.versions.get(key) === version,
                    );
                } catch (error) {
                    if (
                        (command.type === 'terrain' || command.type === 'structure') &&
                        error instanceof ApiError &&
                        [403, 404, 409, 422].includes(error.status)
                    ) {
                        try {
                            this.store.reconcile(await api.snapshot(this.sceneId));
                        } catch {
                            /* Access can be revoked along with the write. */
                        }
                        this.store.editorNotice(error.message);
                        if (command.type === 'terrain') command.complete?.(error);
                        return;
                    }
                    if (
                        command.type === 'objects' &&
                        (this.store.getSnapshot().mapEditor ||
                            (command.command.endpoint === 'selection' &&
                                command.command.data.action === 'move')) &&
                        error instanceof ApiError &&
                        [403, 404, 409, 422].includes(error.status)
                    ) {
                        // A definitive editor rejection must not trap the queue behind an invalid transform.
                        this.store.reconcile(await api.snapshot(this.sceneId));
                        if (this.store.getSnapshot().mapEditor)
                            this.store.editorNotice(error.message);
                        else this.store.combatNotice(error.message);
                        return;
                    }
                    if (
                        command.type === 'mapWorld' &&
                        error instanceof ApiError &&
                        [403, 404, 409, 422].includes(error.status)
                    ) {
                        // A rejected settings command is terminal. Keep the draft for correction.
                        try {
                            this.store.reconcile(await api.snapshot(this.sceneId));
                        } catch {
                            // Permission loss/deletion can revoke the snapshot too. No optimistic write needs rollback.
                        }
                        command.complete(error);
                        return;
                    }
                    if (
                        command.type === 'combat' &&
                        error instanceof ApiError &&
                        error.status === 409
                    ) {
                        // A rejected stale turn is terminal, not a command to retry against a new turn.
                        // If this read fails the queue retains the original command until recovery.
                        this.store.reconcile(await api.snapshot(this.sceneId));
                        this.store.combatNotice(error.message);
                        return;
                    }
                    if (
                        (this.store.role === 'player' || command.type === 'move') &&
                        error instanceof ApiError &&
                        [403, 404, 409, 422].includes(error.status)
                    ) {
                        // Restore the canonical projection after a rejected optimistic command.
                        try {
                            this.store.reconcile(await api.snapshot(this.sceneId));
                            if (
                                command.type === 'move' ||
                                (error.status === 422 &&
                                    command.type === 'tokenCombat' &&
                                    command.command.action === 'stand-up')
                            ) {
                                // A rules rejection (spent movement, restrained, wrong turn) is
                                // terminal. Retrying it must not block every subsequent action.
                                this.store.combatNotice(error.message);
                                return;
                            }
                        } catch {
                            /* Activation may already have revoked this scene. */
                        }
                    }
                    throw error;
                } finally {
                    if (command.type === 'move') this.store.queuedMovementPending = false;
                }
            },
            command.type === 'grid' ? 250 : command.type === 'note' && command.debounce ? 450 : 0,
        );
    }
}
