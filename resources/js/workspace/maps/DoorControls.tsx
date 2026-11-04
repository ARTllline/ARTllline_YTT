import type { SceneStore } from '../../tabletop/state/SceneStore';
import { along, vertexIndex, type Door } from '../../tabletop/structure/model';
import type { Scene } from '../../tabletop/types/scene';

export function DoorControls({
    door,
    store,
    busy,
}: {
    door: Door;
    store: SceneStore;
    busy?: boolean;
}) {
    return (
        <div className="build-tools">
            <button
                disabled={busy || door.locked}
                title={door.locked ? 'Сначала отоприте замок' : undefined}
                onClick={() => store.changeDoor({ id: door.id, open: !door.open })}
            >
                {door.open ? 'Закрыть дверь' : 'Открыть дверь'}
            </button>
            <button
                disabled={busy}
                onClick={() => store.changeDoor({ id: door.id, locked: !door.locked })}
            >
                {door.locked ? 'Отпереть замок' : 'Запереть замок'}
            </button>
        </div>
    );
}

export function SessionDoors({
    scene,
    store,
    busy,
}: {
    scene: Scene;
    store: SceneStore;
    busy: boolean;
}) {
    const graph = scene.structure?.graph;
    const doors = graph?.openings?.filter((o) => o.type === 'door');
    if (!graph || !doors?.length || store.role !== 'gm') return null;
    const vertices = vertexIndex(graph);
    const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
    return (
        <details className="session-doors">
            <summary className="scene-switch">Двери · {doors.length}</summary>
            <div className="panel session-door-list">
                {doors.map((door, index) => {
                    const edge = edges.get(door.edgeId)!;
                    const point = along(vertices.get(edge.a)!, vertices.get(edge.b)!, door.center);
                    return (
                        <div key={door.id} className="build-selection">
                            <strong>
                                Дверь {index + 1} · {door.open ? 'открыта' : 'закрыта'}
                            </strong>
                            <small>
                                {Math.round(point.x)}, {Math.round(point.y)} wu
                                {door.locked && ' · заперта'}
                            </small>
                            <DoorControls door={door} store={store} busy={busy} />
                        </div>
                    );
                })}
            </div>
        </details>
    );
}
