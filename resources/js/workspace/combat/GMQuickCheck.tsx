import { useState } from 'react';
import { ApiError, request } from '../../api/client';
import { commandId, api } from '../../api/workspace';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import { RollDetail } from './CombatResults';
import type { SessionRoll } from './sessionModel';
export function GMQuickCheck({
    store,
    tokenId,
    disabled,
}: {
    store: SceneStore;
    tokenId?: string;
    disabled: boolean;
}) {
    const [stat, setStat] = useState('save_dex'),
        [custom, setCustom] = useState('wis'),
        [dc, setDc] = useState('');
    const [secret, setSecret] = useState(true),
        [dcVisible, setDcVisible] = useState(false),
        [batch, setBatch] = useState(false);
    const [error, setError] = useState(''),
        [busy, setBusy] = useState(false);
    const [pending, setPending] = useState<Record<string, unknown> | null>(null);
    const [outcomes, setOutcomes] = useState<
        {
            tokenId: string;
            name: string;
            roll: SessionRoll;
            provenance: { breakdown?: { label: string; value: number }[] };
        }[]
    >([]);
    const { scene, selectedIds } = store.getSnapshot();
    const ids = batch ? selectedIds : tokenId ? [tokenId] : [];
    const run = async (body: Record<string, unknown>) => {
        setBusy(true);
        setError('');
        setPending(body);
        try {
            const r = await request<{ outcomes: typeof outcomes }>(
                `/scenes/${scene.id}/combat/session`,
                'POST',
                body,
            );
            setOutcomes(r.outcomes);
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
    if (store.role !== 'gm') return null;
    return (
        <details className="gm-quick-check">
            <summary>Проверка / спасбросок</summary>
            <div className="check-stat-chips">
                {['save_dex', 'save_wis', 'save_con', 'perception', 'athletics', 'custom'].map(
                    (k, i) => (
                        <button key={k} aria-pressed={stat === k} onClick={() => setStat(k)}>
                            {
                                [
                                    'DEX save',
                                    'WIS save',
                                    'CON save',
                                    'Восприятие',
                                    'Атлетика',
                                    'Другая',
                                ][i]
                            }
                        </button>
                    ),
                )}
            </div>
            {stat === 'custom' && (
                <input
                    aria-label="Ключ проверки"
                    placeholder="save_str, investigation…"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                />
            )}
            <label>
                Сл (необязательно)
                <input
                    aria-label="Сл проверки"
                    type="number"
                    min={0}
                    max={100}
                    value={dc}
                    onChange={(e) => setDc(e.target.value)}
                />
            </label>
            <label>
                <input
                    type="checkbox"
                    checked={batch}
                    onChange={(e) => setBatch(e.target.checked)}
                />
                Выбранные на карте ({selectedIds.length})
            </label>
            <label>
                <input
                    type="checkbox"
                    checked={secret}
                    onChange={(e) => setSecret(e.target.checked)}
                />
                Результаты только ГМ
            </label>
            {!secret && (
                <label>
                    <input
                        type="checkbox"
                        checked={dcVisible}
                        onChange={(e) => setDcVisible(e.target.checked)}
                    />
                    Показывать Сл игрокам
                </label>
            )}
            <button
                disabled={
                    disabled ||
                    busy ||
                    !!pending ||
                    !ids.length ||
                    (dc !== '' &&
                        (!Number.isInteger(Number(dc)) || Number(dc) < 0 || Number(dc) > 100))
                }
                onClick={() =>
                    void run({
                        action: 'check',
                        tokenIds: ids,
                        stat: stat === 'custom' ? custom : stat,
                        dc: dc === '' ? null : Number(dc),
                        visibility: secret ? 'gm_only' : 'public',
                        dcVisible: !secret && dcVisible,
                        clientMutationId: commandId(),
                    })
                }
            >
                Бросить · {ids.length}
            </button>
            {outcomes.map((o) => (
                <details key={o.tokenId}>
                    <summary>
                        {o.name} · {o.roll.total}
                        {o.roll.dc !== undefined
                            ? ` / Сл ${o.roll.dc} · ${o.roll.success ? 'успех' : 'провал'}`
                            : ''}
                    </summary>
                    <RollDetail roll={o.roll} breakdown={o.provenance.breakdown} />
                </details>
            ))}
            {error && <p role="alert">{error}</p>}
            {pending && !busy && (
                <button onClick={() => void run(pending)}>Повторить с тем же ID</button>
            )}
        </details>
    );
}
