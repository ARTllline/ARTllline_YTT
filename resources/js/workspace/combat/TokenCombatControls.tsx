import { useState } from 'react';
import { Eye, EyeOff, Minus, Plus, X } from 'lucide-react';
import type { Token } from '../../tabletop/types/scene';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import { ConditionIcon, conditionKeys } from './ConditionIcon';

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
                >
                    <ConditionIcon name={condition.key} />
                    <span>{condition.label}</span>
                    {store && (
                        <>
                            <button
                                disabled={disabled}
                                title={
                                    condition.visibility === 'gm_only'
                                        ? 'GM only · make public'
                                        : 'Public · make GM only'
                                }
                                aria-label={`Change visibility of ${condition.label}`}
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
                                aria-label={`Remove ${condition.label}`}
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
                    title="Damage"
                    aria-label={`Damage ${token.name}`}
                >
                    <Minus size={13} /> Damage
                </button>
                <input
                    aria-label={`HP adjustment for ${token.name}`}
                    type="number"
                    min={-9999}
                    max={9999}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    title="Signed change: Enter applies + / −"
                />
                <button
                    type="button"
                    disabled={disabled || !valid}
                    onClick={() => adjust(Math.abs(value))}
                    title="Heal"
                    aria-label={`Heal ${token.name}`}
                >
                    <Plus size={13} /> Heal
                </button>
                <button className="sr-only" type="submit" disabled={disabled || !valid}>
                    Apply signed HP change
                </button>
            </form>
            <ConditionList token={token} store={store} disabled={disabled} />
            <form
                className="condition-add"
                onSubmit={(e) => {
                    e.preventDefault();
                    store.tokenCombat(token.id, {
                        action: 'condition-add',
                        ...(condition === 'custom' ? { label: label.trim() } : { key: condition }),
                        visibility: secret ? 'gm_only' : 'public',
                    });
                }}
            >
                <select
                    aria-label={`Condition for ${token.name}`}
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                >
                    {conditionKeys.map((key) => (
                        <option key={key} value={key}>
                            {key[0].toUpperCase() + key.slice(1)}
                        </option>
                    ))}
                    <option value="custom">Custom condition…</option>
                </select>
                <button
                    disabled={disabled || (condition === 'custom' && !label.trim())}
                    type="submit"
                    aria-label={`Add condition to ${token.name}`}
                >
                    <Plus size={14} /> Add
                </button>
                {condition === 'custom' && (
                    <input
                        placeholder="Condition name"
                        aria-label="Custom condition name"
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
                    <EyeOff size={12} /> GM only
                </label>
            </form>
        </div>
    );
}
