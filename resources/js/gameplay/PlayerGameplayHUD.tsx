import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import {
    ChevronUp,
    MoreHorizontal,
    CircleUserRound,
    Heart,
    Shield,
    Footprints,
    X,
} from 'lucide-react';
import { ApiError } from '../api/client';
import { currentTokenId } from '../tabletop/types/combat';
import { api, commandId } from '../api/workspace';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { TabletopRenderer } from '../tabletop/renderer/TabletopRenderer';
import type { Character, Token } from '../tabletop/types/scene';
import { ActorPicker } from '../workspace/interactions/ActorPicker';
import { ConditionList } from '../workspace/combat/TokenCombatControls';
import { gameplayIcon } from './icons';
import { canAfford, gameplayApi, type Ability, type AbilityResult } from './model';
import { AbilityDialog, type AbilityInvocation } from './AbilityDialog';
import { AbilityTargeting } from './AbilityTargeting';
import { abilitySlot, readPendingAbility } from './pendingAbility';

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
    const character = scene.characters?.find((c) => c.id === scene.activeCharacterId);
    return (
        <div className="player-gameplay">
            <div className="character-switch">
                {scene.characters?.length ? (
                    <label>
                        <span className="sr-only">Действующий персонаж</span>
                        <select
                            aria-label="Действующий персонаж"
                            value={scene.activeCharacterId ?? (actor ? `token:${actor.id}` : '')}
                            disabled={disabled}
                            onChange={(e) =>
                                e.target.value.startsWith('token:')
                                    ? store.setActingToken(e.target.value.slice(6))
                                    : store.setActiveCharacter(e.target.value || null)
                            }
                        >
                            <option value="" disabled>
                                Выберите персонажа
                            </option>
                            {scene.characters.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                            {actors
                                .filter((t) => !t.characterId)
                                .map((t) => (
                                    <option value={`token:${t.id}`} key={t.id}>
                                        {t.name} · токен сцены
                                    </option>
                                ))}
                        </select>
                    </label>
                ) : (
                    <ActorPicker
                        tokens={actors}
                        actor={actor}
                        disabled={disabled}
                        onChange={(id) => store.setActingToken(id)}
                    />
                )}
                {actorError && (
                    <p role="alert" className="error">
                        {actorError}
                    </p>
                )}
            </div>
            {character ? (
                <CharacterHUD
                    key={character.id}
                    character={character}
                    actor={actor}
                    store={store}
                    renderer={renderer}
                    userId={userId}
                    disabled={disabled}
                />
            ) : actor ? (
                <div className="character-legacy">
                    <Heart size={14} />
                    {actor.hp} / {actor.maxHp} HP
                    <ConditionList token={actor} />
                </div>
            ) : (
                <p className="hud-empty">Выберите героя, чтобы действовать</p>
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
}: {
    character: Character;
    actor?: Token;
    store: SceneStore;
    renderer: RefObject<TabletopRenderer | null>;
    userId: string;
    disabled: boolean;
}) {
    const [panel, setPanel] = useState(false);
    useEffect(() => {
        const open = () => setPanel(true);
        window.addEventListener('ytt:character-panel', open);
        return () => window.removeEventListener('ytt:character-panel', open);
    }, []);
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
        if (pending) {
            setError('Сначала восстановите ответ предыдущего действия.');
            return;
        }
        if (['token', 'prop', 'point'].includes(ability.target)) setTargeting(ability);
        else setInvocation({ ability, target: null });
    };
    const shortcut = useRef<(index: number) => void>(() => {});
    useEffect(() => {
        shortcut.current = (index) => {
            const ability = abilities[index];
            if (
                !ability ||
                !canAfford(ability, resources) ||
                (!actor && ['token', 'prop', 'point'].includes(ability.target))
            )
                return;
            choose(ability);
        };
    });
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            if (
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                event.shiftKey ||
                event.repeat ||
                event.isComposing ||
                !/^[1-8]$/.test(event.key) ||
                document.querySelector('dialog[open]')
            )
                return;
            if (
                event.target instanceof HTMLElement &&
                event.target.closest('input,textarea,select,[contenteditable="true"]')
            )
                return;
            event.preventDefault();
            shortcut.current(Number(event.key) - 1);
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, []);
    const accepted = (r: AbilityResult) => {
        refresh();
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
                <button
                    className="hud-portrait"
                    aria-label={`Подробнее: ${character.name}`}
                    aria-expanded={panel}
                    onClick={() => setPanel(!panel)}
                >
                    {character.portrait ? (
                        <img src={character.portrait.url} alt="" />
                    ) : (
                        <CircleUserRound size={30} />
                    )}
                    <ChevronUp size={12} />
                    {!!actor?.conditions?.length && (
                        <span
                            className="hud-condition-badge"
                            title={actor.conditions.map((c) => c.label).join(' · ')}
                        >
                            {actor.conditions.length}
                        </span>
                    )}
                </button>
                <div className="hud-identity">
                    <strong>{character.name}</strong>
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
                <div className="hud-resources">
                    {resources.map((r) => {
                        const Icon = gameplayIcon(r.icon);
                        return (
                            <button
                                key={r.key}
                                className={`hud-resource accent-${r.accent}`}
                                onClick={() => setPanel(true)}
                                title={`${r.label}: ${r.current} / ${r.max}`}
                                aria-label={`${r.label}: ${r.current} из ${r.max}`}
                            >
                                <Icon size={15} />
                                <span key={r.current}>
                                    {r.current}
                                    <small>/{r.max}</small>
                                </span>
                            </button>
                        );
                    })}
                </div>
                {actor && (
                    <div className="hud-conditions">
                        <ConditionList token={actor} />
                    </div>
                )}
            </div>
            {!!abilities.length && (
                <div
                    className="ability-actionbar"
                    role="toolbar"
                    aria-label="Способности персонажа"
                >
                    {abilities.slice(0, 8).map((a, i) => {
                        const Icon = gameplayIcon(a.icon),
                            affordable = canAfford(a, resources),
                            noActor = !actor && ['token', 'prop', 'point'].includes(a.target);
                        return (
                            <div className="ability-slot" key={a.id}>
                                <button
                                    aria-label={a.name}
                                    aria-pressed={targeting?.id === a.id}
                                    disabled={disabled || !affordable || noActor || !!pending}
                                    onClick={() => choose(a)}
                                >
                                    <Icon size={23} strokeWidth={1.5} />
                                    <small>{i + 1}</small>
                                    {!!a.costs.length && <i className="ability-cost-dot" />}
                                </button>
                                <div className="ability-tooltip" role="tooltip">
                                    <strong>{a.name}</strong>
                                    <span>{a.description}</span>
                                    <small>
                                        {a.costs
                                            .map(
                                                (c) =>
                                                    `${resources.find((r) => r.key === c.key)?.label ?? c.key} −${c.amount}`,
                                            )
                                            .join(' · ') || 'Без затрат'}
                                    </small>
                                    {!affordable && <em>Недостаточно ресурса</em>}
                                    {noActor && <em>Нужен токен на этой сцене</em>}
                                </div>
                            </div>
                        );
                    })}
                    {abilities.length > 8 && (
                        <button
                            className="ability-more"
                            aria-label="Все способности"
                            onClick={() => setPanel(true)}
                        >
                            <MoreHorizontal size={22} />
                            <small>+{abilities.length - 8}</small>
                        </button>
                    )}
                </div>
            )}
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
                        setInvocation({ ability: targeting, target, targetName });
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
