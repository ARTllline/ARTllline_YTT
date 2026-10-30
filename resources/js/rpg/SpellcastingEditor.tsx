import { useEffect, useState } from 'react';
import type { Character } from '../tabletop/types/scene';
import { api } from '../api/workspace';
import { request } from '../api/client';
import { commandId } from '../api/workspace';
import { roman, type SpellcastingState } from '../gameplay/spellcasting';
export function SpellcastingEditor({
    character,
    campaignId,
}: {
    character: Character;
    campaignId: string;
}) {
    const [state, setState] = useState<SpellcastingState>(
        () =>
            character.spellcasting ?? {
                slots: Object.fromEntries(
                    Array.from({ length: 9 }, (_, i) => [i + 1, { max: 0, current: 0 }]),
                ),
                cantrip_tier: 1,
                scroll_list: [],
                scroll_max_level: 0,
                verbal_blocked: false,
            },
    );
    const [busy, setBusy] = useState(false),
        [message, setMessage] = useState('');
    const [pending, setPending] = useState<{ id: string; name: string }[]>([]);
    useEffect(() => {
        void request<{ pending: { id: string; name: string }[] }>(
            `/campaigns/${campaignId}/spellcasting?characterId=${character.id}`,
        )
            .then((r) => setPending(r.pending))
            .catch(() => {});
    }, [campaignId, character.id, message]);
    const complete = async (ability: NonNullable<Character['abilities']>[number]) => {
        setBusy(true);
        try {
            const campaign = await api.campaign(campaignId);
            if (!campaign.activeSceneId) throw new Error('Активируйте сцену.');
            const scene = await api.snapshot(campaign.activeSceneId);
            await request(`/scenes/${scene.id}/abilities/execute`, 'POST', {
                characterId: character.id,
                abilityId: ability.id,
                castLevel: ability.spell!.level,
                manualComplete: true,
                epoch: scene.liveRevision ?? 0,
                target: null,
                rollMode: 'normal',
                clientMutationId: commandId(),
            });
            setMessage(`Сотворение ${ability.name} завершено GM.`);
        } catch (e) {
            setMessage((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const send = async (action: string, extra: object = {}) => {
        setBusy(true);
        setMessage('');
        try {
            const result = await request<{ character: Character }>(
                `/campaigns/${campaignId}/spellcasting`,
                'POST',
                { action, characterId: character.id, clientMutationId: commandId(), ...extra },
            );
            setState(result.character.spellcasting!);
            setMessage('Состояние заклинаний сохранено.');
        } catch (e) {
            setMessage((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <details className="spellcasting-editor">
            <summary>Сотворение · ячейки и свитки</summary>
            <p>Ячейки принадлежат персонажу и сохраняются после боя. Восстанавливает только GM.</p>
            <fieldset disabled={busy}>
                <div className="spell-slot-editor">
                    {Array.from({ length: 9 }, (_, i) => i + 1).map((level) => (
                        <div key={level}>
                            <b>{roman[level]}</b>
                            <label>
                                Максимум
                                <input
                                    aria-label={`Максимум ячеек ${level}`}
                                    type="number"
                                    min={0}
                                    max={99}
                                    value={state.slots[level]?.max ?? 0}
                                    onChange={(e) =>
                                        setState({
                                            ...state,
                                            slots: {
                                                ...state.slots,
                                                [level]: {
                                                    current: Math.min(
                                                        state.slots[level]?.current ?? 0,
                                                        Number(e.target.value),
                                                    ),
                                                    max: Number(e.target.value),
                                                },
                                            },
                                        })
                                    }
                                />
                            </label>
                            <label>
                                Осталось
                                <input
                                    aria-label={`Осталось ячеек ${level}`}
                                    type="number"
                                    min={0}
                                    max={state.slots[level]?.max ?? 0}
                                    value={state.slots[level]?.current ?? 0}
                                    onChange={(e) =>
                                        setState({
                                            ...state,
                                            slots: {
                                                ...state.slots,
                                                [level]: {
                                                    max: state.slots[level]?.max ?? 0,
                                                    current: Number(e.target.value),
                                                },
                                            },
                                        })
                                    }
                                />
                            </label>
                            <button type="button" onClick={() => void send('restore', { level })}>
                                Восстановить {roman[level]}
                            </button>
                        </div>
                    ))}
                </div>
                <label>
                    Текущая ступень заговоров
                    <select
                        value={state.cantrip_tier}
                        onChange={(e) =>
                            setState({ ...state, cantrip_tier: Number(e.target.value) })
                        }
                    >
                        {[1, 2, 3, 4].map((i) => (
                            <option key={i} value={i}>
                                {i} · вручную, без уровня Character
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Максимальный доступный круг для проверки свитка
                    <input
                        type="number"
                        min={0}
                        max={9}
                        value={state.scroll_max_level}
                        onChange={(e) =>
                            setState({ ...state, scroll_max_level: Number(e.target.value) })
                        }
                    />
                </label>
                <label>
                    <input
                        type="checkbox"
                        checked={state.verbal_blocked}
                        onChange={(e) => setState({ ...state, verbal_blocked: e.target.checked })}
                    />
                    Речь заблокирована (V недоступен)
                </label>
                <p>
                    Подтвердить принадлежность заклинаний свитков списку персонажа (не выдаёт знание
                    или подготовку):
                </p>
                <div className="rpg-chips">
                    {character.abilities
                        ?.filter((a) => a.spell?.source_key)
                        .map((a) => {
                            const key = a.spell!.source_key!;
                            return (
                                <button
                                    key={a.id}
                                    type="button"
                                    aria-pressed={state.scroll_list.includes(key)}
                                    onClick={() =>
                                        setState({
                                            ...state,
                                            scroll_list: state.scroll_list.includes(key)
                                                ? state.scroll_list.filter((k) => k !== key)
                                                : [...state.scroll_list, key],
                                        })
                                    }
                                >
                                    {a.name}
                                </button>
                            );
                        })}
                </div>
                <button type="button" onClick={() => void send('configure', state)}>
                    Сохранить ячейки и доступ свитков
                </button>
                <button type="button" onClick={() => void send('restore')}>
                    Восстановить все ячейки
                </button>
                <button
                    type="button"
                    onClick={() => {
                        void request<{ pending: { id: string; name: string }[] }>(
                            `/campaigns/${campaignId}/spellcasting?characterId=${character.id}`,
                        )
                            .then((r) => setPending(r.pending))
                            .catch((e) => setMessage(e.message));
                    }}
                >
                    Обновить ожидающие разрешения
                </button>
                <div className="spell-manual-history">
                    {pending.map((c) => (
                        <p key={c.id}>
                            {c.name}
                            <button
                                type="button"
                                onClick={() => void send('resolve', { executionId: c.id })}
                            >
                                Подтвердить ручное разрешение
                            </button>
                        </p>
                    ))}
                </div>
                {character.abilities
                    ?.filter(
                        (a) =>
                            a.spell?.manual_allowed &&
                            a.spell.casting_time &&
                            !/^(?:1 )?(?:Action|Bonus Action|Reaction)/i.test(a.spell.casting_time),
                    )
                    .map((a) => (
                        <button key={a.id} type="button" onClick={() => void complete(a)}>
                            GM: завершить длительное сотворение · {a.name}
                        </button>
                    ))}
            </fieldset>
            {message && <p role="status">{message}</p>}
        </details>
    );
}
