import type { RollMode } from '../workspace/interactions/actingToken';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Grip, Plus, Settings2, X } from 'lucide-react';
import type { Ability, CharacterResource } from './model';
import { canAfford } from './model';
import { gameplayIcon } from './icons';
import { placeAbility, type HotbarSlots } from './hotbarModel';

const filters = {
    all: 'Все',
    attack: 'Атаки',
    spell: 'Заклинания',
    utility: 'Действия',
    other: 'Прочее',
};
export function AbilityHotbar({
    abilities,
    resources,
    slots,
    onLayout,
    onChoose,
    selected,
    disabled,
    editable,
    saving,
    error,
    onRetry,
    openRequest = 0,
    rollMode,
    onRollMode,
    worldAvailable,
}: {
    abilities: Ability[];
    resources: CharacterResource[];
    slots: HotbarSlots;
    onLayout: (slots: HotbarSlots) => void;
    onChoose: (ability: Ability) => void;
    selected?: string;
    disabled: boolean;
    editable: boolean;
    saving: boolean;
    error: string;
    onRetry: () => void;
    openRequest?: number;
    rollMode: RollMode;
    onRollMode: (mode: RollMode) => void;
    worldAvailable: boolean;
}) {
    const [browser, setBrowser] = useState(false),
        [filter, setFilter] = useState<keyof typeof filters>('all'),
        [edit, setEdit] = useState(false),
        [destination, setDestination] = useState<number | null>(null);
    const [nativeDrag, setNativeDrag] = useState<string | null>(null);
    const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null),
        [over, setOver] = useState<number | null>(null);
    const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
        touchDrag = useRef<string | null>(null),
        suppressClick = useRef(false);
    const callbacks = useRef({ onLayout, slots });
    useEffect(() => {
        callbacks.current = { onLayout, slots };
    });
    useEffect(() => {
        if (openRequest)
            queueMicrotask(() => {
                setFilter('spell');
                setBrowser(true);
            });
    }, [openRequest]);
    useEffect(() => () => clearTimeout(hold.current), []);
    const assign = (id: string, index: number) => onLayout(placeAbility(slots, id, index));
    const touch = (id: string) => ({
        onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
            if (e.pointerType !== 'touch' || !editable) return;
            const button = e.currentTarget,
                x = e.clientX,
                y = e.clientY;
            suppressClick.current = false;
            hold.current = setTimeout(() => {
                touchDrag.current = id;
                setGhost({ id, x, y });
                button.setPointerCapture(e.pointerId);
            }, 230);
        },
        onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
            if (!touchDrag.current) return;
            e.preventDefault();
            setGhost({ id, x: e.clientX, y: e.clientY });
            const hit = document
                .elementFromPoint(e.clientX, e.clientY)
                ?.closest<HTMLElement>('[data-hotbar-slot]');
            setOver(hit ? Number(hit.dataset.hotbarSlot) : null);
        },
        onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
            clearTimeout(hold.current);
            if (!touchDrag.current) return;
            e.preventDefault();
            suppressClick.current = true;
            const hit = document
                .elementFromPoint(e.clientX, e.clientY)
                ?.closest<HTMLElement>('[data-hotbar-slot]');
            if (hit)
                callbacks.current.onLayout(
                    placeAbility(
                        callbacks.current.slots,
                        touchDrag.current,
                        Number(hit.dataset.hotbarSlot),
                    ),
                );
            touchDrag.current = null;
            setGhost(null);
            setOver(null);
        },
        onPointerCancel: () => {
            clearTimeout(hold.current);
            touchDrag.current = null;
            setGhost(null);
            setOver(null);
        },
    });
    const execute = (a: Ability) => {
        if (suppressClick.current) {
            suppressClick.current = false;
            return;
        }
        setBrowser(false);
        onChoose(a);
    };
    const cost = (a: Ability) => (
        <span className="slot-cost">
            {a.costs.map((c) => {
                const r = resources.find((r) => r.key === c.key),
                    Icon = gameplayIcon(r?.icon ?? 'spark');
                return (
                    <span key={c.key} className={`accent-${r?.accent ?? 'violet'}`}>
                        <Icon size={10} />
                        {c.amount}
                    </span>
                );
            })}
        </span>
    );
    const shown = abilities.filter((a) =>
        filter === 'all' || filter === 'spell'
            ? filter === 'all' || a.attack_type === 'spell'
            : filter === 'attack'
              ? a.category === 'attack' && a.attack_type !== 'spell'
              : filter === 'utility'
                ? a.category === 'utility' || a.category === 'effect'
                : a.category === 'check',
    );
    return (
        <>
            {browser && (
                <section className="ability-browser" aria-label="Браузер способностей">
                    <header>
                        <div>
                            <span className="eyebrow">АРСЕНАЛ ПЕРСОНАЖА</span>
                            <h3>Способности</h3>
                        </div>
                        <button
                            className="icon-button"
                            aria-label="Закрыть браузер способностей"
                            onClick={() => {
                                setBrowser(false);
                                setDestination(null);
                            }}
                        >
                            <X size={17} />
                        </button>
                    </header>
                    <div className="ability-filters">
                        {Object.entries(filters).map(([k, label]) => (
                            <button
                                key={k}
                                aria-pressed={filter === k}
                                onClick={() => setFilter(k as keyof typeof filters)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <p>
                        {destination !== null
                            ? `Выберите способность для ячейки ${destination + 1}`
                            : 'Перетащите в ячейку. Нажмите, чтобы применить.'}
                    </p>
                    <div className="ability-browser-grid">
                        {shown.map((a) => {
                            const Icon = gameplayIcon(a.icon);
                            return (
                                <button
                                    key={a.id}
                                    onContextMenu={(e) => e.preventDefault()}
                                    onDragEnd={() => {
                                        setNativeDrag(null);
                                        setOver(null);
                                    }}
                                    draggable={editable}
                                    {...touch(a.id)}
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('application/ytt-ability', a.id);
                                        e.dataTransfer.effectAllowed = 'copyMove';
                                        setNativeDrag(a.id);
                                    }}
                                    onClick={() => {
                                        if (destination !== null) {
                                            assign(a.id, destination);
                                            setDestination(null);
                                        } else execute(a);
                                    }}
                                    aria-label={`Способность: ${a.name}`}
                                >
                                    <Icon size={24} />
                                    <strong>{a.name}</strong>
                                    <small>{a.description}</small>
                                    {cost(a)}
                                    <span className="browser-drag-hint">
                                        <Grip size={12} /> В панель
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    {!shown.length && <p>В этой категории пока нет способностей.</p>}
                </section>
            )}
            <div className="hotbar-shell">
                <header>
                    <button
                        className="hotbar-browser-button"
                        aria-expanded={browser}
                        onClick={() => setBrowser(!browser)}
                    >
                        <BookOpen size={14} /> Способности
                    </button>
                    <div className="hotbar-roll-stance" role="group" aria-label="Режим броска">
                        {(['normal', 'advantage', 'disadvantage'] as const).map((mode, i) => (
                            <button
                                key={mode}
                                aria-pressed={rollMode === mode}
                                title={['Обычный бросок', 'С преимуществом', 'С помехой'][i]}
                                aria-label={['Обычный бросок', 'С преимуществом', 'С помехой'][i]}
                                onClick={() => onRollMode(mode)}
                            >
                                {['•', '+', '−'][i]}
                            </button>
                        ))}
                    </div>
                    <small aria-live="polite">
                        {saving
                            ? 'Сохраняем раскладку…'
                            : edit
                              ? 'Перетащите · Delete убирает слот'
                              : '1–8 · выбор действия'}
                    </small>
                    <button
                        className="icon-button"
                        aria-label="Настроить панель способностей"
                        aria-pressed={edit}
                        disabled={!editable}
                        onClick={() => setEdit(!edit)}
                    >
                        <Settings2 size={14} />
                    </button>
                </header>
                <div className="rpg-hotbar" role="toolbar" aria-label="Способности персонажа">
                    {slots.map((id, index) => {
                        const a = abilities.find((a) => a.id === id),
                            Icon = gameplayIcon(a?.icon ?? 'spark');
                        return (
                            <div
                                className={`rpg-slot ${over === index ? 'is-drop-target' : ''} ${ghost?.id === id || nativeDrag === id ? 'is-lifted' : ''}`}
                                data-hotbar-slot={index}
                                key={index}
                                onDragOver={(e) => {
                                    if (editable) {
                                        e.preventDefault();
                                        setOver(index);
                                    }
                                }}
                                onDragLeave={() => setOver(null)}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    const id = e.dataTransfer.getData('application/ytt-ability');
                                    if (abilities.some((a) => a.id === id)) assign(id, index);
                                    setOver(null);
                                }}
                            >
                                <button
                                    aria-label={a?.name ?? `Пустая ячейка ${index + 1}`}
                                    aria-pressed={!!a && selected === a.id}
                                    disabled={
                                        !!a &&
                                        (disabled ||
                                            (!edit && !canAfford(a, resources)) ||
                                            (!worldAvailable &&
                                                ['token', 'prop', 'point'].includes(a.target)))
                                    }
                                    onContextMenu={(e) => e.preventDefault()}
                                    onDragEnd={() => {
                                        setNativeDrag(null);
                                        setOver(null);
                                    }}
                                    draggable={!!a && editable}
                                    {...(a ? touch(a.id) : {})}
                                    onDragStart={(e) => {
                                        if (a) {
                                            e.dataTransfer.setData('application/ytt-ability', a.id);
                                            e.dataTransfer.effectAllowed = 'move';
                                            setNativeDrag(a.id);
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (a && (e.key === 'Delete' || e.key === 'Backspace')) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onLayout(slots.map((v, i) => (i === index ? null : v)));
                                        }
                                    }}
                                    onClick={() => {
                                        if (a && !edit) execute(a);
                                        else {
                                            setDestination(index);
                                            setBrowser(true);
                                        }
                                    }}
                                >
                                    <span className="slot-key">{index < 8 ? index + 1 : '·'}</span>
                                    {a ? (
                                        <>
                                            <Icon size={25} strokeWidth={1.55} />
                                            {cost(a)}
                                        </>
                                    ) : (
                                        <Plus size={14} />
                                    )}
                                </button>
                                {edit && a && (
                                    <button
                                        className="slot-remove"
                                        aria-label={`Убрать ${a.name} из панели`}
                                        onClick={() =>
                                            onLayout(slots.map((v, i) => (i === index ? null : v)))
                                        }
                                    >
                                        <X size={10} />
                                    </button>
                                )}
                                {a && (
                                    <div className="rpg-slot-tooltip" role="tooltip">
                                        <strong>{a.name}</strong>
                                        <span>{a.description}</span>
                                        <small>
                                            {a.range
                                                ? `${a.range.normal}${a.range.long ? ` / ${a.range.long}` : ''} · дальность`
                                                : 'Без ограничения дальности'}
                                            {a.area && a.area.shape !== 'none'
                                                ? ` · ${a.area.shape} ${a.area.size}`
                                                : ''}
                                        </small>
                                        {cost(a)}
                                        {!canAfford(a, resources) && <em>Недостаточно ресурса</em>}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
            {error && (
                <div className="hotbar-save-error" role="alert">
                    Раскладка не подтверждена: {error}
                    <button onClick={onRetry}>Повторить</button>
                </div>
            )}
            {ghost &&
                createPortal(
                    <div
                        className="hotbar-drag-ghost"
                        style={{ left: ghost.x + 12, top: ghost.y - 52 }}
                    >
                        {(() => {
                            const Icon = gameplayIcon(
                                abilities.find((a) => a.id === ghost.id)?.icon ?? 'spark',
                            );
                            return <Icon size={29} />;
                        })()}
                    </div>,
                    document.body,
                )}
        </>
    );
}
