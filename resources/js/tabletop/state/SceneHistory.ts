import { request, ApiError } from '../../api/client';
import { api, commandId, type Mutation } from '../../api/workspace';
import type { Scene } from '../types/scene';
import type { SceneCommand, SceneStore } from './SceneStore';
import type { SaveQueue } from './SaveQueue';

export interface EditChange {
    kind: 'token' | 'prop' | 'note' | 'region';
    id: string;
    expected: Record<string, unknown>;
    value: Record<string, unknown>;
}
type Entry = { label: string; changes: EditChange[] };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function historyEntry(
    command: SceneCommand,
    before: Scene,
    result: Mutation,
): Entry | undefined {
    const changes: EditChange[] = [];
    const add = (
        kind: EditChange['kind'],
        old: object | undefined,
        next: object | undefined,
        keys: string[],
    ) => {
        if (!old || !next) return;
        const a = old as Record<string, unknown>,
            b = next as Record<string, unknown>;
        const changed = keys.filter((key) => key in a && key in b && !equal(a[key], b[key]));
        if (changed.length)
            changes.push({
                kind,
                id: String(b.id),
                expected: Object.fromEntries(changed.map((k) => [k, b[k]])),
                value: Object.fromEntries(changed.map((k) => [k, a[k]])),
            });
    };
    let label = 'Перемещение';
    if (
        command.type === 'move' ||
        (command.type === 'token' &&
            Object.keys(command.patch).every((k) => ['x', 'y'].includes(k)))
    ) {
        add(
            'token',
            before.tokens.find((t) => t.id === command.id),
            result.token,
            ['x', 'y'],
        );
    } else if (command.type === 'objects') {
        const c = command.command;
        if (c.endpoint === 'selection' && c.data.action === 'move') {
            result.tokens?.forEach((t) =>
                add(
                    'token',
                    before.tokens.find((v) => v.id === t.id),
                    t,
                    ['x', 'y'],
                ),
            );
            result.props?.forEach((p) =>
                add(
                    'prop',
                    before.props?.find((v) => v.id === p.id),
                    p,
                    ['x', 'y'],
                ),
            );
        } else if (
            c.endpoint === 'props' &&
            c.data.action === 'update' &&
            !c.data.order &&
            Object.keys(c.data.patch ?? {}).every((k) =>
                ['x', 'y', 'rotation', 'scale_x', 'scale_y'].includes(k),
            )
        ) {
            label = 'Положение объекта';
            result.props?.forEach((p) =>
                add(
                    'prop',
                    before.props?.find((v) => v.id === p.id),
                    p,
                    ['x', 'y', 'rotation', 'scaleX', 'scaleY'],
                ),
            );
        }
    } else if (command.type === 'note' && command.command.action === 'update') {
        add(
            'note',
            before.notes?.find((v) => v.id === result.note?.id),
            result.note,
            ['x', 'y'],
        );
    } else if (command.type === 'region' && command.command.action === 'update') {
        label = 'Изменение области';
        add(
            'region',
            before.regions?.find((v) => v.id === result.region?.id),
            result.region,
            ['name', 'shape', 'geometry', 'enabled'],
        );
    }
    return changes.length ? { label, changes } : undefined;
}

/** At most 50 confirmed edits, local to this scene/tab. Server compares affected fields. */
export class SceneHistory {
    private undo: Entry[] = [];
    private redo: Entry[] = [];
    private state = { undo: '', redo: '', busy: false, saving: false, notice: '' };
    private listeners = new Set<() => void>();
    constructor(
        private store: SceneStore,
        private queue: SaveQueue,
        private sceneId: string,
    ) {
        queue.subscribe(() => this.publish({ saving: queue.getSnapshot().status !== 'saved' }));
    }
    getSnapshot = () => this.state;
    subscribe = (fn: () => void) => {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    };
    private publish(patch: Partial<typeof this.state> = {}) {
        this.state = {
            ...this.state,
            ...patch,
            undo: this.undo.at(-1)?.label ?? '',
            redo: this.redo.at(-1)?.label ?? '',
        };
        this.listeners.forEach((fn) => fn());
    }
    clear() {
        this.undo = [];
        this.redo = [];
        this.publish();
    }
    record(command: SceneCommand, before: Scene | undefined, result: Mutation) {
        if (before && result.revision !== (before.revision ?? 0) + 1) {
            this.clear();
            this.publish({ notice: 'Сцена менялась параллельно. История правок начата заново.' });
            return;
        }
        this.redo = [];
        const entry = before && historyEntry(command, before, result);
        if (entry) {
            this.undo.push(entry);
            if (this.undo.length > 50) this.undo.shift();
        }
        this.publish({ notice: '' });
    }
    run = (redo = false) => {
        if (this.state.busy || this.queue.getSnapshot().status !== 'saved') return;
        const source = redo ? this.redo : this.undo,
            target = redo ? this.undo : this.redo;
        const entry = source.at(-1);
        if (!entry) return;
        this.publish({ busy: true, notice: '' });
        const id = commandId();
        this.store.trackMutation(id);
        this.queue.enqueue(`history:${id}`, async () => {
            try {
                const result = await request<Mutation>(
                    `/scenes/${this.sceneId}/edit-history`,
                    'POST',
                    { changes: entry.changes, clientMutationId: id },
                );
                this.store.accept(result, true);
                source.pop();
                target.push({
                    label: entry.label,
                    changes: entry.changes.map((c) => ({
                        ...c,
                        expected: c.value,
                        value: c.expected,
                    })),
                });
                this.publish({ busy: false });
            } catch (error) {
                if (error instanceof ApiError && [403, 404, 409, 422].includes(error.status)) {
                    this.store.reconcile(await api.snapshot(this.sceneId));
                    this.clear();
                    this.publish({
                        busy: false,
                        notice: 'Отмена недоступна: сцена изменилась. Загружено сохранённое состояние.',
                    });
                    return;
                }
                // Keep this exact UUID in SaveQueue; Retry resolves an ambiguous accepted write.
                throw error;
            }
        });
    };
}
