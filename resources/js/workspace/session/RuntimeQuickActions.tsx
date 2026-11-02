import { useEffect, useState } from 'react';
import { request } from '../../api/client';
import { conditionLabel } from '../../i18n';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { Token } from '../../tabletop/types/scene';
import { ConditionList } from '../combat/TokenCombatControls';

export function RuntimeQuickActions({
    token,
    store,
    disabled,
}: {
    token: Token;
    store: SceneStore;
    disabled: boolean;
}) {
    const [mode, setMode] = useState<'damage' | 'heal' | 'condition' | null>(null);
    const [amount, setAmount] = useState('5');
    const [search, setSearch] = useState('');
    const [conditions, setConditions] = useState<{ key: string; name: string }[]>([]);
    const [error, setError] = useState('');
    const campaign = store.getSnapshot().scene.campaignId;
    useEffect(() => {
        if (mode !== 'condition' || !campaign) return;
        const abort = new AbortController();
        void request<{ conditions: typeof conditions }>(
            `/campaigns/${campaign}/character-rules/catalog`,
            'GET',
            undefined,
            abort.signal,
        )
            .then((r) => {
                if (!abort.signal.aborted) {
                    setConditions(r.conditions);
                    setError('');
                }
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [mode, campaign]);
    const value = Number(amount),
        valid = Number.isInteger(value) && value > 0 && value <= 9999;
    return (
        <div
            className="runtime-quick-actions"
            onKeyDown={(e) => {
                if (e.key === 'Escape' && mode) {
                    e.stopPropagation();
                    setMode(null);
                }
            }}
        >
            <ConditionList token={token} store={store} disabled={disabled} />
            <div className="runtime-quick-row">
                <button
                    disabled={disabled}
                    aria-label={`Урон: ${token.name}`}
                    aria-expanded={mode === 'damage'}
                    onClick={() => setMode(mode === 'damage' ? null : 'damage')}
                >
                    − Урон
                </button>
                <button
                    disabled={disabled}
                    aria-label={`Лечение: ${token.name}`}
                    aria-expanded={mode === 'heal'}
                    onClick={() => setMode(mode === 'heal' ? null : 'heal')}
                >
                    + Лечение
                </button>
                <button
                    disabled={disabled}
                    aria-expanded={mode === 'condition'}
                    onClick={() => setMode(mode === 'condition' ? null : 'condition')}
                >
                    Состояние +
                </button>
            </div>
            {mode && (
                <div
                    className="runtime-popover"
                    role="region"
                    aria-label={mode === 'condition' ? 'Добавить состояние' : 'Изменение HP'}
                >
                    <header>
                        <strong>
                            {mode === 'condition'
                                ? 'Добавить состояние'
                                : mode === 'damage'
                                  ? 'Нанести урон'
                                  : 'Восстановить HP'}
                        </strong>
                        <button aria-label="Закрыть быстрые действия" onClick={() => setMode(null)}>
                            ×
                        </button>
                    </header>
                    {mode === 'condition' ? (
                        <>
                            <input
                                autoFocus
                                aria-label="Найти состояние"
                                placeholder="Найти состояние…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                            <div className="runtime-condition-options">
                                {conditions
                                    .filter((c) =>
                                        `${c.name} ${conditionLabel({ key: c.key, label: c.name })}`
                                            .toLowerCase()
                                            .includes(search.toLowerCase()),
                                    )
                                    .map((c) => (
                                        <button
                                            key={c.key}
                                            disabled={disabled}
                                            onClick={() => {
                                                store.tokenCombat(token.id, {
                                                    action: 'condition-add',
                                                    key: c.key,
                                                    visibility: 'public',
                                                    duration_mode: 'until_removed',
                                                    rounds: 1,
                                                });
                                                setMode(null);
                                            }}
                                        >
                                            {conditionLabel({ key: c.key, label: c.name })}
                                        </button>
                                    ))}
                            </div>
                            {error && <p role="alert">{error}</p>}
                            {!error && !conditions.length && (
                                <p role="status">Загрузка состояний…</p>
                            )}
                            <small>Публичное · до снятия</small>
                        </>
                    ) : (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (valid && !disabled) {
                                    store.tokenCombat(token.id, {
                                        action: 'hp',
                                        delta: mode === 'damage' ? -value : value,
                                    });
                                    setMode(null);
                                }
                            }}
                        >
                            <div className="runtime-amounts">
                                {[1, 5, 10, 20].map((n) => (
                                    <button
                                        type="button"
                                        key={n}
                                        aria-pressed={value === n}
                                        onClick={() => setAmount(String(n))}
                                    >
                                        {n}
                                    </button>
                                ))}
                            </div>
                            <div className="runtime-apply">
                                <input
                                    autoFocus
                                    type="number"
                                    min={1}
                                    max={9999}
                                    aria-label="Количество HP"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                />
                                <button disabled={disabled || !valid}>
                                    {mode === 'damage' ? 'Нанести' : 'Восстановить'}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            )}
        </div>
    );
}
