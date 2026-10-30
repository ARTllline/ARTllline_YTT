import { useState } from 'react';
import { ApiError, request } from '../../api/client';
import { api, commandId } from '../../api/workspace';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { Token } from '../../tabletop/types/scene';

interface Consequence {
    name: string;
    trigger: 'on_zero_hp' | 'on_defeat' | 'on_death';
    description: string;
    reference?: string;
}
export function NpcLifecycleEditor({ token, store }: { token: Token; store: SceneStore }) {
    const [policy, setPolicy] = useState(
        String(token.combatProfile?.zero_hp_policy ?? 'immediate_death'),
    );
    const [effects, setEffects] = useState<Consequence[]>(
        (token.combatProfile?.lifecycle_consequences as Consequence[] | undefined) ?? [],
    );
    const [pending, setPending] = useState<Record<string, unknown> | null>(null);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    if (token.kind !== 'npc') return null;
    const patch = (i: number, data: Partial<Consequence>) =>
        setEffects(effects.map((e, index) => (index === i ? { ...e, ...data } : e)));
    const save = async (body: Record<string, unknown>) => {
        setBusy(true);
        setError('');
        setPending(body);
        try {
            await request(`/tokens/${token.id}`, 'PATCH', body);
            setPending(null);
            store.reconcile(await api.snapshot(store.getSnapshot().scene.id!));
        } catch (e) {
            setError((e as Error).message);
            if (e instanceof ApiError && e.status < 500) setPending(null);
        } finally {
            setBusy(false);
        }
    };
    return (
        <details className="npc-lifecycle-editor">
            <summary>NPC · правило 0 HP и подготовленные последствия</summary>
            <div className="rest-actions">
                {(
                    [
                        ['immediate_death', 'Смерть при 0 HP'],
                        ['death_saves', 'Death Saves'],
                        ['manual', 'Решение ГМ'],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        key={key}
                        aria-pressed={policy === key}
                        disabled={busy || !!pending}
                        onClick={() => setPolicy(key)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <p className="hint">
                Неописанная механика остаётся ручной задачей. Её текст появится прямо в GM Combat
                Console.
            </p>
            {effects.map((effect, i) => (
                <div className="rest-confirm" key={i}>
                    <label>
                        Название
                        <input
                            value={effect.name}
                            maxLength={80}
                            onChange={(e) => patch(i, { name: e.target.value })}
                        />
                    </label>
                    <div className="rest-actions">
                        {(['on_zero_hp', 'on_defeat', 'on_death'] as const).map((trigger) => (
                            <button
                                key={trigger}
                                aria-pressed={effect.trigger === trigger}
                                onClick={() => patch(i, { trigger })}
                            >
                                {trigger}
                            </button>
                        ))}
                    </div>
                    <label>
                        Подготовленное правило
                        <textarea
                            value={effect.description}
                            maxLength={12000}
                            onChange={(e) => patch(i, { description: e.target.value })}
                        />
                    </label>
                    <label>
                        Источник
                        <input
                            value={effect.reference ?? ''}
                            maxLength={500}
                            onChange={(e) => patch(i, { reference: e.target.value })}
                        />
                    </label>
                    <button onClick={() => setEffects(effects.filter((_, index) => index !== i))}>
                        Убрать последствие
                    </button>
                </div>
            ))}
            <button
                disabled={effects.length >= 6 || busy || !!pending}
                onClick={() =>
                    setEffects([
                        ...effects,
                        { name: 'Последствие', trigger: 'on_death', description: '' },
                    ])
                }
            >
                + Последствие
            </button>
            <button
                disabled={busy || !!pending}
                onClick={() =>
                    void save({
                        combat_profile: {
                            ...token.combatProfile,
                            zero_hp_policy: policy,
                            lifecycle_consequences: effects,
                        },
                        clientMutationId: commandId(),
                    })
                }
            >
                Сохранить правило NPC
            </button>
            {error && <p role="alert">{error}</p>}
            {pending && !busy && (
                <button onClick={() => void save(pending)}>Повторить сохранение с тем же ID</button>
            )}
        </details>
    );
}
