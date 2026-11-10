import type { SceneStore } from '../../tabletop/state/SceneStore';
import {
    rebuildAssemblies,
    positionedSources,
    syncAssemblyOpenings,
    type RoomMode,
} from '../../tabletop/structure/roomAssembly';
import { structureOf } from '../../tabletop/structure/model';
import { translationError } from '../../tabletop/structure/buildSelection';
import { BuildMaterialPicker, type BuildMaterialHistory } from './BuildMaterialPicker';

export function RoomSourceInspector({
    store,
    assemblyId,
    sourceIndex,
    history,
}: {
    store: SceneStore;
    assemblyId: string;
    sourceIndex: number;
    history: BuildMaterialHistory;
}) {
    const scene = store.getSnapshot().scene,
        graph = structureOf(scene);
    const assembly = graph.assemblies!.find((a) => a.id === assemblyId)!,
        source = assembly.sources[sourceIndex];
    const vertices = source.graph.vertices;
    const minX = Math.min(...vertices.map((v) => v.x)),
        maxX = Math.max(...vertices.map((v) => v.x));
    const minY = Math.min(...vertices.map((v) => v.y)),
        maxY = Math.max(...vertices.map((v) => v.y));
    const curved = source.graph.edges.some((e) => e.curve);
    const save = (mode: RoomMode, material: string | null, box?: number[]) => {
        try {
            const synced = syncAssemblyOpenings(graph);
            const assemblies = synced.assemblies!.map((a) => {
                if (a.id !== assemblyId) return a;
                return {
                    ...a,
                    sources: a.sources.map((s, i) => {
                        if (i !== sourceIndex) return s;
                        const vertices = box
                            ? s.graph.vertices.map((v) => ({
                                  ...v,
                                  x:
                                      Math.round(
                                          (box[0] +
                                              ((v.x - (minX + maxX) / 2) * box[2]) /
                                                  (maxX - minX)) *
                                              1000,
                                      ) / 1000,
                                  y:
                                      Math.round(
                                          (box[1] +
                                              ((v.y - (minY + maxY) / 2) * box[3]) /
                                                  (maxY - minY)) *
                                              1000,
                                      ) / 1000,
                              }))
                            : s.graph.vertices;
                        return {
                            mode,
                            graph: {
                                ...s.graph,
                                vertices,
                                rooms: s.graph.rooms.map((r) => ({
                                    ...r,
                                    materialVersionId: material,
                                })),
                            },
                        };
                    }),
                };
            });
            const next = rebuildAssemblies({
                ...synced,
                assemblies: box
                    ? assemblies.map((a) =>
                          a.id === assemblyId
                              ? {
                                    ...a,
                                    sources: positionedSources(a.sources, new Set([sourceIndex])),
                                }
                              : a,
                      )
                    : assemblies,
            });
            const error = translationError(
                scene,
                graph,
                next,
                new Set(next.vertices.map((v) => v.id)),
            );
            if (error) store.editorNotice(error);
            else store.saveStructure(next);
        } catch (error) {
            store.editorNotice((error as Error).message);
        }
    };
    const floor = source.graph.rooms[0].materialVersionId;
    return (
        <div className="build-selection">
            <strong>Исходное помещение · {sourceIndex + 1}</strong>
            <small>Форма и пол сохраняются в составе здания.</small>
            {sourceIndex > 0 && (
                <label className="field">
                    <span>Соединение</span>
                    <select
                        value={source.mode}
                        onChange={(e) => save(e.target.value as RoomMode, floor)}
                    >
                        <option value="union">Объединить помещения</option>
                        <option value="partition">Оставить перегородку</option>
                        <option value="trim">Обрезать пересекающуюся часть</option>
                    </select>
                </label>
            )}
            <BuildMaterialPicker
                {...history}
                type="floor"
                value={floor}
                surfaces={scene.structure?.materials}
                onChange={(value) => save(source.mode, value)}
            />
            {!curved && (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        const data = new FormData(event.currentTarget);
                        save(
                            source.mode,
                            floor,
                            ['cx', 'cy', 'width', 'height'].map((k) => Number(data.get(k))),
                        );
                    }}
                >
                    {(
                        [
                            ['cx', 'Центр X, wu', (minX + maxX) / 2],
                            ['cy', 'Центр Y, wu', (minY + maxY) / 2],
                            ['width', 'Ширина исходного помещения, wu', maxX - minX],
                            ['height', 'Высота исходного помещения, wu', maxY - minY],
                        ] as const
                    ).map(([name, label, value]) => (
                        <label className="field" key={name}>
                            <span>{label}</span>
                            <input
                                type="number"
                                name={name}
                                aria-label={label}
                                step="0.001"
                                min={name === 'width' || name === 'height' ? 8 : 0}
                                max={20000}
                                required
                                defaultValue={value}
                            />
                        </label>
                    ))}
                    <button type="submit" className="primary-button">
                        Применить исходную форму
                    </button>
                </form>
            )}
        </div>
    );
}
