import { api, type Mutation } from '../../api/workspace';
import type { SceneStore, SceneCommand } from './SceneStore';
import { SaveQueue } from './SaveQueue';

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
        const key =
            command.type === 'token' || command.type === 'move'
                ? `token:${command.id}`
                : command.type;
        const version = (this.versions.get(key) ?? 0) + 1;
        this.versions.set(key, version);
        this.queue.enqueue(
            key,
            async () => {
                let result: Mutation;
                if (command.type === 'token') result = await api.token(command.id, command.patch);
                else if (command.type === 'move')
                    result = await api.move(command.id, command.position);
                else if (command.type === 'grid')
                    result = await api.grid(this.sceneId, command.grid);
                else result = await api.map(this.sceneId, command.map);
                this.store.accept(result, this.versions.get(key) === version);
            },
            command.type === 'grid' ? 250 : 0,
        );
    }
}
