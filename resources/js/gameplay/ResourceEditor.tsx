import { Plus, Trash2 } from 'lucide-react';
import type { CharacterResource } from './model';
import { gameplayIcon, gameplayIcons, iconLabels } from './icons';

export function ResourceEditor({
    resources,
    onChange,
    sheet = false,
}: {
    resources: CharacterResource[];
    onChange: (r: CharacterResource[]) => void;
    sheet?: boolean;
}) {
    const patch = (index: number, data: Partial<CharacterResource>) =>
        onChange(resources.map((r, i) => (i === index ? { ...r, ...data } : r)));
    const Settings = sheet ? 'details' : 'div';
    return (
        <section className="gameplay-editor-section">
            <header>
                <div>
                    <span className="eyebrow">ЗАПАС СИЛ</span>
                    <h4>Ресурсы</h4>
                </div>
                <button
                    type="button"
                    className="quiet-button"
                    disabled={resources.length >= 12}
                    onClick={() =>
                        onChange([
                            ...resources,
                            {
                                key: `resource_${Date.now()}`,
                                label: 'Новый ресурс',
                                current: 3,
                                max: 3,
                                icon: 'spark',
                                accent: 'violet',
                                sort_order: resources.length,
                                player_adjustable: false,
                            },
                        ])
                    }
                >
                    <Plus size={14} /> Ресурс
                </button>
            </header>
            {!resources.length && (
                <p className="hint">Мана, фокус, заряды — задайте свои названия и пределы.</p>
            )}
            <div className={sheet ? 'sheet-resources' : undefined}>
                {resources.map((r, i) => {
                    const Icon = gameplayIcon(r.icon);
                    return (
                        <div
                            key={r.key}
                            className={`resource-editor-card ${sheet ? 'sheet-resource' : ''}`}
                            data-accent={r.accent}
                        >
                            {sheet && (
                                <>
                                    <header>
                                        <Icon size={22} />
                                        <h3>{r.label}</h3>
                                        <small>
                                            {r.recovery === 'short_rest'
                                                ? 'Короткий отдых'
                                                : r.recovery === 'long_rest'
                                                  ? 'Долгий отдых'
                                                  : 'Вручную'}
                                        </small>
                                    </header>
                                    <div className="sheet-resource-value">
                                        <strong>{r.current}</strong>
                                        <span>/ {r.max}</span>
                                    </div>
                                    <progress
                                        aria-label={`${r.label}: запас`}
                                        value={r.current}
                                        max={r.max}
                                    />
                                    {r.max <= 12 && (
                                        <div
                                            className="sheet-pips"
                                            role="group"
                                            aria-label={`${r.label}: потратить или восстановить`}
                                        >
                                            {Array.from({ length: Math.max(0, r.max) }, (_, n) => (
                                                <button
                                                    type="button"
                                                    key={n}
                                                    aria-label={`${r.label}: установить ${n + 1 === r.current ? n : n + 1}`}
                                                    aria-pressed={n < r.current}
                                                    onClick={() =>
                                                        patch(i, {
                                                            current:
                                                                n + 1 === r.current ? n : n + 1,
                                                        })
                                                    }
                                                />
                                            ))}
                                        </div>
                                    )}
                                    <div className="sheet-counter">
                                        <button
                                            type="button"
                                            aria-label={`Потратить: ${r.label}`}
                                            disabled={r.current <= 0}
                                            onClick={() =>
                                                patch(i, { current: Math.max(0, r.current - 1) })
                                            }
                                        >
                                            −
                                        </button>
                                        <input
                                            aria-label={`Сейчас: ${r.label}`}
                                            type="number"
                                            min={0}
                                            max={r.max}
                                            value={r.current}
                                            onChange={(e) =>
                                                patch(i, {
                                                    current: Math.max(
                                                        0,
                                                        Math.min(r.max, Number(e.target.value)),
                                                    ),
                                                })
                                            }
                                        />
                                        <button
                                            type="button"
                                            aria-label={`Восстановить: ${r.label}`}
                                            disabled={r.current >= r.max}
                                            onClick={() =>
                                                patch(i, {
                                                    current: Math.min(r.max, r.current + 1),
                                                })
                                            }
                                        >
                                            +
                                        </button>
                                        <button
                                            type="button"
                                            disabled={r.current === r.max}
                                            onClick={() => patch(i, { current: r.max })}
                                        >
                                            До максимума
                                        </button>
                                    </div>
                                </>
                            )}
                            <Settings className={sheet ? 'sheet-advanced' : undefined}>
                                {sheet && <summary>Advanced · настройка ресурса</summary>}
                                <div className="gameplay-form-row">
                                    <label>
                                        Название
                                        <input
                                            aria-label={`Ресурс ${i + 1}`}
                                            value={r.label}
                                            maxLength={40}
                                            onChange={(e) => patch(i, { label: e.target.value })}
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        className="icon-button"
                                        aria-label={`Удалить ${r.label}`}
                                        onClick={() =>
                                            onChange(resources.filter((_, n) => n !== i))
                                        }
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                <div className="gameplay-form-row">
                                    <label>
                                        Сейчас
                                        <input
                                            type="number"
                                            min={0}
                                            max={r.max}
                                            value={r.current}
                                            onChange={(e) =>
                                                patch(i, {
                                                    current: Math.max(
                                                        0,
                                                        Math.min(r.max, Number(e.target.value)),
                                                    ),
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Максимум
                                        <input
                                            type="number"
                                            min={1}
                                            max={9999}
                                            value={r.max}
                                            onChange={(e) => {
                                                const max = Math.max(
                                                    1,
                                                    Math.min(9999, Number(e.target.value)),
                                                );
                                                patch(i, {
                                                    max,
                                                    current: Math.min(r.current, max),
                                                });
                                            }}
                                        />
                                    </label>
                                    <label>
                                        Порядок
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={r.sort_order}
                                            onChange={(e) =>
                                                patch(i, { sort_order: Number(e.target.value) })
                                            }
                                        />
                                    </label>
                                </div>
                                <div className="gameplay-form-row">
                                    <label>
                                        Значок
                                        <select
                                            value={r.icon}
                                            onChange={(e) => patch(i, { icon: e.target.value })}
                                        >
                                            {Object.keys(gameplayIcons).map((k) => (
                                                <option key={k} value={k}>
                                                    {iconLabels[k]}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>
                                        Акцент
                                        <select
                                            value={r.accent}
                                            onChange={(e) =>
                                                patch(i, {
                                                    accent: e.target
                                                        .value as CharacterResource['accent'],
                                                })
                                            }
                                        >
                                            {Object.entries({
                                                violet: 'Фиолетовый',
                                                blue: 'Голубой',
                                                amber: 'Янтарный',
                                                green: 'Зелёный',
                                                red: 'Красный',
                                            }).map(([k, v]) => (
                                                <option key={k} value={k}>
                                                    {v}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                                <div role="group" aria-label="Восстановление ресурса">
                                    {(['manual', 'short_rest', 'long_rest'] as const).map(
                                        (recovery) => (
                                            <button
                                                type="button"
                                                key={recovery}
                                                aria-pressed={(r.recovery ?? 'manual') === recovery}
                                                onClick={() => patch(i, { recovery })}
                                            >
                                                {recovery === 'manual'
                                                    ? 'Вручную'
                                                    : recovery === 'short_rest'
                                                      ? 'Short Rest'
                                                      : 'Long Rest'}
                                            </button>
                                        ),
                                    )}
                                </div>
                                <label className="gameplay-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={r.player_adjustable}
                                        onChange={(e) =>
                                            patch(i, { player_adjustable: e.target.checked })
                                        }
                                    />{' '}
                                    Игрок может менять вручную
                                </label>
                            </Settings>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
