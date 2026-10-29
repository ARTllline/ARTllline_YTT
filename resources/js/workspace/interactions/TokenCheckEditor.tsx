import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Token, CheckStat } from '../../tabletop/types/scene';
import type { SceneStore } from '../../tabletop/state/SceneStore';

const presets: CheckStat[] = [
    { key: 'perception', label: 'Внимательность', modifier: 0 },
    { key: 'strength', label: 'Сила', modifier: 0 },
    { key: 'dexterity', label: 'Ловкость', modifier: 0 },
    { key: 'magic', label: 'Магия', modifier: 0 },
];

export function TokenCheckEditor({
    token,
    store,
    disabled,
}: {
    token: Token;
    store: SceneStore;
    disabled: boolean;
}) {
    return (
        <CheckStatsEditor
            stats={token.checkStats ?? []}
            save={(next) => store.updateToken(token.id, { checkStats: next })}
            disabled={disabled}
        />
    );
}

export function CheckStatsEditor({
    stats,
    save,
    disabled,
}: {
    stats: CheckStat[];
    save: (next: CheckStat[]) => void;
    disabled: boolean;
}) {
    const [key, setKey] = useState('');
    const [label, setLabel] = useState('');
    return (
        <details className="inspector-section token-check-editor">
            <summary>Модификаторы проверок · {stats.length}</summary>
            <section>
                <p className="hint">
                    Значения персонажа для проверок объектов. Ключ остаётся постоянным.
                </p>
                {stats.map((stat) => (
                    <div className="token-check-row" key={stat.key}>
                        <label>
                            <span>{stat.key}</span>
                            <input
                                aria-label={`Название ${stat.key}`}
                                value={stat.label}
                                maxLength={80}
                                disabled={disabled}
                                onChange={(e) =>
                                    save(
                                        stats.map((s) =>
                                            s.key === stat.key
                                                ? { ...s, label: e.target.value }
                                                : s,
                                        ),
                                    )
                                }
                            />
                        </label>
                        <input
                            aria-label={`Модификатор ${stat.key}`}
                            type="number"
                            min={-100}
                            max={100}
                            value={stat.modifier}
                            disabled={disabled}
                            onChange={(e) =>
                                save(
                                    stats.map((s) =>
                                        s.key === stat.key
                                            ? { ...s, modifier: Number(e.target.value) }
                                            : s,
                                    ),
                                )
                            }
                        />
                        <button
                            className="icon-button"
                            aria-label={`Удалить ${stat.label}`}
                            disabled={disabled}
                            onClick={() => save(stats.filter((s) => s.key !== stat.key))}
                        >
                            <X size={14} />
                        </button>
                    </div>
                ))}
                <div className="check-presets">
                    {presets
                        .filter((p) => !stats.some((s) => s.key === p.key))
                        .map((preset) => (
                            <button
                                className="quiet-button"
                                key={preset.key}
                                disabled={disabled || stats.length >= 30}
                                onClick={() => save([...stats, preset])}
                            >
                                <Plus size={12} />
                                {preset.label}
                            </button>
                        ))}
                </div>
                <div className="check-custom">
                    <input
                        aria-label="Новый ключ проверки"
                        placeholder="stealth"
                        value={key}
                        maxLength={48}
                        onChange={(e) => setKey(e.target.value)}
                    />
                    <input
                        aria-label="Новое название проверки"
                        placeholder="Скрытность"
                        value={label}
                        maxLength={80}
                        onChange={(e) => setLabel(e.target.value)}
                    />
                    <button
                        className="secondary-button"
                        disabled={
                            disabled ||
                            stats.length >= 30 ||
                            !/^[a-z][a-z0-9_]*$/.test(key) ||
                            !label.trim() ||
                            stats.some((s) => s.key === key)
                        }
                        onClick={() => {
                            save([...stats, { key, label: label.trim(), modifier: 0 }]);
                            setKey('');
                            setLabel('');
                        }}
                    >
                        Добавить
                    </button>
                </div>
            </section>
        </details>
    );
}
