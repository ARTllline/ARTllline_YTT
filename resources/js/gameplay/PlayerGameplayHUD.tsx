import type { RollMode } from '../workspace/interactions/actingToken';
import { AbilityHotbar } from './AbilityHotbar';
import { useHotbar } from './useHotbar';
import { normalizeSlots } from './hotbarModel';
import { abilityPreview } from './geometry';
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { ChevronUp, Heart, Shield, Footprints, X } from 'lucide-react';
import { ApiError } from '../api/client';
import { currentTokenId } from '../tabletop/types/combat';
import { api, commandId } from '../api/workspace';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { TabletopRenderer } from '../tabletop/renderer/TabletopRenderer';
import type { Character, Token } from '../tabletop/types/scene';
import { ConditionList } from '../workspace/combat/TokenCombatControls';
import { gameplayIcon } from './icons';
import { canAfford, gameplayApi, type Ability, type AbilityResult } from './model';
import { AbilityDialog, type AbilityInvocation } from './AbilityDialog';
import { AbilityTargeting } from './AbilityTargeting';
import { abilitySlot, readPendingAbility } from './pendingAbility';
import { HeroPortrait } from './HeroPortrait';
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
    const [panel, setPanel] = useState(false);
    useEffect(() => {
        const open = () => setPanel(true);
        window.addEventListener('ytt:character-panel', open);
        return () => window.removeEventListener('ytt:character-panel', open);
    }, []);
    const [rollMode, setRollMode] = useState<RollMode>('normal');
    const [browserRequest, setBrowserRequest] = useState(0);
    const [targeting, setTargeting] = useState<Ability | null>(null);
    const [invocation, setInvocation] = useState<AbilityInvocation | null>(null);
    const [error, setError] = useState('');
    const [resourceBusy, setResourceBusy] = useState(false);
    const [resourcePending, setResourcePending] = useState(false);
    const resourceRequest = useRef<{ key: string; delta: number; id: string } | null>(null);
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
    const choose = (ability: Ability) => {
        if (disabled) return;
        setPanel(false);
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
        else setInvocation({ ability, target: null, auto: true, mode: rollMode });
    };
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
    const adjust = async (key: string, delta: number) => {
        if (resourceBusy || disabled) return;
        resourceRequest.current ??= { key, delta, id: commandId() };
        setResourceBusy(true);
        setResourcePending(true);
        setError('');
        try {
            const command = resourceRequest.current;
            await gameplayApi.resource(
                scene.campaignId!,
                character.id,
                command.key,
                command.delta,
                command.id,
            );
            resourceRequest.current = null;
            setResourcePending(false);
            refresh();
        } catch (e) {
            if (e instanceof ApiError && e.status > 0 && e.status < 500) {
                resourceRequest.current = null;
                setResourcePending(false);
            }
            setError((e as Error).message);
        } finally {
            setResourceBusy(false);
        }
    };
    return (
        <>
            {panel && (
                <section className="character-compact-panel" aria-label="Персонаж подробнее">
                    <header>
                        <div>
                            <span className="eyebrow">ПЕРСОНАЖ</span>
                            <h3>{character.name}</h3>
                        </div>
                        <button
                            className="icon-button"
                            aria-label="Закрыть персонажа"
                            onClick={() => setPanel(false)}
                        >
                            <X size={17} />
                        </button>
                    </header>
                    <div className="character-vitals">
                        <span>
                            <Heart size={14} />
                            {character.hp} / {character.maxHp}
                        </span>
                        {character.ac != null && (
                            <span>
                                <Shield size={14} />
                                {character.ac}
                            </span>
                        )}
                        {character.speed != null && (
                            <span>
                                <Footprints size={14} />
                                {character.speed}
                            </span>
                        )}
                    </div>
                    {actor && <ConditionList token={actor} />}
                    <div className="character-resource-list">
                        {resources.map((r) => {
                            const Icon = gameplayIcon(r.icon);
                            return (
                                <div className={`resource-detail accent-${r.accent}`} key={r.key}>
                                    <Icon size={16} />
                                    <span>{r.label}</span>
                                    <strong>
                                        {r.current} / {r.max}
                                    </strong>
                                    {r.player_adjustable && (
                                        <>
                                            <button
                                                aria-label={`Уменьшить ${r.label}`}
                                                disabled={
                                                    disabled || resourceBusy || resourcePending
                                                }
                                                onClick={() => void adjust(r.key, -1)}
                                            >
                                                −
                                            </button>
                                            <button
                                                aria-label={`Увеличить ${r.label}`}
                                                disabled={
                                                    disabled || resourceBusy || resourcePending
                                                }
                                                onClick={() => void adjust(r.key, 1)}
                                            >
                                                +
                                            </button>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {!!character.checkStats.length && (
                        <>
                            <span className="eyebrow">ПРОВЕРКИ</span>
                            <div className="character-stat-list">
                                {character.checkStats.map((s) => (
                                    <div key={s.key}>
                                        <span>{s.label}</span>
                                        <strong>
                                            {s.modifier >= 0 ? '+' : ''}
                                            {s.modifier}
                                        </strong>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                    <span className="eyebrow">СПОСОБНОСТИ</span>
                    <div className="character-ability-list">
                        {abilities.map((a) => {
                            const Icon = gameplayIcon(a.icon);
                            return (
                                <button
                                    key={a.id}
                                    disabled={disabled || !canAfford(a, resources)}
                                    onClick={() => choose(a)}
                                >
                                    <Icon size={17} />
                                    <span>
                                        <strong>{a.name}</strong>
                                        <small>{a.description}</small>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </section>
            )}
            <div className="character-hud" key={character.id}>
                <HeroPortrait
                    store={store}
                    actors={actors}
                    actor={actor}
                    character={character}
                    disabled={disabled}
                    onDetails={() => setPanel(!panel)}
                />
                <div className="hud-identity">
                    <button
                        className="hud-character-details"
                        aria-label={`Подробнее: ${character.name}`}
                        aria-expanded={panel}
                        onClick={() => setPanel(!panel)}
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
                abilities={abilities}
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
                onResourceDetails={() => setPanel(true)}
                preferencesKey={`ytt:deck:${userId}:${scene.campaignId}:${character.id}`}
            />
            {pending && !invocation && (
                <button
                    className="ability-recover"
                    disabled={disabled}
                    onClick={() => {
                        const ability = abilities.find(
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
                            target: pending.command.target,
                            retained: pending,
                        });
                    }}
                >
                    Восстановить ответ · {pending.name}
                </button>
            )}
            {resourcePending && !resourceBusy && (
                <button
                    className="ability-recover"
                    disabled={disabled}
                    onClick={() =>
                        void adjust(resourceRequest.current!.key, resourceRequest.current!.delta)
                    }
                >
                    Повторить изменение ресурса
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
        </>
    );
}
