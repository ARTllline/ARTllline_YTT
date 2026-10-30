import { t, conditionLabel } from '../../i18n';
import { useEffect, useState } from 'react';
import { request } from '../../api/client';
import { Eye, EyeOff, Minus, Plus, X } from 'lucide-react';
import type { Token } from '../../tabletop/types/scene';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import { ConditionIcon } from './ConditionIcon';
import { durationOptions } from '../../gameplay/CombatAbilityEditor';

export function ConditionList({
    token,
    store,
    disabled = false,
}: {
    token: Token;
    store?: SceneStore;
    disabled?: boolean;
}) {
    return (
        <div className="condition-list">
            {token.conditions?.map((condition) => (
                <span
                    className={`condition-chip ${condition.visibility === 'gm_only' ? 'secret' : ''}`}
                    key={condition.id}
                    title={`${conditionLabel(condition)}${condition.remainingRounds ? ` · ${condition.remainingRounds} раунд.` : condition.durationMode && condition.durationMode !== 'until_removed' ? ` · ${durationOptions.find(([v]) => v === condition.durationMode)?.[1] ?? condition.durationMode}` : ''}`}
                >
                    <ConditionIcon name={condition.key} />
                    <span>{conditionLabel(condition)}</span>
                    {store && (
                        <>
                            <button
                                disabled={disabled}
                                title={
                                    condition.visibility === 'gm_only'
                                        ? t('GM only · make public')
                                        : t('Public · make GM only')
                                }
                                aria-label={t('conditionVisibility', {
                                    name: conditionLabel(condition),
                                })}
                                onClick={() =>
                                    store.tokenCombat(token.id, {
                                        action: 'condition-visibility',
                                        conditionId: condition.id,
                                        visibility:
                                            condition.visibility === 'gm_only'
                                                ? 'public'
                                                : 'gm_only',
                                    })
                                }
                            >
                                {condition.visibility === 'gm_only' ? (
                                    <EyeOff size={12} />
                                ) : (
                                    <Eye size={12} />
                                )}
                            </button>
                            <button
                                disabled={disabled}
                                aria-label={t('conditionRemove', {
                                    name: conditionLabel(condition),
                                })}
                                onClick={() =>
                                    store.tokenCombat(token.id, {
                                        action: 'condition-remove',
                                        conditionId: condition.id,
                                    })
                                }
                            >
                                <X size={12} />
                            </button>
                        </>
                    )}
                </span>
            ))}
        </div>
    );
}

export function TokenCombatControls({
    token,
    store,
    disabled,
}: {
    token: Token;
    store: SceneStore;
    disabled: boolean;
}) {
    const [amount, setAmount] = useState('5');
    const [condition, setCondition] = useState('poisoned');
    const [label, setLabel] = useState('');
    const [secret, setSecret] = useState(false);
    const [duration, setDuration] = useState('until_removed');
    const [rounds, setRounds] = useState(1);
    const [source, setSource] = useState('');
    const [definitions, setDefinitions] = useState<{ key: string; name: string }[]>([]);
    const [catalogError, setCatalogError] = useState('');
    const campaign = store.getSnapshot().scene.campaignId;
    useEffect(() => {
        if (!campaign) return;
        const abort = new AbortController();
        void request<{ conditions: { key: string; name: string }[] }>(
            `/campaigns/${campaign}/character-rules/catalog`,
            'GET',
            undefined,
            abort.signal,
        )
            .then((r) => {
                if (!abort.signal.aborted) {
                    setDefinitions(r.conditions);
                    setCatalogError('');
                }
            })
            .catch((e: Error) => {
                if (!abort.signal.aborted) setCatalogError(e.message);
            });
        return () => abort.abort();
    }, [campaign]);
    const value = Number(amount);
    const valid = amount.trim() !== '' && Number.isInteger(value) && Math.abs(value) <= 9999;
    const adjust = (delta: number) => {
        if (valid) store.tokenCombat(token.id, { action: 'hp', delta });
    };
    return (
        <div className="token-combat-controls">
            <form
                className="hp-actions"
                onSubmit={(e) => {
                    e.preventDefault();
                    adjust(value);
                }}
            >
                <button
                    type="button"
                    disabled={disabled || !valid}
                    onClick={() => adjust(-Math.abs(value))}
                    title={t('Damage')}
                    aria-label={t('damageToken', { name: token.name })}
                >
                    <Minus size={13} /> {t('Damage')}{' '}
                </button>
                <input
                    aria-label={t('adjustHP', { name: token.name })}
                    type="number"
                    min={-9999}
                    max={9999}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    title={t('Signed change: Enter applies + / −')}
                />
                <button
                    type="button"
                    disabled={disabled || !valid}
                    onClick={() => adjust(Math.abs(value))}
                    title={t('Heal')}
                    aria-label={t('healToken', { name: token.name })}
                >
                    <Plus size={13} /> {t('Heal')}{' '}
                </button>
                <button className="sr-only" type="submit" disabled={disabled || !valid}>
                    {' '}
                    {t('Apply signed HP change')}{' '}
                </button>
            </form>
            <ConditionList token={token} store={store} disabled={disabled} />
            <details className="condition-disclosure">
                <summary>Добавить состояние</summary>
                {catalogError && (
                    <p role="alert" className="form-error">
                        {catalogError}
                    </p>
                )}
                <form
                    className="condition-add"
                    onSubmit={(e) => {
                        e.preventDefault();
                        store.tokenCombat(token.id, {
                            action: 'condition-add',
                            ...(condition === 'custom'
                                ? { label: label.trim() }
                                : { key: condition }),
                            visibility: secret ? 'gm_only' : 'public',
                            duration_mode: duration,
                            rounds,
                            ...(source ? { source_token_id: source } : {}),
                        });
                    }}
                >
                    <select
                        aria-label={t('tokenCondition', { name: token.name })}
                        value={condition}
                        onChange={(e) => setCondition(e.target.value)}
                    >
                        {definitions.map(({ key, name }) => (
                            <option key={key} value={key}>
                                {conditionLabel({ key, label: name })}
                            </option>
                        ))}
                        <option value="concentrating">
                            {conditionLabel({ key: 'concentrating', label: 'Concentrating' })}
                        </option>
                        <option value="custom"> {t('Custom condition…')} </option>
                    </select>
                    <button
                        disabled={
                            disabled ||
                            (condition === 'custom'
                                ? !label.trim()
                                : condition !== 'concentrating' &&
                                  !definitions.some((d) => d.key === condition))
                        }
                        type="submit"
                        aria-label={t('addCondition', { name: token.name })}
                    >
                        <Plus size={14} /> {t('Add')}{' '}
                    </button>
                    {condition === 'custom' && (
                        <input
                            placeholder={t('Condition name')}
                            aria-label={t('Custom condition name')}
                            maxLength={40}
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                        />
                    )}
                    <label className="condition-private">
                        <input
                            type="checkbox"
                            checked={secret}
                            onChange={(e) => setSecret(e.target.checked)}
                        />
                        <EyeOff size={12} /> {t('GM only')}{' '}
                    </label>
                    <select
                        aria-label="Длительность состояния"
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                    >
                        {durationOptions.map(([v, n]) => (
                            <option key={v} value={v}>
                                {n}
                            </option>
                        ))}
                    </select>
                    {duration === 'rounds' && (
                        <input
                            aria-label="Осталось раундов"
                            type="number"
                            min={1}
                            max={100}
                            value={rounds}
                            onChange={(e) => setRounds(Number(e.target.value))}
                        />
                    )}
                    {duration.includes('source') && (
                        <select
                            aria-label="Источник состояния"
                            value={source}
                            onChange={(e) => setSource(e.target.value)}
                        >
                            <option value="">Выберите источник</option>
                            {store.getSnapshot().scene.tokens.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.name}
                                </option>
                            ))}
                        </select>
                    )}
                </form>
            </details>
        </div>
    );
}
