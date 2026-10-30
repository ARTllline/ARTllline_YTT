import { GMLifecycleControls } from './AdventuringControls';
import { useState, type RefObject } from 'react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { Token } from '../../tabletop/types/scene';
import type { TabletopRenderer } from '../../tabletop/renderer/TabletopRenderer';
import { ApiError } from '../../api/client';
import { api, commandId } from '../../api/workspace';
import {
    gameplayApi,
    type Ability,
    type AbilityCommand,
    type AbilityTarget,
} from '../../gameplay/model';
import { AbilityTargeting } from '../../gameplay/AbilityTargeting';
import { combatReason, CombatBudgetView } from '../../gameplay/combat';
import { abilityPreview } from '../../gameplay/geometry';
import { CastLevelChooser } from '../../gameplay/spellcasting';

export function CombatActorControls({
    token,
    store,
    renderer,
    disabled = false,
}: {
    token: Token;
    store: SceneStore;
    renderer?: RefObject<TabletopRenderer | null>;
    disabled?: boolean;
}) {
    const { scene } = store.getSnapshot();
    const combat = scene.combat;
    const character = scene.characters?.find((c) => c.id === token.characterId);
    const abilities = character?.abilities ?? token.abilities ?? [];
    const entry = combat?.combatants.find((e) => e.tokenId === token.id);
    const [aiming, setAiming] = useState<Ability | null>(null);
    const [casting, setCasting] = useState<Ability | null>(null);
    const [cast, setCast] = useState<{ castLevel: number; effectChoice?: string }>();
    const [pending, setPending] = useState<AbilityCommand | null>(null);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const run = async (command: AbilityCommand) => {
        setBusy(true);
        setPending(command);
        setError('');
        try {
            await gameplayApi.execute(scene.id!, command);
            setPending(null);
            store.reconcile(await api.snapshot(scene.id!));
        } catch (e) {
            setError((e as Error).message);
            if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
                setPending(null);
                store.reconcile(await api.snapshot(scene.id!));
            }
        } finally {
            setBusy(false);
        }
    };
    const execute = (ability: Ability, target: AbilityTarget | null, extra = cast) => {
        setAiming(null);
        void run({
            ...(token.characterId
                ? { characterId: token.characterId }
                : { actorTokenId: token.id }),
            abilityId: ability.id,
            target,
            epoch: scene.liveRevision ?? 0,
            rollMode: 'normal',
            clientMutationId: commandId(),
            ...(ability.spell ? extra : {}),
        });
    };
    const choose = (ability: Ability, extra = cast) => {
        if (ability.target === 'none' || ability.target === 'self') {
            execute(ability, null, extra);
            return;
        }
        const selected = store.getSnapshot().selectedIds.find((id) => id !== token.id);
        const target = selected ? { kind: 'token' as const, id: selected } : null;
        if (
            ability.target === 'token' &&
            target &&
            abilityPreview(ability, scene, token, target).valid
        )
            execute(ability, target, extra);
        else setAiming(ability);
    };
    if (store.role !== 'gm') return null;
    return (
        <div className="combat-actor-controls">
            <GMLifecycleControls key={token.id} token={token} store={store} disabled={disabled} />
            {entry?.budget && (
                <CombatBudgetView
                    budget={entry.budget}
                    onStand={
                        token.conditions?.some((c) => c.key === 'prone') && !disabled
                            ? () => store.tokenCombat(token.id, { action: 'stand-up' })
                            : undefined
                    }
                />
            )}
            {(!character || character.kind === 'npc') && (
                <div className="npc-actions" aria-label={`Действия NPC ${token.name}`}>
                    {abilities
                        .filter((a) => a.enabled !== false && !a.item_only)
                        .map((a) => {
                            const reason =
                                combatReason(a, entry?.budget) ||
                                (a.casting?.available === false ? a.casting.reason : '');
                            const damage =
                                a.damage_components
                                    ?.map((c) => `${c.dice} ${c.type}`)
                                    .join(' + ') || a.damage;
                            return (
                                <button
                                    key={a.id}
                                    disabled={disabled || busy || !!pending || !!reason}
                                    title={
                                        reason || `${a.description ?? ''} · Выбрать цель на карте`
                                    }
                                    onClick={() => {
                                        if (a.spell) setCasting(a);
                                        else choose(a);
                                    }}
                                >
                                    <strong>{a.name}</strong>
                                    <small>
                                        {[
                                            a.check?.modifier !== undefined
                                                ? `${a.check.modifier >= 0 ? '+' : ''}${a.check.modifier}`
                                                : a.attack
                                                  ? a.attack.ability.toUpperCase()
                                                  : '',
                                            a.range
                                                ? `${a.range.normal}${a.range.long ? '/' + a.range.long : ''} ft`
                                                : '',
                                            damage,
                                            reason,
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </small>
                                </button>
                            );
                        })}
                    {!abilities.length && <p className="hint">Нет подготовленных действий NPC.</p>}
                </div>
            )}
            {aiming && renderer && (
                <AbilityTargeting
                    ability={aiming}
                    actorTokenId={token.id}
                    store={store}
                    renderer={renderer}
                    onCancel={() => setAiming(null)}
                    onSelect={(target) => execute(aiming, target)}
                />
            )}
            {aiming && !renderer && <p role="alert">Для выбора цели откройте сцену.</p>}
            {casting && (
                <CastLevelChooser
                    ability={casting}
                    onClose={() => setCasting(null)}
                    onChoose={(castLevel, effectChoice) => {
                        const a = casting;
                        setCasting(null);
                        const extra = { castLevel, effectChoice };
                        setCast(extra);
                        choose(a, extra);
                    }}
                />
            )}
            {pending && !busy && (
                <div className="combat-retry">
                    <p role="alert">{error}</p>
                    <button onClick={() => void run(pending)}>Повторить с тем же ID</button>
                    <button
                        onClick={async () => {
                            store.reconcile(await api.snapshot(scene.id!));
                            setPending(null);
                            setError('');
                        }}
                    >
                        Сверить сцену
                    </button>
                </div>
            )}
            {busy && <p role="status">Разрешение действия…</p>}
            {combat && entry?.budget && (
                <details className="combat-overrides">
                    <summary>Коррекция ресурсов · GM override</summary>
                    <div className="combat-fields">
                        {(['action', 'bonus_action', 'reaction'] as const).map((key, i) => (
                            <button
                                key={key}
                                disabled={disabled || busy}
                                title="Коррекция ГМ записывается в журнал"
                                onClick={() =>
                                    store.combatCommand({
                                        action: 'override',
                                        combatId: combat.id,
                                        combatantId: entry.id,
                                        ...{
                                            [[
                                                'action_available',
                                                'bonus_available',
                                                'reaction_available',
                                            ][i]]: !entry.budget![key],
                                        },
                                    })
                                }
                            >
                                {['Действие', 'Бонус', 'Реакция'][i]}{' '}
                                {entry.budget![key] ? '●' : '○'}
                            </button>
                        ))}
                        <label>
                            Потрачено ft
                            <input
                                aria-label="Потрачено перемещения"
                                type="number"
                                disabled={disabled || busy}
                                min={0}
                                max={1000000}
                                key={entry.budget.movementSpent}
                                defaultValue={entry.budget.movementSpent}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.currentTarget.blur();
                                }}
                                onBlur={(e) => {
                                    const n = Number(e.target.value);
                                    if (
                                        e.target.value !== '' &&
                                        Number.isFinite(n) &&
                                        n >= 0 &&
                                        n <= 1000000 &&
                                        n !== entry.budget!.movementSpent
                                    )
                                        store.combatCommand({
                                            action: 'override',
                                            combatId: combat.id,
                                            combatantId: entry.id,
                                            movement_spent: n,
                                        });
                                }}
                            />
                        </label>
                    </div>
                </details>
            )}
        </div>
    );
}
