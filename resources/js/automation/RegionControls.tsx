import { useSyncExternalStore } from 'react';
import type { SceneStore } from '../tabletop/state/SceneStore';
import { NumberField } from '../workspace/NumberField';
import type { Region } from './model';

export function RegionControls({ store }: { store: SceneStore }) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const region = state.scene.regions?.find((r) => r.id === state.selectedRegionId);
    const update = (patch: Partial<Omit<Region, 'id'>>) => {
        if (region) store.regionCommand({ ...region, ...patch, action: 'update' });
    };
    const geometry = (key: string, value: number) => {
        if (region) update({ geometry: { ...region.geometry, [key]: value } });
    };
    return (
        <div className="spatial-settings region-controls" aria-label="Настройки областей">
            <strong>Области · только мастер</strong>
            <div className="spatial-row">
                <button
                    className={(state.regionShape ?? 'rectangle') === 'rectangle' ? 'active' : ''}
                    onClick={() => store.regionSettings({ regionShape: 'rectangle' })}
                >
                    Прямоугольник
                </button>
                <button
                    className={state.regionShape === 'circle' ? 'active' : ''}
                    onClick={() => store.regionSettings({ regionShape: 'circle' })}
                >
                    Круг
                </button>
            </div>
            <label className="check-row">
                <input
                    type="checkbox"
                    checked={state.showRegions !== false}
                    onChange={(e) => store.regionSettings({ showRegions: e.target.checked })}
                />
                Показывать области
            </label>
            <p className="hint">
                Потяните пустое место, чтобы нарисовать. Выделенную область можно двигать и
                растягивать за маркер. Скрытие границ не выключает триггеры.
            </p>
            <select
                aria-label="Выбрать область"
                value={region?.id ?? ''}
                onChange={(e) => {
                    store.regionSettings({ showRegions: true });
                    store.selectRegion(e.target.value || undefined);
                }}
            >
                <option value="">Новая область</option>
                {state.scene.regions?.map((r) => (
                    <option key={r.id} value={r.id}>
                        {r.name}
                    </option>
                ))}
            </select>
            {region && (
                <section className="region-fields" key={region.id}>
                    <label>
                        Название
                        <input
                            aria-label="Название области"
                            maxLength={160}
                            defaultValue={region.name}
                            onBlur={(e) => {
                                if (e.target.value.trim() && e.target.value !== region.name)
                                    update({ name: e.target.value });
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                        />
                    </label>
                    <div className="field-row">
                        <NumberField
                            label="X"
                            value={region.geometry.x}
                            onChange={(v) => geometry('x', v)}
                            min={-1000000}
                            max={1000000}
                        />
                        <NumberField
                            label="Y"
                            value={region.geometry.y}
                            onChange={(v) => geometry('y', v)}
                            min={-1000000}
                            max={1000000}
                        />
                    </div>
                    {region.shape === 'circle' ? (
                        <NumberField
                            label="Радиус"
                            min={5}
                            max={50000}
                            value={region.geometry.radius!}
                            onChange={(v) => geometry('radius', v)}
                        />
                    ) : (
                        <div className="field-row">
                            <NumberField
                                label="Ширина"
                                min={10}
                                max={100000}
                                value={region.geometry.width!}
                                onChange={(v) => geometry('width', v)}
                            />
                            <NumberField
                                label="Высота"
                                min={10}
                                max={100000}
                                value={region.geometry.height!}
                                onChange={(v) => geometry('height', v)}
                            />
                        </div>
                    )}
                    <label className="check-row">
                        <input
                            type="checkbox"
                            checked={region.enabled}
                            onChange={(e) => update({ enabled: e.target.checked })}
                        />
                        Область включена
                    </label>
                    <button
                        className="danger-button"
                        onClick={() => {
                            if (
                                confirm(
                                    `Удалить область «${region.name}»? Привязанные триггеры потеряют цель.`,
                                )
                            )
                                store.regionCommand({ action: 'delete', id: region.id });
                        }}
                    >
                        Удалить область
                    </button>
                </section>
            )}
        </div>
    );
}
