import type { SceneStore } from '../../tabletop/state/SceneStore';
import { reshapeCurve, type Curve } from '../../tabletop/structure/curves';
import { translationError } from '../../tabletop/structure/buildSelection';
import { structureOf } from '../../tabletop/structure/model';

export function CurveInspector({
    store,
    curve,
    open,
}: {
    store: SceneStore;
    curve: Curve;
    open: boolean;
}) {
    const fields = [
        ['cx', 'Центр X, wu', 0, 20000],
        ['cy', 'Центр Y, wu', 0, 20000],
        ['rx', 'Радиус X, wu', 8, 10000],
        ...(curve.kind === 'ellipse' ? [['ry', 'Радиус Y, wu', 8, 10000] as const] : []),
        ['rotation', 'Поворот, °', -360, 360],
        ...(open
            ? ([
                  ['start', 'Начало дуги, °', -360, 360],
                  ['sweep', 'Размах дуги, °', -359, 359],
              ] as const)
            : []),
    ] as const;
    return (
        <form
            className="build-selection"
            onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const patch: Partial<Curve> = {};
                for (const [key] of fields) patch[key] = Number(data.get(key));
                const scene = store.getSnapshot().scene,
                    before = structureOf(scene);
                let next;
                try {
                    next = reshapeCurve(before, curve.group, patch);
                } catch (error) {
                    store.editorNotice((error as Error).message);
                    return;
                }
                if (store.proposeRoomMove(next)) return;
                const ids = new Set(
                    before.edges
                        .filter((e) => e.curve?.group === curve.group)
                        .flatMap((e) => [e.a, e.b]),
                );
                const error = translationError(scene, before, next, ids);
                if (error) store.editorNotice(error);
                else {
                    store.editorNotice('');
                    store.saveStructure(next);
                }
            }}
        >
            <strong>
                {open
                    ? 'Дуговая стена'
                    : curve.kind === 'circle'
                      ? 'Круглая комната'
                      : 'Овальная комната'}
            </strong>
            {fields.map(([key, label, min, max]) => (
                <label className="field" key={key}>
                    <span>{label}</span>
                    <input
                        name={key}
                        type="number"
                        min={min}
                        max={max}
                        step="0.001"
                        required
                        defaultValue={curve[key]}
                    />
                </label>
            ))}
            <button className="primary-button" type="submit">
                Применить форму
            </button>
            <small>
                Маркеры на карте: центр, радиусы, поворот{open ? ', начало и конец дуги' : ''}.
                Shift — шаг угла 15°.
            </small>
        </form>
    );
}
