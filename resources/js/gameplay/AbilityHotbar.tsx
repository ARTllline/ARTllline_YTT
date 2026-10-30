import type { RollMode } from '../workspace/interactions/actingToken';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ChevronsDown, ChevronsUp, Settings2, Backpack, UserRound } from 'lucide-react';
import type { InventoryItem } from '../rpg/model';
import type { RpgWindowKind } from '../rpg/RpgWindow';
import type { Ability, CharacterResource } from './model';
import { canAfford } from './model';
import { RpgIcon } from './RpgIcon';
import { ResourceRail } from './ResourceRail';
import { PAGE_SIZE, canBindInventoryItem, type HotbarSlots } from './hotbarModel';
import { GAMEPLAY_ENTRY_MIME } from './gameplayDrag';
import { useGameplayDrag } from './useGameplayDrag';
import { DeckSlot } from './DeckSlot';
import { CombatBudgetView, combatReason, type TurnResources } from './combat';
import { deckBanks } from './deckPresentation';
import { AbilityBrowser } from './AbilityBrowser';

function readView(key: string): { page: number; expanded: boolean } {
    try {
        const v = JSON.parse(localStorage.getItem(key) ?? '{}');
        return { page: v.page === 1 ? 1 : 0, expanded: v.expanded === true };
    } catch {
        return { page: 0, expanded: false };
    }
}
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
    onResourceDetails,
    preferencesKey,
    items = [],
    itemAbilities = [],
    onChooseItem,
    onOpenWindow,
    openWindow,
    combatBudget,
    onStand,
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
    onResourceDetails: () => void;
    preferencesKey: string;
    items?: InventoryItem[];
    itemAbilities?: Ability[];
    onChooseItem?: (i: InventoryItem) => void;
    onOpenWindow?: (kind: RpgWindowKind) => void;
    openWindow?: RpgWindowKind | null;
    combatBudget?: TurnResources;
    onStand?: () => void;
}) {
    const [view, setView] = useState(() => readView(preferencesKey));
    const [browser, setBrowser] = useState(false),
        [edit, setEdit] = useState(false);
    const [destination, setDestination] = useState<number | null>(null);
    const [initialFilter, setInitialFilter] = useState<'spell' | undefined>();
    const belt = useRef<HTMLDivElement>(null);
    const actionSpace = useRef<HTMLDivElement>(null);
    const previousHeight = useRef(0);
    useLayoutEffect(() => {
        const node = actionSpace.current!;
        const height = node.offsetHeight;
        const animation =
            previousHeight.current && !matchMedia('(prefers-reduced-motion: reduce)').matches
                ? node.animate(
                      [
                          { height: `${previousHeight.current}px`, overflow: 'clip' },
                          { height: `${height}px`, overflow: 'clip' },
                      ],
                      { duration: 170, easing: 'ease-out' },
                  )
                : null;
        previousHeight.current = height;
        return () => animation?.cancel();
    }, [view.expanded]);
    const drag = useGameplayDrag(slots, onLayout, editable, (binding) =>
        binding.sourceType === 'ability'
            ? abilities.some((a) => a.id === binding.sourceId && !a.item_only)
            : items.some((i) => i.id === binding.sourceId && canBindInventoryItem(i)),
    );
    useEffect(() => {
        try {
            localStorage.setItem(preferencesKey, JSON.stringify(view));
        } catch {
            /* Optional view preference. */
        }
    }, [view, preferencesKey]);
    useEffect(() => {
        if (openRequest)
            queueMicrotask(() => {
                setInitialFilter('spell');
                setBrowser(true);
            });
    }, [openRequest]);
    const page = (value: number) => {
        setView((v) => ({ ...v, page: value }));
        belt.current?.scrollTo({ left: 0 });
    };
    const toggleExpanded = () => {
        previousHeight.current = actionSpace.current?.offsetHeight ?? 0;
        setView((v) => ({ ...v, expanded: !v.expanded }));
    };
    const choose = (a: Ability) => {
        setBrowser(false);
        onChoose(a);
    };
    const shortcut = useRef<(index: number) => void>(() => {});
    useEffect(() => {
        shortcut.current = (index) => {
            if (edit || browser || disabled || document.querySelector('.rpg-window')) return;
            const binding = slots[view.page * PAGE_SIZE + index];
            if (binding?.sourceType === 'inventory_item') {
                const i = items.find((i) => i.id === binding.sourceId);
                if (i && i.quantity > 0) onChooseItem?.(i);
                return;
            }
            const a = abilities.find(
                (a) => binding?.sourceType === 'ability' && a.id === binding.sourceId,
            );
            if (
                a &&
                !combatReason(a, combatBudget) &&
                canAfford(a, resources) &&
                (worldAvailable || !['token', 'prop', 'point'].includes(a.target))
            )
                choose(a);
        };
    });
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (
                e.ctrlKey ||
                e.metaKey ||
                e.altKey ||
                e.repeat ||
                e.isComposing ||
                !/^Digit[1-8]$/.test(e.code) ||
                document.querySelector('dialog[open]') ||
                (e.target instanceof HTMLElement &&
                    e.target.closest('input,textarea,select,[contenteditable="true"]'))
            )
                return;
            e.preventDefault();
            shortcut.current(Number(e.code.slice(-1)) - 1 + (e.shiftKey ? 8 : 0));
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, []);
    return (
        <>
            {browser && (
                <AbilityBrowser
                    key={initialFilter ?? 'all'}
                    abilities={abilities}
                    resources={resources}
                    drag={drag}
                    destination={destination}
                    initialFilter={initialFilter}
                    onClose={() => {
                        setBrowser(false);
                        setDestination(null);
                    }}
                    onSelect={(a) => {
                        if (destination !== null) {
                            drag.assign({ sourceType: 'ability', sourceId: a.id }, destination);
                            setDestination(null);
                        } else choose(a);
                    }}
                />
            )}
            <section
                className={`hotbar-shell action-deck ${view.expanded ? 'is-expanded' : ''} ${edit ? 'is-editing' : ''}`}
                aria-label="Панель действий"
            >
                {combatBudget && <CombatBudgetView budget={combatBudget} onStand={onStand} />}
                <div className="deck-upper-strip">
                    <ResourceRail resources={resources} onDetails={onResourceDetails} />
                    <div className="deck-tools">
                        <div className="hotbar-roll-stance" role="group" aria-label="Режим броска">
                            {(['normal', 'advantage', 'disadvantage'] as const).map((mode, i) => (
                                <button
                                    key={mode}
                                    aria-pressed={rollMode === mode}
                                    title={['Обычный бросок', 'С преимуществом', 'С помехой'][i]}
                                    aria-label={
                                        ['Обычный бросок', 'С преимуществом', 'С помехой'][i]
                                    }
                                    onClick={() => onRollMode(mode)}
                                >
                                    {['•', '+', '−'][i]}
                                </button>
                            ))}
                        </div>
                        <button
                            className="deck-edit icon-button"
                            aria-label="Настроить панель способностей"
                            aria-pressed={edit}
                            disabled={!editable}
                            onClick={() => setEdit(!edit)}
                        >
                            <Settings2 size={17} />
                        </button>
                        <button
                            className="deck-expand icon-button"
                            aria-label={
                                view.expanded
                                    ? 'Свернуть панель действий'
                                    : 'Развернуть все 32 ячейки'
                            }
                            aria-expanded={view.expanded}
                            onClick={toggleExpanded}
                        >
                            {view.expanded ? <ChevronsDown size={18} /> : <ChevronsUp size={18} />}
                        </button>
                    </div>
                </div>
                <div className="deck-action-space" ref={actionSpace}>
                    <div className="deck-heading">
                        <span>
                            {view.expanded
                                ? 'ПОЛНАЯ ПАНЕЛЬ'
                                : view.page === 0
                                  ? 'ОСНОВНОЕ'
                                  : 'РЕЗЕРВ'}
                            <i aria-hidden="true">✦</i>
                        </span>
                        <small aria-live="polite">
                            {saving
                                ? 'Сохраняем…'
                                : !editable
                                  ? 'Загрузка раскладки…'
                                  : edit
                                    ? 'Перетащите · × убрать слот'
                                    : '1–8 · Shift + 1–8'}
                        </small>
                    </div>
                    <div
                        className="rpg-hotbar"
                        role="toolbar"
                        aria-label="Способности персонажа"
                        ref={belt}
                        key={view.page}
                    >
                        {deckBanks(view.page, view.expanded).map((bank) => (
                            <div
                                className="deck-bank"
                                key={bank.key}
                                role="group"
                                aria-label={bank.label}
                            >
                                <span className="deck-bank-seal" aria-hidden="true">
                                    {bank.label}
                                </span>
                                <div className="deck-bank-slots">
                                    {bank.indices.map((index) => {
                                        const binding = slots[index];
                                        return (
                                            <DeckSlot
                                                combatBudget={combatBudget}
                                                key={index}
                                                index={index}
                                                shortcutActive={
                                                    Math.floor(index / PAGE_SIZE) === view.page
                                                }
                                                ability={abilities.find(
                                                    (a) =>
                                                        binding?.sourceType === 'ability' &&
                                                        a.id === binding.sourceId,
                                                )}
                                                binding={binding}
                                                item={
                                                    binding?.sourceType === 'inventory_item'
                                                        ? items.find(
                                                              (i) => i.id === binding.sourceId,
                                                          )
                                                        : undefined
                                                }
                                                itemAbility={
                                                    binding?.sourceType === 'inventory_item'
                                                        ? (items.find(
                                                              (i) => i.id === binding.sourceId,
                                                          )?.action?.ability ??
                                                          itemAbilities.find(
                                                              (a) =>
                                                                  a.id ===
                                                                  items.find(
                                                                      (i) =>
                                                                          i.id === binding.sourceId,
                                                                  )?.definition.use_ability_id,
                                                          ))
                                                        : undefined
                                                }
                                                onChooseItem={onChooseItem}
                                                resources={resources}
                                                drag={drag}
                                                edit={edit}
                                                selected={selected}
                                                disabled={disabled}
                                                worldAvailable={worldAvailable}
                                                onClear={() => {
                                                    if (editable)
                                                        onLayout(
                                                            slots.map((s, i) =>
                                                                i === index ? null : s,
                                                            ),
                                                        );
                                                }}
                                                onPick={() => {
                                                    setDestination(index);
                                                    setInitialFilter(undefined);
                                                    setBrowser(true);
                                                }}
                                                onChoose={choose}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <footer className="deck-navigation">
                    <div className="deck-pages" role="group" aria-label="Страницы действий">
                        {['Основное', 'Резерв'].map((label, i) => (
                            <button
                                key={i}
                                aria-pressed={view.page === i}
                                onClick={() => page(i)}
                                onDragEnter={(e) => {
                                    if (
                                        !view.expanded &&
                                        e.dataTransfer.types.includes(GAMEPLAY_ENTRY_MIME)
                                    )
                                        page(i);
                                }}
                            >
                                <span className="deck-tab-mark" aria-hidden="true">
                                    {i === 0 ? 'I' : 'II'}
                                </span>
                                {label}{' '}
                                <small>
                                    {i * 16 + 1}–{(i + 1) * 16}
                                </small>
                            </button>
                        ))}
                    </div>
                    <button
                        className="hotbar-browser-button"
                        aria-label="Способности"
                        aria-pressed={openWindow === 'spellbook'}
                        aria-expanded={onOpenWindow ? openWindow === 'spellbook' : browser}
                        onClick={() => {
                            if (onOpenWindow) {
                                onOpenWindow('spellbook');
                                return;
                            }
                            setInitialFilter(undefined);
                            setDestination(null);
                            setBrowser(!browser);
                        }}
                    >
                        <RpgIcon icon="book" size={17} />
                        <span>Книга</span>
                    </button>
                    {onOpenWindow && (
                        <>
                            <button
                                className="deck-window-tab"
                                aria-pressed={openWindow === 'inventory'}
                                aria-label="Инвентарь"
                                title="Инвентарь · I"
                                onClick={() => onOpenWindow('inventory')}
                            >
                                <Backpack size={16} />
                                <span>Предметы</span>
                            </button>
                            <button
                                className="deck-window-tab"
                                aria-pressed={openWindow === 'character'}
                                aria-label="Открыть персонажа"
                                title="Персонаж · C"
                                onClick={() => onOpenWindow('character')}
                            >
                                <UserRound size={16} />
                                <span>Герой</span>
                            </button>
                        </>
                    )}
                </footer>
                {error && (
                    <div className="hotbar-save-error" role="alert">
                        Раскладка не подтверждена: {error}
                        <button onClick={onRetry}>Повторить</button>
                    </div>
                )}
            </section>
        </>
    );
}
