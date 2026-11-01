import { useState, type FormEvent } from 'react';
import { commandId } from '../../api/workspace';
import { request } from '../../api/client';
import type { LibraryAsset } from '../../api/preparation';
import type { Scene } from '../../tabletop/types/scene';
import { AssetPicker } from '../../control/AssetLibrary';
import { Dialog } from '../Dialog';

export function SceneSettings({
    campaignId,
    scene,
    onClose,
    onSaved,
}: {
    campaignId: string;
    scene?: Scene;
    onClose: () => void;
    onSaved: (id: string) => void;
}) {
    const [name, setName] = useState(scene?.name ?? '');
    const [width, setWidth] = useState(scene?.width ?? 1440);
    const [height, setHeight] = useState(scene?.height ?? 1080);
    const [grid, setGrid] = useState(
        scene?.grid ?? {
            size: 60,
            offset: { x: 0, y: 0 },
            visible: true,
            snap: true,
            distancePerCell: 5,
            distanceUnit: 'ft' as const,
        },
    );
    const [asset, setAsset] = useState<LibraryAsset | null>();
    const [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const save = async (event: FormEvent) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            const result = await request<{ id: string }>(
                `/campaigns/${campaignId}/scene-preparation`,
                'POST',
                {
                    sceneId: scene?.id,
                    name: name.trim(),
                    width,
                    height,
                    grid,
                    ...(asset !== undefined
                        ? {
                              map: asset
                                  ? {
                                        assetId: asset.id,
                                        x: 0,
                                        y: 0,
                                        width: Math.min(20000, asset.width),
                                        height: Math.min(20000, asset.height),
                                    }
                                  : null,
                          }
                        : {}),
                    clientMutationId: commandId(),
                },
            );
            onSaved(result.id);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog
            title={scene ? 'Параметры сцены' : 'Создать сцену'}
            onClose={() => !busy && onClose()}
        >
            <form onSubmit={(e) => void save(e)} className="campaign-scene-settings">
                <fieldset disabled={busy}>
                    <label className="field">
                        <span>Название сцены</span>
                        <input
                            required
                            maxLength={120}
                            value={name}
                            autoFocus
                            onChange={(e) => setName(e.target.value)}
                        />
                    </label>
                    <p className="hint">
                        Карта используется из глобальной Asset Library. Токены и объекты добавляются
                        на игровом столе.
                    </p>
                    <AssetPicker
                        category="maps"
                        label="Выбрать карту / фон"
                        value={asset === undefined ? scene?.map?.asset : asset}
                        onChange={(a) => {
                            setAsset(a);
                            if (!name.trim()) setName(a.name.slice(0, 120));
                            if (!scene) {
                                setWidth(Math.max(120, Math.min(20000, a.width)));
                                setHeight(Math.max(120, Math.min(20000, a.height)));
                            }
                        }}
                    />
                    {(asset || (asset === undefined && scene?.map)) && (
                        <button
                            type="button"
                            className="quiet-button"
                            onClick={() => setAsset(null)}
                        >
                            Убрать карту
                        </button>
                    )}
                    <div className="gameplay-form-row">
                        <label className="field">
                            <span>Ширина сцены, px</span>
                            <input
                                type="number"
                                required
                                min={120}
                                max={20000}
                                value={width}
                                onChange={(e) => setWidth(Number(e.target.value))}
                            />
                        </label>
                        <label className="field">
                            <span>Высота сцены, px</span>
                            <input
                                type="number"
                                required
                                min={120}
                                max={20000}
                                value={height}
                                onChange={(e) => setHeight(Number(e.target.value))}
                            />
                        </label>
                    </div>
                    <div className="gameplay-form-row">
                        <label className="field">
                            <span>Клетка, px</span>
                            <input
                                type="number"
                                required
                                min={20}
                                max={160}
                                step="any"
                                value={grid.size}
                                onChange={(e) => setGrid({ ...grid, size: Number(e.target.value) })}
                            />
                        </label>
                        <label className="field">
                            <span>Расстояние / клетка</span>
                            <input
                                type="number"
                                required
                                min={0.1}
                                max={1000}
                                step="any"
                                value={grid.distancePerCell ?? 5}
                                onChange={(e) =>
                                    setGrid({ ...grid, distancePerCell: Number(e.target.value) })
                                }
                            />
                        </label>
                        <label className="field">
                            <span>Единицы</span>
                            <select
                                value={grid.distanceUnit ?? 'ft'}
                                onChange={(e) =>
                                    setGrid({
                                        ...grid,
                                        distanceUnit: e.target.value as 'ft' | 'm' | 'squares',
                                    })
                                }
                            >
                                <option value="ft">ft</option>
                                <option value="m">m</option>
                                <option value="squares">Клетки</option>
                            </select>
                        </label>
                    </div>
                    <div className="button-row">
                        <label>
                            <input
                                type="checkbox"
                                checked={grid.visible}
                                onChange={(e) => setGrid({ ...grid, visible: e.target.checked })}
                            />{' '}
                            Показывать сетку
                        </label>
                        <label>
                            <input
                                type="checkbox"
                                checked={grid.snap}
                                onChange={(e) => setGrid({ ...grid, snap: e.target.checked })}
                            />{' '}
                            Привязка к сетке
                        </label>
                    </div>
                </fieldset>
                {error && (
                    <p className="form-error" role="alert">
                        {error}
                    </p>
                )}
                <div className="dialog-actions">
                    <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={onClose}
                    >
                        Закрыть
                    </button>
                    <button className="primary-button" disabled={busy || !name.trim()}>
                        {busy
                            ? 'Сохраняем…'
                            : scene
                              ? 'Сохранить'
                              : 'Создать и открыть для подготовки'}
                    </button>
                </div>
            </form>
        </Dialog>
    );
}
