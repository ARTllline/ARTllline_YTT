import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { MaterialPreview } from './MaterialLibrary';
import { materials, type Material } from './materials';
import type { Surface } from '../../tabletop/structure/model';
import { useEditorPopover } from './EditorOptions';

type BuildSurface = Exclude<Material['type'], 'terrain'>;

export type BuildMaterialHistory = {
    recent: Record<BuildSurface, Material[]>;
    remember: (material: Material) => void;
};

export function useBuildMaterialHistory(): BuildMaterialHistory {
    const [recent, setRecent] = useState<BuildMaterialHistory['recent']>({
        wall: [],
        floor: [],
        door: [],
        window: [],
    });
    return {
        recent,
        remember: (material) => {
            const { type } = material;
            if (type === 'terrain') return;
            setRecent((current) => ({
                ...current,
                [type]: [
                    material,
                    ...current[type].filter((m) => m.versionId !== material.versionId),
                ].slice(0, 4),
            }));
        },
    };
}

export function BuildMaterialPicker({
    type,
    value,
    surfaces,
    onChange,
    recent,
    remember,
}: {
    type: BuildSurface;
    value: string | null | undefined;
    surfaces?: Surface[];
    onChange: (id: string | null) => void;
} & BuildMaterialHistory) {
    const label = {
        wall: 'Материал стены',
        floor: 'Материал пола',
        door: 'Стиль двери',
        window: 'Стиль окна',
    }[type];
    const fallback = {
        wall: 'Нейтральная кладка',
        floor: 'Без пола',
        door: 'Обычная дверь',
        window: 'Обычное окно',
    }[type];
    const id = useId();
    const root = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [result, setResult] = useState<{ materials: Material[]; pages: number }>();
    const [error, setError] = useState('');
    useEditorPopover(open, root, setOpen);
    const selected =
        recent[type].find((m) => m.versionId === value) ??
        surfaces?.find((m) => m.versionId === value);
    useEffect(() => {
        if (open) input.current?.focus();
    }, [open]);
    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            void materials
                .list(search, type, page, controller.signal)
                .then((data) => {
                    if (!controller.signal.aborted) setResult(data);
                })
                .catch((e: Error) => {
                    if (!controller.signal.aborted) setError(e.message);
                });
        }, 150);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [open, search, type, page]);

    const reset = () => {
        setResult(undefined);
        setError('');
    };
    const choose = (material: Material | null) => {
        if (material) remember(material);
        onChange(material?.versionId ?? null);
        setOpen(false);
        button.current?.focus();
    };
    const tile = (m: Material) => (
        <button
            type="button"
            key={m.versionId}
            className="build-material-tile"
            title={m.name}
            aria-label={m.name}
            aria-pressed={m.versionId === value}
            onClick={() => choose(m)}
        >
            <MaterialPreview material={m} />
            <span>{m.displayName ?? m.name}</span>
        </button>
    );
    return (
        <div
            ref={root}
            className="build-picker"
            onKeyDown={(e) => {
                if (!open) return;
                if (e.key === 'Escape') {
                    e.preventDefault();
                    setOpen(false);
                    button.current?.focus();
                }
                e.stopPropagation();
            }}
        >
            <button
                ref={button}
                className="build-material-trigger"
                type="button"
                aria-label={label}
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                onClick={() => {
                    if (!open) {
                        reset();
                        setSearch('');
                        setPage(1);
                    }
                    setOpen(!open);
                }}
            >
                {selected ? (
                    <MaterialPreview material={selected} />
                ) : (
                    <span className={`build-swatch ${type}`} />
                )}
                <span>
                    <small>{label}</small>
                    <strong>
                        {selected?.displayName ??
                            selected?.name ??
                            (value === undefined
                                ? 'Разные материалы'
                                : value
                                  ? `Версия #${value}`
                                  : fallback)}
                    </strong>
                </span>
                <ChevronDown size={13} />
            </button>
            {open && (
                <div
                    id={id}
                    className="build-material-popover surface"
                    role="region"
                    aria-label={label}
                >
                    <label className="build-material-search">
                        <Search size={15} />
                        <input
                            ref={input}
                            type="search"
                            aria-label={`Поиск · ${label}`}
                            placeholder="Поиск в библиотеке"
                            value={search}
                            onChange={(e) => {
                                reset();
                                setSearch(e.target.value);
                                setPage(1);
                            }}
                        />
                    </label>
                    {!search && recent[type].length > 0 && (
                        <>
                            <small>Недавние</small>
                            <div className="build-material-grid">{recent[type].map(tile)}</div>
                        </>
                    )}
                    <small>Библиотека материалов</small>
                    <div className="build-material-grid">
                        <button
                            type="button"
                            className="build-material-tile"
                            aria-pressed={!value}
                            onClick={() => choose(null)}
                        >
                            <span className={`build-swatch ${type}`} />
                            <span>{fallback}</span>
                        </button>
                        {result?.materials.map(tile)}
                    </div>
                    {error ? (
                        <small role="alert">{error}</small>
                    ) : !result ? (
                        <small role="status">Загружаем материалы…</small>
                    ) : !result.materials.length ? (
                        <small>Материалы не найдены</small>
                    ) : null}
                    {(result?.pages ?? 0) > 1 && (
                        <div className="build-material-pages">
                            <button
                                type="button"
                                aria-label="Предыдущая страница"
                                disabled={page <= 1}
                                onClick={() => {
                                    reset();
                                    setPage(page - 1);
                                }}
                            >
                                <ChevronLeft size={15} />
                            </button>
                            <small>
                                {page} / {result!.pages}
                            </small>
                            <button
                                type="button"
                                aria-label="Следующая страница"
                                disabled={page >= result!.pages}
                                onClick={() => {
                                    reset();
                                    setPage(page + 1);
                                }}
                            >
                                <ChevronRight size={15} />
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
