import { useEffect, useState } from 'react';
import { request } from '../../api/client';
import { AssetPicker } from '../../control/AssetLibrary';
import type { ImageAsset } from '../../tabletop/types/scene';
import type { ObjectPreset, PresetSettings } from '../../tabletop/objects/collider';
import { Dialog } from '../Dialog';
import { ColliderEditor } from './ColliderEditor';
import '../../../css/object-presets.css';

const endpoint = '/library/object-presets';
const categories = ['Природа', 'Мебель и декор', 'Освещение'];
const defaults: PresetSettings = {
    width: 120,
    height: 120,
    pivotX: 0.5,
    pivotY: 0.5,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    collider: { type: 'none', blocksMovement: true, blocksVision: false, blocksLight: false },
    tags: [],
};
type Draft = Omit<ObjectPreset, 'asset'> & { asset: ImageAsset | null };
const fields = [
    ['width', 'Ширина', 1, 8192],
    ['height', 'Высота', 1, 8192],
    ['pivotX', 'Pivot X', 0, 1],
    ['pivotY', 'Pivot Y', 0, 1],
    ['scaleX', 'Масштаб X', 0.001, 100],
    ['scaleY', 'Масштаб Y', 0.001, 100],
    ['rotation', 'Поворот, °', -360, 360],
] as const;

function PresetEditor({
    initial,
    busy,
    onSave,
    onCancel,
}: {
    initial: Draft;
    busy: boolean;
    onSave: (draft: Draft) => void;
    onCancel: () => void;
}) {
    const [draft, setDraft] = useState(initial);
    const [tags, setTags] = useState(initial.settings.tags.join(', '));
    const settings = draft.settings;
    const update = (patch: Partial<PresetSettings>) =>
        setDraft((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onSave({
                    ...draft,
                    settings: {
                        ...settings,
                        tags: [
                            ...new Set(
                                tags
                                    .split(',')
                                    .map((t) => t.trim())
                                    .filter(Boolean),
                            ),
                        ],
                    },
                });
            }}
        >
            <fieldset disabled={busy} className="object-preset-form">
                <div className="field-grid">
                    <label className="field">
                        Название
                        <input
                            required
                            maxLength={160}
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        />
                    </label>
                    <label className="field">
                        Категория
                        <input
                            required
                            maxLength={80}
                            value={draft.category}
                            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                        />
                    </label>
                </div>
                <AssetPicker
                    category="props"
                    personalOnly
                    value={draft.asset}
                    label="Изображение из Assets"
                    onChange={(asset) => {
                        const ratio = 120 / Math.max(asset.width, asset.height);
                        setDraft((d) => ({
                            ...d,
                            asset,
                            name: d.name || asset.name.slice(0, 160),
                            settings: d.asset
                                ? d.settings
                                : {
                                      ...d.settings,
                                      width: Math.max(1, Math.round(asset.width * ratio)),
                                      height: Math.max(1, Math.round(asset.height * ratio)),
                                  },
                        }));
                    }}
                />
                <div className="object-preset-numbers">
                    {fields.map(([key, label, min, max]) => (
                        <label className="field" key={key}>
                            {label}
                            <input
                                type="number"
                                step="any"
                                required
                                min={min}
                                max={max}
                                value={settings[key]}
                                onChange={(e) => update({ [key]: e.target.valueAsNumber || 0 })}
                            />
                        </label>
                    ))}
                </div>
                {draft.asset && (
                    <ColliderEditor
                        image={{
                            ...draft.asset,
                            width: Math.max(1, settings.width),
                            height: Math.max(1, settings.height),
                        }}
                        value={settings.collider}
                        pivot={{ x: settings.pivotX, y: settings.pivotY }}
                        onChange={(collider) => update({ collider })}
                    />
                )}
                <label className="field">
                    Игровые теги через запятую
                    <input maxLength={400} value={tags} onChange={(e) => setTags(e.target.value)} />
                </label>
                {settings.light && (
                    <p className="hint">Свет Fantasy Classic · радиус {settings.light.radius} wu</p>
                )}
                <div className="object-preset-actions">
                    <button className="primary-button" disabled={!draft.asset}>
                        Сохранить пресет
                    </button>
                    <button className="secondary-button" type="button" onClick={onCancel}>
                        К списку
                    </button>
                </div>
            </fieldset>
        </form>
    );
}

function PresetPicker({
    onClose,
    onPlace,
}: {
    onClose: () => void;
    onPlace?: (preset: ObjectPreset) => void;
}) {
    const [draft, setDraft] = useState<Draft | null>(null);
    const [search, setSearch] = useState('');
    const [source, setSource] = useState('');
    const [category, setCategory] = useState('');
    const [page, setPage] = useState(1);
    const [version, refresh] = useState(0);
    type Result = { presets: ObjectPreset[]; pages: number };
    const query = new URLSearchParams({ search, page: String(page), source, category }).toString();
    const [loaded, setLoaded] = useState<{ query: string; data: Result }>();
    const result = loaded?.query === query ? loaded.data : undefined;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [deleting, setDeleting] = useState<ObjectPreset | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        const timer = window.setTimeout(
            () => {
                void request<Result>(`${endpoint}?${query}`, 'GET', undefined, controller.signal)
                    .then((data) => {
                        if (page > data.pages) setPage(data.pages);
                        setLoaded({ query, data });
                    })
                    .catch((e: Error) => {
                        if (!controller.signal.aborted) setError(e.message);
                    });
            },
            search ? 140 : 0,
        );
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query, search, page, version]);
    const mutate = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        setError('');
        try {
            await fn();
            setDraft(null);
            setDeleting(null);
            refresh((n) => n + 1);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog
            title={draft ? 'Редактор пресета объекта' : 'Object Presets · Assets'}
            onClose={() => {
                if (!busy) onClose();
            }}
        >
            <div className="object-preset-dialog">
                {error && <p role="alert">{error}</p>}
                {draft ? (
                    <PresetEditor
                        initial={draft}
                        busy={busy}
                        onCancel={() => {
                            setError('');
                            setDraft(null);
                        }}
                        onSave={(value) =>
                            void mutate(() =>
                                request(
                                    value.id ? endpoint + '/' + value.id : endpoint,
                                    value.id ? 'PATCH' : 'POST',
                                    {
                                        name: value.name,
                                        category: value.category,
                                        assetId: value.asset!.id,
                                        settings: value.settings,
                                        clientMutationId: crypto.randomUUID(),
                                    },
                                ),
                            )
                        }
                    />
                ) : (
                    <>
                        <div className="object-preset-actions">
                            <input
                                autoFocus
                                aria-label="Поиск пресетов"
                                placeholder="Дуб, стол, фонарь…"
                                maxLength={120}
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setPage(1);
                                    setError('');
                                }}
                            />
                            <select
                                aria-label="Источник пресетов"
                                value={source}
                                onChange={(e) => {
                                    setSource(e.target.value);
                                    setCategory('');
                                    setPage(1);
                                    setError('');
                                }}
                            >
                                <option value="">Все пресеты</option>
                                <option value="builtin">Fantasy Classic</option>
                                <option value="personal">Мои пресеты</option>
                            </select>
                            <button
                                className="primary-button"
                                disabled={busy || !!deleting}
                                onClick={() =>
                                    setDraft({
                                        id: '',
                                        name: '',
                                        category: 'Окружение',
                                        asset: null,
                                        settings: defaults,
                                    })
                                }
                            >
                                Новый пресет
                            </button>
                        </div>
                        {source !== 'personal' && (
                            <div
                                className="object-preset-actions object-preset-filters"
                                aria-label="Категории пресетов"
                            >
                                {['', ...categories].map((value) => (
                                    <button
                                        type="button"
                                        key={value}
                                        aria-pressed={category === value}
                                        onClick={() => {
                                            setCategory(value);
                                            setPage(1);
                                            setError('');
                                        }}
                                    >
                                        {value || 'Все категории'}
                                    </button>
                                ))}
                            </div>
                        )}
                        {deleting && (
                            <div className="object-preset-actions" role="alert">
                                Удалить «{deleting.name}» из библиотеки? Размещённые экземпляры
                                сохранятся.
                                <button
                                    disabled={busy}
                                    onClick={() =>
                                        void mutate(() =>
                                            request(endpoint + '/' + deleting.id, 'DELETE'),
                                        )
                                    }
                                >
                                    Удалить пресет
                                </button>
                                <button disabled={busy} onClick={() => setDeleting(null)}>
                                    Отмена
                                </button>
                            </div>
                        )}
                        {result ? (
                            <div className="object-preset-grid">
                                {result.presets.map((preset) => (
                                    <article key={preset.id} className="surface">
                                        <img
                                            src={preset.thumbnailUrl ?? preset.asset.url}
                                            alt=""
                                            loading="lazy"
                                        />
                                        <strong>{preset.name}</strong>
                                        <small>
                                            {preset.category} ·{' '}
                                            {Math.round(
                                                preset.settings.width * preset.settings.scaleX,
                                            )}{' '}
                                            ×{' '}
                                            {Math.round(
                                                preset.settings.height * preset.settings.scaleY,
                                            )}{' '}
                                            wu
                                        </small>
                                        <small className="object-preset-details">
                                            {preset.builtin ? 'Fantasy Classic' : 'Личный'}
                                            {preset.settings.collider.type !== 'none' &&
                                                preset.settings.collider.blocksMovement &&
                                                ' · препятствие'}
                                            {preset.settings.light &&
                                                ` · свет ${preset.settings.light.radius} wu`}
                                        </small>
                                        <div className="object-preset-actions">
                                            {onPlace && (
                                                <button
                                                    className="primary-button"
                                                    disabled={busy || !!deleting}
                                                    onClick={() => {
                                                        onClose();
                                                        onPlace(preset);
                                                    }}
                                                >
                                                    Разместить
                                                </button>
                                            )}
                                            {!preset.builtin && (
                                                <button
                                                    disabled={busy || !!deleting}
                                                    onClick={() => setDraft(preset)}
                                                >
                                                    Правка
                                                </button>
                                            )}
                                            <button
                                                disabled={busy || !!deleting}
                                                onClick={() =>
                                                    void mutate(async () => {
                                                        await request(
                                                            endpoint +
                                                                '/' +
                                                                preset.id +
                                                                '/duplicate',
                                                            'POST',
                                                            {
                                                                clientMutationId:
                                                                    crypto.randomUUID(),
                                                            },
                                                        );
                                                        if (preset.builtin) {
                                                            setSource('personal');
                                                            setCategory('');
                                                            setSearch('');
                                                            setPage(1);
                                                        }
                                                    })
                                                }
                                            >
                                                Копия
                                            </button>
                                            {!preset.builtin && (
                                                <button
                                                    disabled={busy || !!deleting}
                                                    onClick={() => setDeleting(preset)}
                                                >
                                                    Удалить
                                                </button>
                                            )}
                                        </div>
                                    </article>
                                ))}
                                {!result.presets.length && (
                                    <p className="hint">Пресеты не найдены.</p>
                                )}
                            </div>
                        ) : (
                            <p role="status">Загрузка…</p>
                        )}
                        {result && result.pages > 1 && (
                            <div className="object-preset-actions">
                                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                                    Назад
                                </button>
                                <small>
                                    {page} / {result.pages}
                                </small>
                                <button
                                    disabled={page >= result.pages}
                                    onClick={() => setPage((p) => p + 1)}
                                >
                                    Далее
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </Dialog>
    );
}

export function ObjectPresetLibrary({ onPlace }: { onPlace?: (preset: ObjectPreset) => void }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button
                type="button"
                className={onPlace ? 'primary-button' : 'secondary-button'}
                onClick={() => setOpen(true)}
            >
                Object Presets
            </button>
            {open && <PresetPicker onClose={() => setOpen(false)} onPlace={onPlace} />}
        </>
    );
}
