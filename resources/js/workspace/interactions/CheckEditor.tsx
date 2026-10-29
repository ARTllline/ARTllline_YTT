import {
    interactions,
    type CheckHistory,
    type InteractionCheck,
    type InteractionResources,
    type InteractionResult,
} from './model';
import { useEffect, useState } from 'react';

export const defaultCheck = (): InteractionCheck => ({
    enabled: true,
    label: 'Внимательность',
    ability_key: 'perception',
    dc: 15,
    dc_visible: false,
    modifier: 0,
    retry: 'once_per_player',
    success: { result_type: 'nothing' },
    failure: { result_type: 'nothing' },
});

function Branch({
    label,
    value,
    resources,
    onChange,
}: {
    label: string;
    value: InteractionResult;
    resources: InteractionResources | null;
    onChange: (next: InteractionResult) => void;
}) {
    const options = value.result_type === 'cue' ? resources?.cues : resources?.handouts;
    return (
        <label className="check-branch">
            {label}
            <div className="interaction-result">
                <select
                    aria-label={`${label}: результат`}
                    value={value.result_type}
                    onChange={(e) =>
                        onChange({
                            result_type: e.target.value as InteractionResult['result_type'],
                        })
                    }
                >
                    <option value="nothing">Ничего</option>
                    <option value="handout">Показать Handout</option>
                    <option value="cue">Запустить Cue</option>
                </select>
                {value.result_type !== 'nothing' && (
                    <select
                        aria-label={`${label}: цель`}
                        value={value.result_target ?? ''}
                        onChange={(e) => onChange({ ...value, result_target: e.target.value })}
                    >
                        <option value="">Выберите…</option>
                        {value.result_target &&
                            !options?.some((item) => item.id === value.result_target) && (
                                <option value={value.result_target}>Цель недоступна</option>
                            )}
                        {options?.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.name}
                            </option>
                        ))}
                    </select>
                )}
            </div>
        </label>
    );
}
export function CheckEditor({
    value,
    resources,
    onChange,
}: {
    value: InteractionCheck;
    resources: InteractionResources | null;
    onChange: (next: InteractionCheck) => void;
}) {
    const patch = (change: Partial<InteractionCheck>) => onChange({ ...value, ...change });
    return (
        <div className="check-editor">
            <label>
                Проверка
                <input
                    aria-label="Название проверки"
                    value={value.label}
                    maxLength={80}
                    onChange={(e) => patch({ label: e.target.value })}
                />
            </label>
            <div className="check-numbers">
                <label>
                    DC
                    <input
                        aria-label="DC проверки"
                        type="number"
                        min={1}
                        max={100}
                        value={value.dc ?? 15}
                        onChange={(e) => patch({ dc: Number(e.target.value) })}
                    />
                </label>
                <label>
                    Модификатор
                    <input
                        aria-label="Модификатор проверки"
                        type="number"
                        min={-100}
                        max={100}
                        value={value.modifier ?? 0}
                        onChange={(e) => patch({ modifier: Number(e.target.value) })}
                    />
                </label>
            </div>
            <label>
                Повтор
                <select
                    aria-label="Повтор проверки"
                    value={value.retry}
                    onChange={(e) => patch({ retry: e.target.value as InteractionCheck['retry'] })}
                >
                    <option value="once">Один раз</option>
                    <option value="once_per_player">Один раз на игрока</option>
                    <option value="repeatable">Повторяемая</option>
                </select>
            </label>
            <Branch
                label="Успех"
                value={value.success!}
                resources={resources}
                onChange={(success) => patch({ success })}
            />
            <Branch
                label="Провал"
                value={value.failure!}
                resources={resources}
                onChange={(failure) => patch({ failure })}
            />
            <details>
                <summary>Дополнительно</summary>
                <label className="check-toggle">
                    <input
                        type="checkbox"
                        checked={!!value.dc_visible}
                        onChange={(e) => patch({ dc_visible: e.target.checked })}
                    />
                    Показывать DC игроку
                </label>
                <label>
                    Ключ проверки
                    <input
                        aria-label="Ключ проверки"
                        value={value.ability_key ?? ''}
                        maxLength={48}
                        onChange={(e) => patch({ ability_key: e.target.value })}
                    />
                </label>
                <p className="hint">
                    Сравнивается d20 + модификатор с DC. Натуральные 1 и 20 не меняют правило.
                </p>
            </details>
        </div>
    );
}

export function CheckHistoryList({
    sceneId,
    kind,
    id,
}: {
    sceneId: string;
    kind: 'token' | 'prop';
    id: string;
}) {
    const [open, setOpen] = useState(false);
    const [checks, setChecks] = useState<CheckHistory[]>([]);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!open) return;
        const abort = new AbortController();
        const refresh = () => {
            void interactions
                .history(sceneId, kind, id, abort.signal)
                .then((result) => {
                    setChecks(result.checks);
                    setError('');
                })
                .catch((e) => {
                    if (!abort.signal.aborted) setError(e.message);
                });
        };
        refresh();
        const timer = setInterval(refresh, 5000);
        return () => {
            abort.abort();
            clearInterval(timer);
        };
    }, [open, sceneId, kind, id]);
    return (
        <details className="check-history" onToggle={(e) => setOpen(e.currentTarget.open)}>
            <summary>Недавние проверки</summary>
            {error && (
                <p className="error" role="alert">
                    {error}
                </p>
            )}
            {checks.map((check) => (
                <div key={check.id}>
                    <strong>
                        {check.actor.name} · {check.actionLabel}
                    </strong>
                    <span>
                        {check.label}: {check.natural} {check.modifier < 0 ? '−' : '+'}{' '}
                        {Math.abs(check.modifier)} = {check.total} · DC {check.dc} ·{' '}
                        {check.success ? 'Успех' : 'Провал'}
                    </span>
                    <time dateTime={check.rolledAt}>
                        {new Date(check.rolledAt).toLocaleString()}
                    </time>
                </div>
            ))}
            {!checks.length && <p className="hint">Проверок пока нет.</p>}
        </details>
    );
}
