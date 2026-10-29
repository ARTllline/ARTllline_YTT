import { Circle, Cone, Minus, RectangleHorizontal, Crosshair } from 'lucide-react';
import type { Ability } from './model';

const shapes = {
    none: ['Одна цель', Crosshair],
    circle: ['Радиус', Circle],
    cone: ['Конус', Cone],
    line: ['Линия', Minus],
    rectangle: ['Прямоугольник', RectangleHorizontal],
} as const;
export function AbilityGeometryEditor({
    ability: a,
    onChange: patch,
}: {
    ability: Ability;
    onChange: (data: Partial<Ability>) => void;
}) {
    const shape = a.area?.shape ?? 'none';
    return (
        <section className="ability-geometry-editor">
            <span className="eyebrow">ДАЛЬНОСТЬ И ОБЛАСТЬ · В ЕДИНИЦАХ СЕТКИ</span>
            <div className="range-presets">
                {[5, 15, 30, 60, 120, 150].map((n) => (
                    <button
                        type="button"
                        key={n}
                        aria-pressed={a.range?.normal === n}
                        onClick={() => patch({ range: { normal: n, long: null } })}
                    >
                        {n}
                    </button>
                ))}
                <button
                    type="button"
                    aria-pressed={!a.range}
                    onClick={() => patch({ range: null })}
                >
                    ∞
                </button>
            </div>
            <details className="ability-precise">
                <summary>Точная дальность</summary>
                <div className="gameplay-form-row">
                    <label>
                        Обычная
                        <input
                            type="number"
                            min={0}
                            max={10000}
                            value={a.range?.normal ?? ''}
                            onChange={(e) =>
                                patch({
                                    range:
                                        e.target.value === ''
                                            ? null
                                            : {
                                                  normal: Number(e.target.value),
                                                  long: a.range?.long ?? null,
                                              },
                                })
                            }
                        />
                    </label>
                    <label>
                        Дальняя (без автоматических правил)
                        <input
                            type="number"
                            min={a.range?.normal ?? 0}
                            max={10000}
                            value={a.range?.long ?? ''}
                            onChange={(e) =>
                                patch({
                                    range: {
                                        normal: a.range?.normal ?? 60,
                                        long: e.target.value === '' ? null : Number(e.target.value),
                                    },
                                })
                            }
                        />
                    </label>
                </div>
            </details>
            <div className="area-shapes">
                {Object.entries(shapes).map(([k, [label, Icon]]) => (
                    <button
                        type="button"
                        key={k}
                        aria-pressed={shape === k}
                        onClick={() => {
                            const area =
                                k === 'none'
                                    ? null
                                    : {
                                          shape: k as NonNullable<Ability['area']>['shape'],
                                          size: k === 'cone' ? 15 : k === 'line' ? 100 : 20,
                                          width: k === 'line' ? 5 : 20,
                                      };
                            patch({
                                area,
                                target: k === 'none' ? 'token' : 'point',
                                category: k === 'none' ? 'attack' : 'effect',
                                check:
                                    k === 'none'
                                        ? {
                                              stat_key: a.check?.stat_key ?? null,
                                              modifier: 0,
                                              dc: 10,
                                              dc_visible: true,
                                              defense: 'ac',
                                          }
                                        : null,
                                range:
                                    area && ['cone', 'line'].includes(k)
                                        ? { normal: area.size, long: null }
                                        : a.range,
                            });
                        }}
                    >
                        <Icon size={20} />
                        <span>{label}</span>
                    </button>
                ))}
            </div>
            {a.area && (
                <div className="area-dimensions">
                    <div className="area-preview" aria-hidden="true">
                        <svg viewBox="0 0 180 100">
                            <path d="M0 50H180M90 0V100" stroke="#b9a175" strokeOpacity=".2" />
                            {shape === 'circle' ? (
                                <circle cx="90" cy="50" r="35" />
                            ) : shape === 'cone' ? (
                                <path d="M30 50 132 8 A110 110 0 0 1 132 92Z" />
                            ) : shape === 'line' ? (
                                <rect x="22" y="40" width="136" height="20" />
                            ) : (
                                <rect x="45" y="18" width="90" height="64" />
                            )}
                            <circle
                                className="preview-origin"
                                cx={shape === 'cone' || shape === 'line' ? 30 : 90}
                                cy="50"
                                r="3"
                            />
                        </svg>
                    </div>
                    <label>
                        {shape === 'circle' ? 'Радиус' : 'Длина'} · {a.area.size}
                        <input
                            aria-label="Размер области"
                            type="range"
                            min={5}
                            max={shape === 'line' ? 150 : 60}
                            step={5}
                            value={a.area.size}
                            onChange={(e) =>
                                patch({
                                    area: { ...a.area!, size: Number(e.target.value) },
                                    ...(['cone', 'line'].includes(shape)
                                        ? { range: { normal: Number(e.target.value), long: null } }
                                        : {}),
                                })
                            }
                        />
                    </label>
                    {['line', 'rectangle'].includes(shape) && (
                        <label>
                            Ширина · {a.area.width}
                            <input
                                aria-label="Ширина области"
                                type="range"
                                min={5}
                                max={60}
                                step={5}
                                value={a.area.width}
                                onChange={(e) =>
                                    patch({ area: { ...a.area!, width: Number(e.target.value) } })
                                }
                            />
                        </label>
                    )}
                </div>
            )}
        </section>
    );
}
