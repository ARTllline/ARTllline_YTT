import { useEffect, useState } from 'react';
import { effectNames, intensityNames } from '../../media/model';
import type { Scene } from '../../tabletop/types/scene';
import { objects } from '../../api/objects';
import { preparation } from '../../api/preparation';
import type { CueStep, CueConfig } from './model';

function ResourcePicker({
    campaignId,
    kind,
    value,
    onChange,
    optional = false,
}: {
    campaignId: string;
    kind: 'prefab' | 'encounter' | 'handout' | 'music' | 'ambient' | 'sfx';
    value?: string;
    onChange: (id: string) => void;
    optional?: boolean;
}) {
    const [page, setPage] = useState(1),
        [pages, setPages] = useState(1);
    const [items, setItems] = useState<{ id: string; name: string }[]>([]),
        [error, setError] = useState('');
    useEffect(() => {
        const abort = new AbortController();
        const load =
            kind === 'handout'
                ? preparation.handouts(campaignId, page, abort.signal).then((d) => ({
                      pages: d.pages,
                      items: d.handouts.map((h) => ({ id: h.id, name: h.title })),
                  }))
                : kind === 'music' || kind === 'ambient' || kind === 'sfx'
                  ? preparation
                        .assets(
                            campaignId,
                            { kind, page, search: '', tag: '', collection: '', sort: 'name' },
                            abort.signal,
                        )
                        .then((d) => ({ pages: d.pages, items: d.assets }))
                  : objects
                        .templates(campaignId, kind, '', page, abort.signal)
                        .then((d) => ({ pages: d.pages, items: d.templates }));
        void load
            .then((d) => {
                if (!abort.signal.aborted) {
                    setItems(d.items);
                    setPages(d.pages);
                    setError('');
                }
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [campaignId, kind, page]);
    return (
        <div className="cue-resource">
            <label>
                Подготовленный материал
                <select
                    required={!optional}
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                >
                    <option value="">Выберите…</option>
                    {value && !items.some((i) => i.id === String(value)) && (
                        <option value={value}>Выбранный материал · {value}</option>
                    )}
                    {items.map((item) => (
                        <option key={item.id} value={item.id}>
                            {item.name}
                        </option>
                    ))}
                </select>
            </label>
            {pages > 1 && (
                <div>
                    <button
                        type="button"
                        disabled={page === 1}
                        onClick={() => setPage((p) => p - 1)}
                    >
                        Назад
                    </button>
                    <span>
                        {page} / {pages}
                    </span>
                    <button
                        type="button"
                        disabled={page === pages}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Далее
                    </button>
                </div>
            )}
            {error && <p role="alert">{error}</p>}
        </div>
    );
}

export function CueActionFields({
    step,
    scene,
    onChange,
}: {
    step: CueStep;
    scene: Scene;
    onChange: (config: CueConfig) => void;
}) {
    const { type, config: c } = step;
    const patch = (value: Partial<CueConfig>) => onChange({ ...c, ...value });
    if (type.startsWith('atmosphere.'))
        return (
            <>
                <label>
                    Эффект
                    <select
                        value={c.effect ?? 'rain'}
                        onChange={(e) => patch({ effect: e.target.value })}
                    >
                        {Object.entries(effectNames).map(([key, name]) => (
                            <option key={key} value={key}>
                                {name}
                            </option>
                        ))}
                    </select>
                </label>
                {type === 'atmosphere.start' && (
                    <label>
                        Интенсивность
                        <select
                            value={c.intensity ?? 'medium'}
                            onChange={(e) => patch({ intensity: e.target.value })}
                        >
                            {Object.entries(intensityNames).map(([key, name]) => (
                                <option key={key} value={key}>
                                    {name}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
            </>
        );
    if (type.startsWith('music.') || type.startsWith('ambient.') || type === 'sfx.play')
        return (
            <>
                {(type.endsWith('start') || type === 'sfx.play' || type === 'ambient.stop') && (
                    <ResourcePicker
                        optional={type === 'ambient.stop'}
                        campaignId={scene.campaignId!}
                        kind={type.split('.')[0] as 'music' | 'ambient' | 'sfx'}
                        value={c.assetId}
                        onChange={(assetId) => patch({ assetId: assetId || undefined })}
                    />
                )}
                {type === 'ambient.stop' && (
                    <p className="hint">Без выбранной дорожки остановятся все звуки атмосферы.</p>
                )}
                {(type.endsWith('start') || type === 'sfx.play') && (
                    <label>
                        Громкость
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={c.volume ?? 0.8}
                            onChange={(e) => patch({ volume: +e.target.value })}
                        />
                        <span>{Math.round((c.volume ?? 0.8) * 100)}%</span>
                    </label>
                )}
                {type !== 'sfx.play' && (
                    <label>
                        Плавный переход
                        <select
                            value={c.fade ?? 1000}
                            onChange={(e) => patch({ fade: +e.target.value })}
                        >
                            {[0, 500, 1000, 2000, 5000].map((ms) => (
                                <option key={ms} value={ms}>
                                    {ms / 1000} сек
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {type.endsWith('start') && (
                    <label>
                        <input
                            type="checkbox"
                            checked={c.loop ?? true}
                            onChange={(e) => patch({ loop: e.target.checked })}
                        />
                        Повторять запись
                    </label>
                )}
            </>
        );
    if (type.startsWith('screen.'))
        return (
            <>
                <label>
                    Цвет
                    <input
                        type="color"
                        value={c.color ?? '#c9d8e5'}
                        onChange={(e) => patch({ color: e.target.value })}
                    />
                </label>
                <label>
                    Длительность, мс
                    <input
                        type="number"
                        min="200"
                        max="2000"
                        value={c.duration ?? 600}
                        onChange={(e) => patch({ duration: +e.target.value })}
                    />
                </label>
                <p className="hint">Вспышки отключены при настройке уменьшения движения.</p>
            </>
        );
    const point = (
        <div className="cue-field-row">
            {(['x', 'y'] as const).map((axis) => (
                <label key={axis}>
                    {axis.toUpperCase()} · мир
                    <input
                        type="number"
                        step="any"
                        required
                        min={-1000000}
                        max={1000000}
                        value={c[axis] ?? 0}
                        onChange={(e) => patch({ [axis]: Number(e.target.value) })}
                    />
                </label>
            ))}
        </div>
    );
    const targetOptions = [
        ...scene.tokens.map((t) => ({ id: t.id, kind: 'token', name: t.name, hidden: t.isHidden })),
        ...(scene.props ?? []).map((p) => ({
            id: p.id,
            kind: 'prop',
            name: p.name ?? 'Объект',
            hidden: p.isHidden,
        })),
    ];
    return (
        <div className="cue-fields">
            {(type.startsWith('objects.') || type === 'combat.add') && (
                <fieldset className="cue-targets">
                    <legend>Объекты сцены</legend>
                    {targetOptions
                        .filter((o) => type !== 'combat.add' || o.kind === 'token')
                        .map((o) => {
                            const key = o.kind === 'token' ? 'tokenIds' : 'propIds';
                            const values = c[key] ?? [];
                            return (
                                <label key={o.kind + o.id}>
                                    <input
                                        type="checkbox"
                                        checked={values.map(String).includes(o.id)}
                                        onChange={(e) =>
                                            patch({
                                                [key]: e.target.checked
                                                    ? [...values, o.id]
                                                    : values.filter((id) => String(id) !== o.id),
                                            })
                                        }
                                    />
                                    <span>
                                        {o.name}
                                        {o.hidden ? ' · скрыт' : ''}
                                    </span>
                                </label>
                            );
                        })}
                    {!targetOptions.length && (
                        <p className="hint">Сначала добавьте объекты на сцену.</p>
                    )}
                </fieldset>
            )}
            {(type === 'object.move' || type === 'camera.focus') && (
                <label>
                    Цель
                    <select
                        required
                        value={c.kind === 'point' ? 'point' : `${c.kind}:${c.id ?? ''}`}
                        onChange={(e) => {
                            const [kind, id] = e.target.value.split(':');
                            onChange({
                                ...c,
                                kind: kind as CueConfig['kind'],
                                id,
                                x: kind === 'point' ? 0 : undefined,
                                y: kind === 'point' ? 0 : undefined,
                            });
                        }}
                    >
                        <option value="">Выберите цель…</option>
                        {type === 'camera.focus' && <option value="point">Точка на карте</option>}
                        {targetOptions.map((o) => (
                            <option key={o.kind + o.id} value={`${o.kind}:${o.id}`}>
                                {o.name}
                                {o.hidden ? ' · сначала показать' : ''}
                            </option>
                        ))}
                    </select>
                </label>
            )}
            {(['object.move', 'prefab.spawn', 'encounter.spawn', 'camera.pan'].includes(type) ||
                (type === 'camera.focus' && c.kind === 'point')) &&
                point}
            {(type === 'prefab.spawn' || type === 'encounter.spawn' || type === 'handout.show') && (
                <ResourcePicker
                    key={type}
                    campaignId={scene.campaignId!}
                    kind={
                        type === 'handout.show'
                            ? 'handout'
                            : type === 'prefab.spawn'
                              ? 'prefab'
                              : 'encounter'
                    }
                    value={type === 'handout.show' ? c.handoutId : c.templateId}
                    onChange={(id) =>
                        patch(type === 'handout.show' ? { handoutId: id } : { templateId: id })
                    }
                />
            )}
            {type === 'encounter.spawn' && (
                <>
                    <label className="cue-check">
                        <input
                            type="checkbox"
                            checked={c.addToCombat ?? false}
                            onChange={(e) => patch({ addToCombat: e.target.checked })}
                        />
                        Добавить в бой
                    </label>
                    <label className="cue-check">
                        <input
                            type="checkbox"
                            checked={c.startCombat ?? false}
                            onChange={(e) =>
                                patch({
                                    startCombat: e.target.checked,
                                    ...(e.target.checked ? { addToCombat: true } : {}),
                                })
                            }
                        />
                        Начать бой
                    </label>
                </>
            )}
            {type === 'message' && (
                <>
                    <label>
                        Заголовок · необязательно
                        <input
                            maxLength={160}
                            value={c.title ?? ''}
                            onChange={(e) => patch({ title: e.target.value })}
                        />
                    </label>
                    <label>
                        Сообщение
                        <textarea
                            required
                            maxLength={2000}
                            rows={3}
                            value={c.text ?? ''}
                            onChange={(e) => patch({ text: e.target.value })}
                        />
                    </label>
                </>
            )}
            {type === 'camera.zoom' && (
                <label>
                    Масштаб, %
                    <input
                        type="number"
                        min={20}
                        max={300}
                        required
                        value={Math.round((c.zoom ?? 1) * 100)}
                        onChange={(e) => patch({ zoom: Number(e.target.value) / 100 })}
                    />
                </label>
            )}
            {type === 'camera.shake' && (
                <label>
                    Сила
                    <select
                        value={c.strength}
                        onChange={(e) => patch({ strength: e.target.value })}
                    >
                        <option value="light">Лёгкая</option>
                        <option value="medium">Средняя</option>
                        <option value="strong">Сильная</option>
                    </select>
                </label>
            )}
            {type === 'camera.fade' && (
                <label>
                    Изображение
                    <select
                        value={c.blackout ? 'black' : 'clear'}
                        onChange={(e) => patch({ blackout: e.target.value === 'black' })}
                    >
                        <option value="black">Затемнить</option>
                        <option value="clear">Вернуть изображение</option>
                    </select>
                </label>
            )}
            {c.duration !== undefined && (
                <label>
                    Длительность, мс
                    <input
                        type="number"
                        required
                        min={type === 'wait' ? 100 : type === 'message' ? 500 : 0}
                        max={type === 'wait' ? 60000 : type === 'message' ? 30000 : 10000}
                        step={50}
                        value={c.duration}
                        onChange={(e) => patch({ duration: Number(e.target.value) })}
                    />
                </label>
            )}
            {type === 'camera.focus' && (
                <p className="hint">
                    Скрытую цель сначала нужно показать. Камера получает только её доступную
                    позицию.
                </p>
            )}
            {type === 'wait' && (
                <p className="hint">
                    Сервер продолжит последовательность после паузы, даже если закрыть эту вкладку.
                </p>
            )}
            {type === 'camera.release' && (
                <p className="hint">
                    Игроки снова свободно перемещают камеру. Завершение события также возвращает
                    управление.
                </p>
            )}
            {type === 'combat.begin' && (
                <p className="hint">
                    Начинает подготовленный бой с первого участника. Добавьте противников предыдущим
                    действием или через панель боя.
                </p>
            )}
            {type === 'combat.end' && (
                <p className="hint">
                    Завершает текущий бой. HP и состояния участников сохраняются.
                </p>
            )}
            {type === 'combat.next' && (
                <p className="hint">
                    Передаёт ход следующему участнику текущего боя. После последнего начинается
                    новый раунд.
                </p>
            )}
        </div>
    );
}
