import { api, commandId, type Mutation } from '../../api/workspace';
import type { SceneStore, SceneCommand } from './SceneStore';
import { SaveQueue } from './SaveQueue';
import { ApiError } from '../../api/client';

export class ScenePersistence {
    readonly queue = new SaveQueue();
    private versions = new Map<string, number>();
    constructor(
        private store: SceneStore,
        private sceneId: string,
    ) {
        store.bindCommands((command) => this.submit(command));
    }
    private submit(command: SceneCommand) {
        const mutationId = commandId();
        this.store.trackMutation(mutationId);
        const key =
            command.type === 'token' || command.type === 'move'
                ? `token:${command.id}`
                : command.type;
        const version = (this.versions.get(key) ?? 0) + 1;
        this.versions.set(key, version);
        this.queue.enqueue(
            key,
            async () => {
                try {
                    let result: Mutation;
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
                        );
                    else if (command.type === 'grid')
                        result = await api.grid(this.sceneId, command.grid, mutationId);
                    else result = await api.map(this.sceneId, command.map, mutationId);
                    this.store.accept(result, this.versions.get(key) === version);
                } catch (error) {
                    if (
                        this.store.role === 'player' &&
                        error instanceof ApiError &&
                        [403, 404, 422].includes(error.status)
                    ) {
                        // Restore the canonical projection immediately after a rejected optimistic
                        // move; keep the actionable error until retry or an explicit reload.
                        try {
                            this.store.reconcile(await api.snapshot(this.sceneId));
                        } catch {
                            /* Activation may already have revoked this scene. */
                        }
                    }
                    throw error;
                }
            },
            command.type === 'grid' ? 250 : 0,
        );
    }
}
