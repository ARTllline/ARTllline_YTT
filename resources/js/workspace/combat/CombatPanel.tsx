import { CombatHistory } from './CombatHistory';
import { CombatActorControls } from './CombatActorControls';
import { t } from '../../i18n';
import { tokenAppearance } from '../../tabletop/objects/tokenAppearance';
import { resourceCache } from '../../preload/ResourceCache';
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { TabletopRenderer } from '../../tabletop/renderer/TabletopRenderer';
import { GMResolutionQueue } from './GMResolutionQueue';
import { GMQuickCheck } from './GMQuickCheck';
import {
    Swords,
    ChevronDown,
    ChevronUp,
    ChevronLeft,
    ChevronRight,
    Plus,
    GripVertical,
    Shield,
    EyeOff,
    Crosshair,
    X,
    Play,
    ArrowDownWideNarrow,
} from 'lucide-react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { SaveQueue } from '../../tabletop/state/SaveQueue';
import type { Combat, Combatant } from '../../tabletop/types/combat';
import { currentTokenId } from '../../tabletop/types/combat';
import { Dialog } from '../Dialog';
import { ConfirmDialog } from '../ConfirmDialog';
import { ConditionList, TokenCombatControls } from './TokenCombatControls';
import '../../../css/combat.css';

function Initiative({
    entry,
    disabled,
    change,
}: {
    entry: Combatant;
    disabled: boolean;
    change: (value: number | null) => void;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <input
            className="initiative-input"
            aria-label={t('initiativeEntry', { id: entry.id })}
            title={t('Initiative · Enter to save')}
            type="number"
            step="0.01"
            min={-9999}
            max={9999}
            placeholder="—"
            value={draft ?? entry.initiative ?? ''}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
                if (draft !== null) {
                    const next = draft.trim() === '' ? null : Number(draft);
                    if ((next === null || Number.isFinite(next)) && next !== entry.initiative)
                        change(next);
                }
                setDraft(null);
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    setDraft(null);
                }
            }}
        />
    );
}

export function CombatPanel({
    store,
    queue,
    onClose,
    renderer,
}: {
    store: SceneStore;
    queue: SaveQueue;
    onClose?: () => void;
    renderer?: RefObject<TabletopRenderer | null>;
}) {
    const { scene, selectedIds, combatNotice } = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot,
    );
    const save = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
    const combat = scene.combat;
    const gm = store.role === 'gm';
    const disabled = save.status !== 'saved';
    const [collapsed, setCollapsed] = useState(
        () => !gm && window.matchMedia('(max-width: 600px)').matches,
    );
    const panelRef = useRef<HTMLElement>(null);
    const [inspecting, setInspecting] = useState(false);
    const [selected, setSelected] = useState<{ id: string; turn?: string }>({ id: '' });
    const [picker, setPicker] = useState(false);
    const [ending, setEnding] = useState(false);
    const [dragging, setDragging] = useState<string | null>(null);
    const [drop, setDrop] = useState<string | null>(null);
    const current = currentTokenId(combat);
    const turnKey = `${combat?.id}:${combat?.round}:${current}`;
    const currentToken = scene.tokens.find((t) => t.id === current);
    const title =
        combat?.status === 'active'
            ? t('round', { round: combat.round })
            : combat
              ? t('Combat prep')
              : t('Combat');
    const turnName =
        combat?.currentTurn && 'gmHiddenTurn' in combat.currentTurn
            ? t('GM Turn')
            : currentToken?.isOwner
              ? t('yourTurn') + ' · ' + currentToken.name
              : (currentToken?.name ?? t('Choose the first move'));

    const reorder = (id: string, target: string) => {
        if (!combat || id === target || disabled) return;
        const ids = combat.combatants.map((c) => c.id);
        ids.splice(ids.indexOf(id), 1);
        ids.splice(ids.indexOf(target), 0, id);
        store.combatCommand({ action: 'reorder', combatId: combat.id, combatantIds: ids });
    };
    const advance = (action: 'next' | 'previous') => {
        if (!combat) return;
        store.combatCommand({
            action,
            combatId: combat.id,
            expectedRound: combat.round,
            expectedCurrentCombatantId:
                combat.currentTurn && 'combatantId' in combat.currentTurn
                    ? combat.currentTurn.combatantId
                    : null,
        });
    };
    useEffect(() => {
        if (!gm || combat?.status !== 'active') return;
        const key = (e: KeyboardEvent) => {
            if (
                disabled ||
                e.repeat ||
                e.defaultPrevented ||
                e.ctrlKey ||
                e.metaKey ||
                store.abilityTargeting ||
                document.querySelector('dialog[open], [role="dialog"]')
            )
                return;
            if (
                e.target instanceof HTMLElement &&
                e.target.closest(
                    'input,textarea,select,button,a,[contenteditable="true"],[role="textbox"]',
                )
            )
                return;
            if (e.key.toLowerCase() === 'n' && !e.altKey) {
                e.preventDefault();
                advance(e.shiftKey ? 'previous' : 'next');
            }
            if (e.altKey && ['h', 'c'].includes(e.key.toLowerCase())) {
                e.preventDefault();
                const row = panelRef.current?.querySelector('.combat-row.expanded');
                if (e.key.toLowerCase() === 'h')
                    row?.querySelector<HTMLInputElement>('.hp-actions input')?.focus();
                else {
                    const picker = row?.querySelector<HTMLDetailsElement>('.condition-disclosure');
                    if (picker) {
                        picker.open = true;
                        picker.querySelector<HTMLInputElement>('.condition-search')?.focus();
                    }
                }
            }
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    });
    useEffect(() => {
        if (gm && current)
            panelRef.current
                ?.querySelector(`[data-token-id="${current}"] .combat-row-main`)
                ?.scrollIntoView({ block: 'nearest' });
    }, [gm, current]);
    if (!gm && !combat) return null;
    return (
        <aside
            ref={panelRef}
            className={`combat-panel ${gm ? 'gm-combat' : 'player-combat'} ${collapsed ? 'collapsed' : ''}`}
            aria-label={t('Combat tracker')}
        >
            <button
                className="combat-heading"
                title={onClose ? 'Закрыть бой' : 'Свернуть / развернуть бой'}
                onClick={() => (onClose ? onClose() : setCollapsed(!collapsed))}
                aria-expanded={!collapsed}
            >
                <Swords size={16} />
                <span>
                    <strong>{title}</strong>
                    {combat?.status === 'active' && <small>{turnName}</small>}
                </span>
                {onClose ? (
                    <X size={16} />
                ) : collapsed ? (
                    <ChevronDown size={15} />
                ) : (
                    <ChevronUp size={15} />
                )}
            </button>
            {!collapsed && (
                <>
                    {!combat ? (
                        <div className="combat-empty">
                            <strong> {t('No active combat')} </strong>
                            <p>
                                {' '}
                                {t(
                                    'Track initiative, rounds, HP and conditions right here at the table.',
                                )}{' '}
                            </p>
                            <button
                                className="primary-button"
                                disabled={disabled}
                                onClick={() => store.combatCommand({ action: 'prepare' })}
                            >
                                <Plus size={14} /> {t('Prepare Combat')}{' '}
                            </button>
                        </div>
                    ) : (
                        <>
                            {combat.status === 'active' && (
                                <div
                                    className="combat-spotlight"
                                    key={`${current}-${combat.round}`}
                                    aria-live="polite"
                                >
                                    <span className="eyebrow">
                                        РАУНД {combat.round} · ХОД{' '}
                                        {combat.combatants.findIndex((e) => e.tokenId === current) +
                                            1}{' '}
                                        / {combat.combatants.length}
                                    </span>
                                    <strong>{turnName}</strong>
                                    <span>
                                        {currentToken?.hp !== undefined
                                            ? `${currentToken.hp} / ${currentToken.maxHp ?? '—'} HP`
                                            : 'В центре сцены'}
                                    </span>
                                </div>
                            )}
                            {gm && (
                                <div className="combat-toolbar">
                                    <button disabled={disabled} onClick={() => setPicker(true)}>
                                        <Plus size={13} /> {t('Add combatants')}{' '}
                                    </button>
                                    <button
                                        disabled={disabled || !combat.combatants.length}
                                        title={t('Re-sort by Initiative')}
                                        aria-label={t('Re-sort by Initiative')}
                                        onClick={() =>
                                            store.combatCommand({
                                                action: 'sort',
                                                combatId: combat.id,
                                            })
                                        }
                                    >
                                        <ArrowDownWideNarrow size={15} />
                                    </button>
                                </div>
                            )}

                            {gm && (
                                <div className="combat-footer">
                                    {combat.status === 'active' && (
                                        <span className="combat-turn-status">
                                            Раунд {combat.round} · {turnName} ·{' '}
                                            {combat.combatants.findIndex(
                                                (e) => e.tokenId === current,
                                            ) + 1}
                                            /{combat.combatants.length}
                                        </span>
                                    )}
                                    {combat.status === 'preparing' ? (
                                        <button
                                            className="primary-button"
                                            disabled={disabled || !combat.combatants.length}
                                            onClick={() =>
                                                store.combatCommand({
                                                    action: 'begin',
                                                    combatId: combat.id,
                                                })
                                            }
                                        >
                                            <Play size={13} /> {t('Begin Combat')}{' '}
                                        </button>
                                    ) : (
                                        <div className="turn-actions">
                                            <button
                                                disabled={disabled || !combat.combatants.length}
                                                aria-label={t('Previous turn')}
                                                title="Предыдущий ход · Shift+N. Создаёт новые границы хода; не отменяет события."
                                                onClick={() => advance('previous')}
                                            >
                                                <ChevronLeft size={17} />
                                            </button>
                                            <button
                                                className="next-turn"
                                                title="Следующий ход · N"
                                                disabled={disabled || !combat.combatants.length}
                                                onClick={() => advance('next')}
                                            >
                                                {' '}
                                                {t('Next Turn')} <ChevronRight size={16} />
                                            </button>
                                        </div>
                                    )}
                                    <button
                                        className="end-combat"
                                        disabled={disabled}
                                        onClick={() => setEnding(true)}
                                    >
                                        {' '}
                                        {t('End Combat')}{' '}
                                    </button>
                                </div>
                            )}
                            <div className="combat-rows">
                                {!combat.combatants.length && (
                                    <p className="combat-empty">
                                        {gm
                                            ? t('Add tokens from this scene to set the order.')
                                            : t('The GM is taking the turn.')}
                                    </p>
                                )}
                                {combat.combatants.map((entry, index) => {
                                    const token = scene.tokens.find((t) => t.id === entry.tokenId);
                                    if (!token) return null;
                                    const active = current === token.id;
                                    const expanded =
                                        gm &&
                                        (selected.turn === turnKey && selected.id
                                            ? selected.id
                                            : (current ?? selectedIds[0])) === token.id;
                                    return (
                                        <div
                                            key={entry.id}
                                            className={`combat-row ${active ? 'current' : ''} ${expanded ? 'expanded' : ''} ${drop === entry.id ? 'drop-target' : ''}`}
                                            data-token-id={token.id}
                                            onDragOver={(e) => {
                                                if (gm && dragging) {
                                                    e.preventDefault();
                                                    setDrop(entry.id);
                                                }
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                if (dragging) reorder(dragging, entry.id);
                                                setDragging(null);
                                                setDrop(null);
                                            }}
                                        >
                                            <div className="combat-row-main">
                                                {gm && (
                                                    <button
                                                        className="drag-grip"
                                                        draggable={!disabled}
                                                        aria-label={t('reorderToken', {
                                                            name: token.name,
                                                        })}
                                                        title={t(
                                                            'Drag to reorder; arrow keys move in order',
                                                        )}
                                                        disabled={disabled}
                                                        onDragStart={(e) => {
                                                            setDragging(entry.id);
                                                            e.dataTransfer.setData(
                                                                'text/plain',
                                                                entry.id,
                                                            );
                                                            e.dataTransfer.effectAllowed = 'move';
                                                        }}
                                                        onDragEnd={() => {
                                                            setDragging(null);
                                                            setDrop(null);
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'ArrowUp' && index > 0) {
                                                                e.preventDefault();
                                                                reorder(
                                                                    entry.id,
                                                                    combat.combatants[index - 1].id,
                                                                );
                                                            }
                                                            if (
                                                                e.key === 'ArrowDown' &&
                                                                index < combat.combatants.length - 1
                                                            ) {
                                                                e.preventDefault();
                                                                const ids = combat.combatants.map(
                                                                    (c) => c.id,
                                                                );
                                                                [ids[index], ids[index + 1]] = [
                                                                    ids[index + 1],
                                                                    ids[index],
                                                                ];
                                                                store.combatCommand({
                                                                    action: 'reorder',
                                                                    combatId: combat.id,
                                                                    combatantIds: ids,
                                                                });
                                                            }
                                                        }}
                                                    >
                                                        <GripVertical size={14} />
                                                    </button>
                                                )}
                                                <button
                                                    className="combat-identity"
                                                    onClick={() => {
                                                        setSelected({
                                                            id: token.id,
                                                            turn: turnKey,
                                                        });
                                                        setInspecting(false);
                                                        store.select(token.id);
                                                    }}
                                                    title={t('selectToken', { name: token.name })}
                                                >
                                                    <span className="combat-portrait">
                                                        {token.image ? (
                                                            <img
                                                                src={resourceCache.imageUrl(
                                                                    token.image.url,
                                                                )}
                                                                alt=""
                                                            />
                                                        ) : (
                                                            <span className="combat-monogram">
                                                                {tokenAppearance(token).initials}
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span>
                                                        <strong>
                                                            {token.name}
                                                            {token.isHidden && <EyeOff size={11} />}
                                                        </strong>
                                                        {token.hp !== undefined ? (
                                                            <>
                                                                <small>
                                                                    {token.hp} / {token.maxHp} HP
                                                                    {token.hp === 0
                                                                        ? ' · ПОВЕРЖЕН'
                                                                        : ''}
                                                                    {gm && token.ac !== undefined
                                                                        ? ` · AC ${token.ac}`
                                                                        : ''}
                                                                    {entry.budget?.incapacitated
                                                                        ? ' · НЕДЕЕСПОСОБЕН'
                                                                        : ''}
                                                                </small>
                                                                <span
                                                                    className={`combat-hp ${token.hp === 0 ? 'empty' : ''}`}
                                                                >
                                                                    <i
                                                                        style={{
                                                                            width: `${(token.hp / (token.maxHp || 1)) * 100}%`,
                                                                        }}
                                                                    />
                                                                </span>
                                                            </>
                                                        ) : (
                                                            <small>
                                                                {active
                                                                    ? t('Current turn')
                                                                    : t('Combatant')}
                                                            </small>
                                                        )}
                                                    </span>
                                                </button>
                                                {gm ? (
                                                    <Initiative
                                                        entry={entry}
                                                        disabled={disabled}
                                                        change={(initiative) =>
                                                            store.combatCommand({
                                                                action: 'initiative',
                                                                combatId: combat.id,
                                                                combatantId: entry.id,
                                                                initiative,
                                                            })
                                                        }
                                                    />
                                                ) : (
                                                    <span
                                                        className="initiative-value"
                                                        title={t('Initiative')}
                                                    >
                                                        {entry.initiative ?? '—'}
                                                    </span>
                                                )}
                                            </div>
                                            {gm && expanded ? (
                                                <div className="combat-row-detail">
                                                    <div className="combat-quick-strip">
                                                        <button
                                                            title="HP · Alt+H"
                                                            onClick={(e) =>
                                                                e.currentTarget
                                                                    .closest('.combat-row-detail')
                                                                    ?.querySelector<HTMLInputElement>(
                                                                        '.hp-actions input',
                                                                    )
                                                                    ?.focus()
                                                            }
                                                        >
                                                            ± HP
                                                        </button>
                                                        <button
                                                            title="Состояния · Alt+C"
                                                            onClick={(e) => {
                                                                const d = e.currentTarget
                                                                    .closest('.combat-row-detail')
                                                                    ?.querySelector<HTMLDetailsElement>(
                                                                        '.condition-disclosure',
                                                                    );
                                                                if (d) {
                                                                    d.open = !d.open;
                                                                    d.querySelector<HTMLInputElement>(
                                                                        '.condition-search',
                                                                    )?.focus();
                                                                }
                                                            }}
                                                        >
                                                            Состояние
                                                        </button>
                                                        <button
                                                            title="Осмотреть без редактора"
                                                            aria-pressed={inspecting}
                                                            onClick={() =>
                                                                setInspecting(!inspecting)
                                                            }
                                                        >
                                                            Осмотр
                                                        </button>
                                                        <button
                                                            title="Фокус камеры ГМ"
                                                            onClick={() =>
                                                                renderer?.current?.focusToken(
                                                                    token.id,
                                                                )
                                                            }
                                                        >
                                                            Фокус
                                                        </button>
                                                    </div>
                                                    <TokenCombatControls
                                                        key={token.id}
                                                        token={token}
                                                        store={store}
                                                        disabled={disabled}
                                                    />
                                                    <CombatActorControls
                                                        key={'actor' + token.id}
                                                        token={token}
                                                        store={store}
                                                        renderer={renderer}
                                                        disabled={disabled}
                                                    />
                                                    {inspecting && (
                                                        <div className="runtime-inspection">
                                                            <strong>
                                                                {token.name} · AC {token.ac ?? '—'}{' '}
                                                                · {token.speed ?? '—'} ft
                                                            </strong>
                                                            <p>
                                                                {(
                                                                    scene.characters?.find(
                                                                        (c) =>
                                                                            c.id ===
                                                                            token.characterId,
                                                                    )?.checkStats ??
                                                                    token.checkStats ??
                                                                    []
                                                                )
                                                                    .map(
                                                                        (s) =>
                                                                            `${s.label} ${s.modifier >= 0 ? '+' : ''}${s.modifier}`,
                                                                    )
                                                                    .join(' · ')}
                                                            </p>
                                                            {[
                                                                'saving_throws',
                                                                'resistances',
                                                                'vulnerabilities',
                                                                'immunities',
                                                                'condition_immunities',
                                                            ].map((key) => (
                                                                <p key={key}>
                                                                    {
                                                                        (
                                                                            {
                                                                                saving_throws:
                                                                                    'Спасброски',
                                                                                resistances:
                                                                                    'Сопротивления',
                                                                                vulnerabilities:
                                                                                    'Уязвимости',
                                                                                immunities:
                                                                                    'Иммунитеты',
                                                                                condition_immunities:
                                                                                    'Иммунитет состояний',
                                                                            } as Record<
                                                                                string,
                                                                                string
                                                                            >
                                                                        )[key]
                                                                    }
                                                                    :{' '}
                                                                    {Array.isArray(
                                                                        token.combatProfile?.[key],
                                                                    )
                                                                        ? (
                                                                              token.combatProfile![
                                                                                  key
                                                                              ] as string[]
                                                                          ).join(', ') || '—'
                                                                        : token.combatProfile?.[
                                                                                key
                                                                            ] &&
                                                                            typeof token
                                                                                .combatProfile[
                                                                                key
                                                                            ] === 'object'
                                                                          ? Object.entries(
                                                                                token.combatProfile[
                                                                                    key
                                                                                ] as Record<
                                                                                    string,
                                                                                    number
                                                                                >,
                                                                            )
                                                                                .map(
                                                                                    ([k, v]) =>
                                                                                        `${k.toUpperCase()} ${v >= 0 ? '+' : ''}${v}`,
                                                                                )
                                                                                .join(' · ')
                                                                          : '—'}
                                                                </p>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className="combat-row-actions">
                                                        {combat.status === 'active' && (
                                                            <button
                                                                disabled={disabled || active}
                                                                onClick={() =>
                                                                    store.combatCommand({
                                                                        action: 'current',
                                                                        combatId: combat.id,
                                                                        combatantId: entry.id,
                                                                    })
                                                                }
                                                            >
                                                                <Crosshair size={12} />{' '}
                                                                {t('Make current')}{' '}
                                                            </button>
                                                        )}
                                                        <button
                                                            disabled={disabled}
                                                            onClick={() =>
                                                                store.combatCommand({
                                                                    action: 'remove',
                                                                    combatId: combat.id,
                                                                    combatantId: entry.id,
                                                                })
                                                            }
                                                        >
                                                            <X size={12} /> {t('Remove')}{' '}
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <ConditionList token={token} />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                    {gm && scene.id && (
                        <>
                            <GMQuickCheck
                                store={store}
                                tokenId={
                                    selected.turn === turnKey && selected.id
                                        ? selected.id
                                        : (current ?? selectedIds[0])
                                }
                                disabled={disabled}
                            />
                            <GMResolutionQueue store={store} disabled={disabled} />
                            <CombatHistory
                                sceneId={scene.id}
                                revision={scene.revision}
                                scene={scene}
                            />
                        </>
                    )}
                    {combatNotice && (
                        <p role="status" className="combat-notice">
                            {combatNotice}
                        </p>
                    )}
                </>
            )}
            {picker && combat && (
                <CombatPicker
                    store={store}
                    combat={combat}
                    close={() => setPicker(false)}
                    disabled={disabled}
                />
            )}
            {ending && combat && (
                <ConfirmDialog
                    title={t('End combat?')}
                    description={t(
                        'Turn tracking will stop. HP, conditions and combat history are kept.',
                    )}
                    buttonLabel={t('End Combat')}
                    onClose={() => setEnding(false)}
                    submit={async () => {
                        store.combatCommand({ action: 'end', combatId: combat.id });
                        await queue.flush();
                    }}
                />
            )}
        </aside>
    );
}

function CombatPicker({
    store,
    combat,
    close,
    disabled,
}: {
    store: SceneStore;
    combat: Combat;
    close: () => void;
    disabled: boolean;
}) {
    const { scene } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<string[]>([]);
    const available = scene.tokens.filter(
        (t) => !combat.combatants.some((c) => c.tokenId === t.id),
    );
    const visible = available.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));
    return (
        <Dialog title={t('Add combatants')} onClose={close}>
            <input
                className="combat-search"
                aria-label={t('Search scene tokens')}
                placeholder={t('Search scene tokens…')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
            />
            <button className="text-button" onClick={() => setSelected(visible.map((t) => t.id))}>
                {' '}
                {t('Select all shown')}{' '}
            </button>
            <div className="combat-picker">
                {visible.map((token) => (
                    <label key={token.id}>
                        <input
                            type="checkbox"
                            checked={selected.includes(token.id)}
                            onChange={(e) =>
                                setSelected(
                                    e.target.checked
                                        ? [...selected, token.id]
                                        : selected.filter((id) => id !== token.id),
                                )
                            }
                        />
                        <Shield size={16} />
                        <span>{token.name}</span>
                        {token.isHidden && <EyeOff size={13} />}
                    </label>
                ))}
                {!visible.length && <p> {t('No more matching tokens in this scene.')} </p>}
            </div>
            <div className="dialog-actions">
                <button className="secondary-button" onClick={close}>
                    {' '}
                    {t('Cancel')}{' '}
                </button>
                <button
                    className="primary-button"
                    disabled={disabled || !selected.length}
                    onClick={() => {
                        store.combatCommand({
                            action: 'add',
                            combatId: combat.id,
                            tokenIds: selected,
                        });
                        close();
                    }}
                >
                    {' '}
                    {t('Add')} {selected.length || ''} {t('combatants')}{' '}
                </button>
            </div>
        </Dialog>
    );
}
