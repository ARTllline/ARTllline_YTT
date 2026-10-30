import type { RollMode } from '../workspace/interactions/actingToken';
import { AbilityHotbar } from './AbilityHotbar';
import { useHotbar } from './useHotbar';
import { normalizeSlots, placeBinding, abilityBinding, type SlotBinding } from './hotbarModel';
import { abilityPreview } from './geometry';
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { ChevronUp, Heart } from 'lucide-react';
import { currentTokenId } from '../tabletop/types/combat';
import { api } from '../api/workspace';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { TabletopRenderer } from '../tabletop/renderer/TabletopRenderer';
import type { Character, Token } from '../tabletop/types/scene';
import { ConditionList } from '../workspace/combat/TokenCombatControls';
import { canAfford, type Ability, type AbilityResult } from './model';
import { RpgDragProvider } from '../rpg/RpgDrag';
import { RpgWindows } from '../rpg/RpgWindows';
import type { RpgWindowKind } from '../rpg/RpgWindow';
import { useInventory } from '../rpg/useInventory';
import { itemBinding, type InventoryItem } from '../rpg/model';
import { AbilityDialog, type AbilityInvocation } from './AbilityDialog';
import { AbilityTargeting } from './AbilityTargeting';
import { abilitySlot, readPendingAbility } from './pendingAbility';
import { HeroPortrait } from './HeroPortrait';
import { CombatSupport } from './CombatSupport';
import { combatReason } from './combat';
import { usePlayerDice } from './PlayerDiceProvider';

export function PlayerGameplayHUD({
    store,
    renderer,
    actor,
    actors,
    userId,
    disabled,
    actorError,
}: {
    store: SceneStore;
    renderer: RefObject<TabletopRenderer | null>;
    actor?: Token;
    actors: Token[];
    userId: string;
    disabled: boolean;
    actorError: string;
}) {
    const { scene } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const dice = usePlayerDice();
    const warmDice = () => {
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
            void dice?.prepare().catch(() => {});
    };
    const character = scene.characters?.find((c) => c.id === scene.activeCharacterId);
    return (
        <div className="player-gameplay" onPointerEnter={warmDice} onFocus={warmDice}>
            {actorError && (
                <p role="alert" className="gameplay-error">
                    {actorError}
                </p>
            )}
            {character ? (
                <CharacterHUD
                    key={character.id}
                    character={character}
                    actor={actor}
                    store={store}
                    renderer={renderer}
                    userId={userId}
                    disabled={disabled}
                    actors={actors}
                />
            ) : actor ? (
                <div className="character-legacy">
                    <HeroPortrait store={store} actors={actors} actor={actor} disabled={disabled} />
                    <strong>{actor.name}</strong>
                    <Heart size={14} />
                    {actor.hp} / {actor.maxHp} HP
                    <ConditionList token={actor} />
                </div>
            ) : (
                <div className="hud-empty">
                    <HeroPortrait store={store} actors={actors} disabled={disabled} />
                    Выберите героя, чтобы действовать
                </div>
            )}
        </div>
    );
}

function CharacterHUD({
    character,
    actor,
    store,
    renderer,
    userId,
    disabled,
    actors,
}: {
    character: Character;
    actor?: Token;
    store: SceneStore;
    renderer: RefObject<TabletopRenderer | null>;
    userId: string;
    disabled: boolean;
    actors: Token[];
}) {
    const [panel, setPanel] = useState<RpgWindowKind | null>(null);
    useEffect(() => {
        const open = () => setPanel('character');
        window.addEventListener('ytt:character-panel', open);
        return () => window.removeEventListener('ytt:character-panel', open);
    }, []);
    const [rollMode, setRollMode] = useState<RollMode>('normal');
    const [browserRequest, setBrowserRequest] = useState(0);
    const [targeting, setTargeting] = useState<Ability | null>(null);
    const [invocation, setInvocation] = useState<AbilityInvocation | null>(null);
    const [error, setError] = useState('');
    const itemMode = useRef<'use' | 'throw'>('use');
    const itemSource = useRef<string | undefined>(undefined);
    const { scene } = store.getSnapshot();
    const slot = abilitySlot(userId, scene.campaignId!, character.id);
    const pending = readPendingAbility(slot);
    const resources = character.resources ?? [];
    const abilities = (character.abilities ?? [])
        .filter((a) => a.enabled)
        .sort((a, b) => a.sort_order - b.sort_order);
    const hotbar = useHotbar(
        scene.campaignId!,
        character.id,
        abilities.map((a) => a.id),
    );
    const refresh = () => {
        void api
            .snapshot(scene.id!)
            .then((next) => {
                if (
                    next.id === store.getSnapshot().scene.id &&
                    (next.revision ?? 0) >= (store.getSnapshot().scene.revision ?? 0)
                )
                    store.reconcile(next);
            })
            .catch((e) => setError(e.message));
    };
    const inventory = useInventory(scene.campaignId!, character, refresh);
    const choose = (ability: Ability, inventoryItemId?: string) => {
        if (disabled) return;
        const reason = combatReason(
            ability,
            scene.combat?.combatants.find((e) => e.tokenId === actor?.id)?.budget,
        );
        if (reason) {
            setError(reason);
            return;
        }
        if (ability.spell?.prepared === false) {
            setError('Заклинание не подготовлено.');
            return;
        }
        itemSource.current = inventoryItemId;
        setPanel(null);
        setError('');
        if (!canAfford(ability, resources)) {
            setError('Недостаточно ресурса.');
            return;
        }
        if (!actor && ['token', 'prop', 'point'].includes(ability.target)) {
            setError('Нужен токен персонажа на этой сцене.');
            return;
        }
        if (pending) {
            setError('Сначала восстановите ответ предыдущего действия.');
            return;
        }
        if (['token', 'prop', 'point'].includes(ability.target)) setTargeting(ability);
        else
            setInvocation({
                ability,
                target: null,
                auto: true,
                mode: rollMode,
                inventoryItemId,
                itemAction: itemMode.current,
            });
    };
    const chooseItem = (item: InventoryItem, mode: 'use' | 'throw' = 'use') => {
        itemMode.current = mode;
        if (item.action && !item.action.available) {
            setError(item.action.reason);
            return;
        }
        const ability =
            (mode === 'throw' ? item.action?.secondary : item.action?.ability) ??
            inventory.data?.useAbilities.find((a) => a.id === item.definition.use_ability_id);
        if (!ability || item.quantity < 1) {
            setError('Предмет недоступен или закончился.');
            return;
        }
        choose(ability, item.id);
    };
    const bind = (binding: SlotBinding) => {
        const empty = hotbar.slots.findIndex((s) => s === null);
        if (empty < 0) {
            setError('В панели нет свободных ячеек. Перетащите на нужный слот.');
            return;
        }
        hotbar.change(placeBinding(hotbar.slots, binding, empty));
    };
    const windowHandlers = useRef(chooseItem);
    useEffect(() => {
        windowHandlers.current = chooseItem;
    });
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (
                e.ctrlKey ||
                e.metaKey ||
                e.altKey ||
                e.shiftKey ||
                e.repeat ||
                document.querySelector('dialog[open]') ||
                (e.target instanceof HTMLElement &&
                    e.target.closest('input,textarea,select,[contenteditable="true"]'))
            )
                return;
            const kind = ({ KeyI: 'inventory', KeyK: 'spellbook', KeyC: 'character' } as const)[
                e.code as 'KeyI' | 'KeyK' | 'KeyC'
            ];
            if (kind) {
                e.preventDefault();
                setPanel((p) => (p === kind ? null : kind));
            }
        };
        const item = (e: Event) => {
            const detail = (e as CustomEvent<string | { id: string; mode: 'use' | 'throw' }>)
                .detail;
            const id = typeof detail === 'string' ? detail : detail.id;
            const candidate = inventory.data?.items.find((i) => i.id === id);
            if (candidate)
                windowHandlers.current(candidate, typeof detail === 'string' ? 'use' : detail.mode);
        };
        window.addEventListener('keydown', key);
        window.addEventListener('ytt:inventory-use', item);
        return () => {
            window.removeEventListener('keydown', key);
            window.removeEventListener('ytt:inventory-use', item);
        };
    }, [inventory.data]);
    const radialRequest = useRef<(event: CustomEvent) => void>(() => {});
    useEffect(() => {
        radialRequest.current = (event) => {
            if (event.detail?.browser) {
                setBrowserRequest((n) => n + 1);
                return;
            }
            const ability = abilities.find((a) => a.id === event.detail?.abilityId);
            if (!ability || disabled || pending || !canAfford(ability, resources)) return;
            const target = event.detail.target;
            if (
                target &&
                ability.target === 'token' &&
                abilityPreview(ability, scene, actor, target).valid
            ) {
                setInvocation({
                    ability,
                    target,
                    targetName: event.detail.targetName,
                    auto: true,
                    mode: rollMode,
                });
            } else choose(ability);
        };
    });
    useEffect(() => {
        const listener = (e: Event) => radialRequest.current(e as CustomEvent);
        window.addEventListener('ytt:ability-invoke', listener);
        return () => window.removeEventListener('ytt:ability-invoke', listener);
    }, []);
    const accepted = (r: AbilityResult) => {
        void inventory.refresh();
        refresh();
        if (r.outcomes?.length) {
            for (const outcome of r.outcomes) {
                renderer.current?.respondToObject('token', outcome.tokenId);
                renderer.current?.gameplay.feedback({
                    tokenId: outcome.tokenId,
                    text: `−${outcome.damage}`,
                    tone: 'damage',
                });
            }
            return;
        }
        const target = r.target?.kind === 'token' ? r.target.id : actor?.id;
        if (!target) return;
        renderer.current?.respondToObject('token', target);
        const feedback = r.damage
            ? { text: `−${r.damage.total}`, tone: 'damage' as const }
            : r.healing
              ? { text: `+${r.healing}`, tone: 'heal' as const }
              : r.category === 'attack' && !r.success
                ? { text: 'Промах', tone: 'miss' as const }
                : null;
        if (feedback) renderer.current?.gameplay.feedback({ tokenId: target, ...feedback });
    };
    return (
        <RpgDragProvider
            icon={(b) =>
                b.sourceType === 'ability'
                    ? (abilities.find((a) => a.id === b.sourceId)?.icon ?? 'spark')
                    : (inventory.data?.items.find((i) => i.id === b.sourceId)?.definition.icon ??
                      'item_potion')
            }
        >
            {panel && (
                <RpgWindows
                    campaign={scene.campaignId!}
                    kind={panel}
                    onChange={setPanel}
                    onClose={() => setPanel(null)}
                    character={character}
                    actor={actor}
                    inventory={inventory}
                    onResourceChange={() => {
                        void inventory.refresh();
                        refresh();
                    }}
                    onChoose={choose}
                    onUse={chooseItem}
                    onBindAbility={(a) => bind(abilityBinding(a.id))}
                    onBindItem={(i) => bind(itemBinding(i.id))}
                />
            )}
            <div
                className={`character-hud ${actor && currentTokenId(scene.combat) === actor.id ? 'is-current-turn' : ''}`}
                key={character.id}
            >
                <HeroPortrait
                    store={store}
                    actors={actors}
                    actor={actor}
                    character={character}
                    disabled={disabled}
                    onDetails={() => setPanel(panel === 'character' ? null : 'character')}
                />
                <div className="hud-identity">
                    <button
                        className="hud-character-details"
                        title={character.name}
                        aria-label={`Подробнее: ${character.name}`}
                        aria-expanded={panel === 'character'}
                        onClick={() => setPanel(panel === 'character' ? null : 'character')}
                    >
                        {character.name} <ChevronUp size={12} />
                    </button>
                    <div className="hud-hp">
                        <Heart size={12} />
                        <span key={character.hp}>
                            {character.hp} <small>/ {character.maxHp}</small>
                        </span>
                    </div>
                    <div
                        className="hud-hp-track"
                        role="meter"
                        aria-label="HP персонажа"
                        aria-valuenow={character.hp}
                        aria-valuemin={0}
                        aria-valuemax={character.maxHp}
                    >
                        <i
                            style={{
                                width: `${Math.max(0, Math.min(100, (character.hp / character.maxHp) * 100))}%`,
                            }}
                        />
                    </div>
                    {scene.combat?.status === 'active' && (
                        <small
                            className={`hud-turn ${actor && currentTokenId(scene.combat) === actor.id ? 'is-current' : ''}`}
                        >
                            {actor && currentTokenId(scene.combat) === actor.id
                                ? 'Ваш ход'
                                : `Раунд ${scene.combat.round}`}
                        </small>
                    )}
                    {!actor && <small className="hud-offscene">Вне этой сцены</small>}
                </div>
                {!!actor?.conditions?.length && (
                    <div className="hud-conditions">
                        <ConditionList token={actor} />
                    </div>
                )}
            </div>
            <AbilityHotbar
                onStand={
                    actor?.conditions?.some((c) => c.key === 'prone')
                        ? () => store.tokenCombat(actor.id, { action: 'stand-up' })
                        : undefined
                }
                combatBudget={scene.combat?.combatants.find((e) => e.tokenId === actor?.id)?.budget}
                abilities={abilities}
                items={inventory.data?.items ?? []}
                itemAbilities={inventory.data?.useAbilities ?? []}
                onChooseItem={chooseItem}
                onOpenWindow={setPanel}
                openWindow={panel}
                resources={resources}
                slots={hotbar.slots}
                onLayout={(next) =>
                    hotbar.change(
                        normalizeSlots(
                            next,
                            abilities.map((a) => a.id),
                        ),
                    )
                }
                onChoose={choose}
                selected={targeting?.id}
                disabled={disabled || !!pending || (!actor && !!targeting)}
                editable={hotbar.loaded}
                saving={hotbar.saving}
                error={hotbar.error}
                onRetry={hotbar.retry}
                openRequest={browserRequest}
                rollMode={rollMode}
                onRollMode={setRollMode}
                worldAvailable={!!actor}
                onResourceDetails={() => setPanel('character')}
                preferencesKey={`ytt:deck:${userId}:${scene.campaignId}:${character.id}`}
            />
            <CombatSupport
                character={character}
                actor={actor}
                combat={scene.combat}
                disabled={disabled}
                onDetails={() => setPanel('character')}
            />
            {pending && !invocation && (
                <button
                    className="ability-recover"
                    disabled={disabled}
                    onClick={() => {
                        const ability = abilities.find((a) => a.id === pending.command.abilityId) ??
                            inventory.data?.items
                                .map((i) =>
                                    pending.command.itemAction === 'throw'
                                        ? i.action?.secondary
                                        : i.action?.ability,
                                )
                                .find((a) => a?.id === pending.command.abilityId) ??
                            inventory.data?.useAbilities.find(
                                (a) => a.id === pending.command.abilityId,
                            ) ?? {
                                id: pending.command.abilityId,
                                name: pending.name,
                                icon: 'spark',
                                description: null,
                                category: 'utility',
                                target: 'none',
                                check: null,
                                costs: [],
                                sort_order: 0,
                                enabled: true,
                            };
                        setInvocation({
                            ability,
                            inventoryItemId: pending.command.inventoryItemId,
                            itemAction: pending.command.itemAction,
                            target: pending.command.target,
                            retained: pending,
                        });
                    }}
                >
                    Восстановить ответ · {pending.name}
                </button>
            )}
            {error && (
                <p className="gameplay-error" role="alert">
                    {error}
                </p>
            )}
            {targeting && (
                <AbilityTargeting
                    ability={targeting}
                    store={store}
                    renderer={renderer}
                    onCancel={() => setTargeting(null)}
                    onSelect={(target, targetName) => {
                        setInvocation({
                            ability: targeting,
                            target,
                            targetName,
                            auto: true,
                            mode: rollMode,
                            inventoryItemId: itemSource.current,
                            itemAction: itemMode.current,
                        });
                        setTargeting(null);
                    }}
                />
            )}
            {invocation && (
                <AbilityDialog
                    invocation={invocation}
                    character={character}
                    userId={userId}
                    sceneId={scene.id!}
                    campaignId={scene.campaignId!}
                    epoch={scene.liveRevision ?? 0}
                    onAccepted={accepted}
                    onClose={() => {
                        setInvocation(null);
                        refresh();
                    }}
                />
            )}
        </RpgDragProvider>
    );
}
