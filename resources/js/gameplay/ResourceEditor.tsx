import { Plus, Trash2 } from 'lucide-react';
import type { CharacterResource } from './model';
import { gameplayIcons, iconLabels } from './icons';

export function ResourceEditor({
    resources,
    onChange,
}: {
    resources: CharacterResource[];
    onChange: (r: CharacterResource[]) => void;
}) {
    const patch = (index: number, data: Partial<CharacterResource>) =>
        onChange(resources.map((r, i) => (i === index ? { ...r, ...data } : r)));
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
            {resources.map((r, i) => (
                <div key={i} className="resource-editor-card">
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
                            onClick={() => onChange(resources.filter((_, n) => n !== i))}
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
                                onChange={(e) => patch(i, { current: Number(e.target.value) })}
                            />
                        </label>
                        <label>
                            Максимум
                            <input
                                type="number"
                                min={1}
                                max={9999}
                                value={r.max}
                                onChange={(e) => patch(i, { max: Number(e.target.value) })}
                            />
                        </label>
                        <label>
                            Порядок
                            <input
                                type="number"
                                min={0}
                                max={100}
                                value={r.sort_order}
                                onChange={(e) => patch(i, { sort_order: Number(e.target.value) })}
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
                                        accent: e.target.value as CharacterResource['accent'],
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
                    <label className="gameplay-checkbox">
                        <input
                            type="checkbox"
                            checked={r.player_adjustable}
                            onChange={(e) => patch(i, { player_adjustable: e.target.checked })}
                        />{' '}
                        Игрок может менять вручную
                    </label>
                </div>
            ))}
        </section>
    );
}
