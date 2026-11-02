import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, EyeOff, Skull, Swords, X } from 'lucide-react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { TabletopRenderer } from '../../tabletop/renderer/TabletopRenderer';
import { currentTokenId } from '../../tabletop/types/combat';
import { tokenAppearance } from '../../tabletop/objects/tokenAppearance';
import { resourceCache } from '../../preload/ResourceCache';
import { conditionLabel } from '../../i18n';
import { ConditionIcon } from './ConditionIcon';
import '../../../css/initiative-timeline.css';

/** Read-only awareness of the existing, viewer-filtered snapshot and incremental state. */
export function InitiativeTimeline({
    store,
    renderer,
    onSelect,
}: {
    store: SceneStore;
    renderer?: RefObject<TabletopRenderer | null>;
    onSelect?: () => void;
}) {
    const { scene, selectedIds } = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot,
    );
    const rail = useRef<HTMLDivElement>(null);
    const combat = scene.combat;
    const current = currentTokenId(combat);
    const hiddenTurn = !!combat?.currentTurn && 'gmHiddenTurn' in combat.currentTurn;
    const entries =
        combat?.combatants.flatMap((entry) => {
            const token = scene.tokens.find((t) => t.id === entry.tokenId);
            return token ? [{ entry, token }] : [];
        }) ?? [];
    const currentIndex = entries.findIndex(({ token }) => token.id === current);
    const next =
        currentIndex >= 0 ? entries[(currentIndex + 1) % entries.length]?.token : undefined;
    const order = entries.map(({ entry }) => entry.id).join(':');
    const active = combat?.status === 'active';
    useEffect(() => {
        const node = rail.current;
        if (!node || !active) return;
        const center = () => {
            const card = node.querySelector<HTMLElement>('[aria-current="step"]');
            const cards = Array.from(node.children) as HTMLElement[];
            const gap = parseFloat(getComputedStyle(node).columnGap) || 0;
            const contentWidth =
                cards.reduce((sum, item) => sum + item.offsetWidth, 0) +
                Math.max(0, cards.length - 1) * gap;
            // End turns can occupy the center too, without clipping the first/last portrait.
            node.style.paddingInline =
                contentWidth > node.clientWidth
                    ? `${Math.max(3, (node.clientWidth - (card?.offsetWidth ?? cards[0]?.offsetWidth ?? 0)) / 2)}px`
                    : '3px';
            // Scroll only this rail. Never scroll the document or move the tabletop camera.
            node.scrollTo({
                left: card ? card.offsetLeft + card.offsetWidth / 2 - node.clientWidth / 2 : 0,
                behavior: 'instant',
            });
        };
        center();
        const observer = new ResizeObserver(center);
        observer.observe(node);
        return () => observer.disconnect();
    }, [current, order, active, hiddenTurn, combat?.round]);
    if (!active) return null;

    return (
        <section className="initiative-timeline" aria-label="Порядок ходов">
            <header
                className="timeline-heading"
                title={hiddenTurn ? 'Ход ГМ' : next ? `Далее: ${next.name}` : undefined}
            >
                <Swords size={13} />
                <strong>Раунд {combat.round}</strong>
                <span role="status" aria-live="polite" aria-atomic="true">
                    {hiddenTurn
                        ? 'Ход ГМ'
                        : currentIndex >= 0
                          ? `Ход: ${entries[currentIndex].token.name}`
                          : 'Ожидание хода'}
                    {next && entries.length > 1 && (
                        <span className="timeline-next"> · Далее: {next.name}</span>
                    )}
                </span>
            </header>
            <div className="timeline-track">
                <button
                    className="timeline-scroll"
                    aria-label="Предыдущие участники"
                    onClick={() => rail.current?.scrollBy({ left: -180 })}
                >
                    <ChevronLeft size={15} />
                </button>
                <div
                    className="timeline-rail"
                    ref={rail}
                    tabIndex={0}
                    aria-label="Участники · прокрутка по горизонтали"
                >
                    {hiddenTurn && (
                        <div className="timeline-hidden-turn" aria-current="step">
                            <EyeOff size={20} />
                            <span>Ход ГМ</span>
                        </div>
                    )}
                    {entries.map(({ entry, token }, index) => {
                        const isCurrent = token.id === current;
                        const selected = selectedIds.includes(token.id);
                        const dead = token.lifecycle?.status === 'dead';
                        const down =
                            !dead &&
                            (token.hp === 0 ||
                                token.conditions?.some((c) => c.key === 'unconscious') ||
                                ['dying', 'stable', 'defeated', 'unconscious'].includes(
                                    token.lifecycle?.status ?? '',
                                ));
                        const conditions = token.conditions ?? [];
                        const hp =
                            token.hp === undefined
                                ? 'HP скрыты'
                                : `${token.hp} / ${token.maxHp ?? '—'} HP`;
                        const state = dead ? 'Мёртв' : down ? 'Повержен' : '';
                        const name = `${index + 1}. ${token.name} · Инициатива ${entry.initiative ?? '—'} · ${hp}${state ? ` · ${state}` : ''}${conditions.length ? ` · ${conditions.map(conditionLabel).join(', ')}` : ''}`;
                        return (
                            <button
                                key={entry.id}
                                className={`timeline-card ${isCurrent ? 'is-current' : ''} ${selected ? 'is-selected' : ''} ${dead ? 'is-dead' : down ? 'is-downed' : ''}`}
                                data-token-id={token.id}
                                aria-label={name}
                                title={name}
                                aria-current={isCurrent ? 'step' : undefined}
                                aria-pressed={selected}
                                onClick={() => {
                                    store.select(token.id);
                                    renderer?.current?.focusToken(token.id);
                                    onSelect?.();
                                }}
                            >
                                <span className="timeline-turn-marker">
                                    {isCurrent
                                        ? 'ХОД'
                                        : index === (currentIndex + 1) % entries.length &&
                                            currentIndex >= 0
                                          ? 'ДАЛЕЕ'
                                          : `#${index + 1}`}
                                </span>
                                <span className="timeline-portrait">
                                    {token.image ? (
                                        <img src={resourceCache.imageUrl(token.image.url)} alt="" />
                                    ) : (
                                        <span className="timeline-monogram">
                                            {tokenAppearance(token).initials}
                                        </span>
                                    )}
                                    <span className="timeline-initiative" title="Инициатива">
                                        {entry.initiative ?? '—'}
                                    </span>
                                    {store.role === 'gm' && token.isHidden && (
                                        <EyeOff className="timeline-secret" size={12} />
                                    )}
                                    {(dead || down) && (
                                        <span className="timeline-life">
                                            {dead ? <Skull size={16} /> : <X size={18} />}
                                            <span className="timeline-state-label">{state}</span>
                                        </span>
                                    )}
                                    <span className="timeline-hp">
                                        {token.hp === undefined
                                            ? '— HP'
                                            : `${token.hp}/${token.maxHp ?? '—'}`}
                                    </span>
                                    {token.hp !== undefined && !!token.maxHp && (
                                        <span className="timeline-health">
                                            <i
                                                style={{
                                                    width: `${Math.max(0, Math.min(100, (token.hp / token.maxHp) * 100))}%`,
                                                }}
                                            />
                                        </span>
                                    )}
                                    <span className="timeline-conditions">
                                        {conditions.slice(0, 2).map((c) => (
                                            <span key={c.id} title={conditionLabel(c)}>
                                                <ConditionIcon name={c.key} />
                                                <span className="timeline-condition-label">
                                                    {conditionLabel(c)}
                                                </span>
                                            </span>
                                        ))}
                                        {conditions.length > 2 && <b>+{conditions.length - 2}</b>}
                                    </span>
                                </span>
                                <span className="timeline-name">{token.name}</span>
                            </button>
                        );
                    })}
                </div>
                <button
                    className="timeline-scroll"
                    aria-label="Следующие участники"
                    onClick={() => rail.current?.scrollBy({ left: 180 })}
                >
                    <ChevronRight size={15} />
                </button>
            </div>
        </section>
    );
}
