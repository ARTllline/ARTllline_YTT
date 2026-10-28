import { useState } from 'react';
export function NumberField({
    label,
    value,
    onChange,
    min,
    max,
    step = 1,
    disabled = false,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
        if (draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft)))
            onChange(Number(draft));
        setDraft(null);
    };
    return (
        <label className="field">
            <span>{label}</span>
            <input
                type="number"
                value={draft ?? Math.round(value * 100) / 100}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') {
                        event.stopPropagation();
                        setDraft(null);
                    }
                }}
            />
        </label>
    );
}
