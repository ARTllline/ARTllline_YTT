import { useRef, useState, type PointerEvent } from 'react';
import {
    blockingColor,
    colliderPoints,
    flags,
    type Blocking,
    type Collider,
} from '../../tabletop/objects/collider';
import type { ImageAsset, Point } from '../../tabletop/types/scene';

function reset(
    type: Collider['type'],
    width: number,
    height: number,
    blocking: Blocking,
): Collider {
    const bits = {
        blocksMovement: blocking.blocksMovement,
        blocksVision: blocking.blocksVision,
        blocksLight: blocking.blocksLight,
    };
    const x = width * 0.15,
        y = height * 0.15;
    switch (type) {
        case 'none':
            return { ...bits, type };
        case 'rectangle':
            return { ...bits, type, x, y, width: width * 0.7, height: height * 0.7 };
        case 'circle':
            return {
                ...bits,
                type,
                x: width / 2,
                y: height / 2,
                radius: Math.min(width, height) * 0.35,
            };
        case 'polygon':
            return {
                ...bits,
                type,
                points: [
                    { x, y },
                    { x: width - x, y },
                    { x: width - x, y: height - y },
                    { x, y: height - y },
                ],
            };
    }
}

export function ColliderEditor({
    image,
    value,
    pivot,
    onChange,
}: {
    image: ImageAsset;
    value: Collider;
    pivot: Point;
    onChange: (value: Collider) => void;
}) {
    const svg = useRef<SVGSVGElement>(null);
    const drag = useRef<{ index: number; pointer: number; initial: Collider } | null>(null);
    const [selected, select] = useState(0);
    const [zoom, setZoom] = useState(1);
    const { width, height } = image;
    const points = colliderPoints(value);
    const handles =
        value.type === 'circle'
            ? [
                  { x: value.x, y: value.y },
                  { x: value.x + value.radius, y: value.y },
              ]
            : value.type === 'rectangle'
              ? [points[0], points[2]]
              : points;
    const extentX = Math.max(
        width,
        Math.abs(width / 2 - Math.min(...points.map((p) => p.x))) * 2,
        Math.abs(width / 2 - Math.max(...points.map((p) => p.x))) * 2,
    );
    const extentY = Math.max(
        height,
        Math.abs(height / 2 - Math.min(...points.map((p) => p.y))) * 2,
        Math.abs(height / 2 - Math.max(...points.map((p) => p.y))) * 2,
    );
    const [fit, setFit] = useState<Point | null>(null);
    const viewWidth = ((fit?.x ?? (points.length ? extentX : width)) * 1.24) / zoom;
    const viewHeight = ((fit?.y ?? (points.length ? extentY : height)) * 1.24) / zoom;
    const color = '#' + blockingColor(value).toString(16);
    const move = (event: PointerEvent<SVGSVGElement>) => {
        const active = drag.current;
        const matrix = svg.current?.getScreenCTM();
        if (!active || active.pointer !== event.pointerId || !matrix) return;
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        const coordinate = (v: number) =>
            Math.max(
                -8192,
                Math.min(8192, event.shiftKey ? Math.round(v / 5) * 5 : Math.round(v * 100) / 100),
            );
        const x = coordinate(point.x),
            y = coordinate(point.y);
        const initial = active.initial;
        if (initial.type === 'polygon') {
            onChange({
                ...initial,
                points: initial.points.map((p, i) => (i === active.index ? { x, y } : p)),
            });
        } else if (initial.type === 'circle') {
            onChange(
                active.index === 0
                    ? { ...initial, x, y }
                    : {
                          ...initial,
                          radius: Math.max(
                              0.01,
                              Math.min(16384, Math.hypot(x - initial.x, y - initial.y)),
                          ),
                      },
            );
        } else if (initial.type === 'rectangle') {
            const anchorX = initial.x + (active.index === 0 ? initial.width : 0);
            const anchorY = initial.y + (active.index === 0 ? initial.height : 0);
            onChange({
                ...initial,
                x: Math.min(anchorX, x),
                y: Math.min(anchorY, y),
                width: Math.max(0.01, Math.abs(anchorX - x)),
                height: Math.max(0.01, Math.abs(anchorY - y)),
            });
        }
    };
    return (
        <section className="collider-editor" aria-label="Редактор коллайдера">
            <div className="object-preset-actions">
                <label>
                    Форма{' '}
                    <select
                        value={value.type}
                        onChange={(e) => {
                            select(0);
                            onChange(
                                reset(e.target.value as Collider['type'], width, height, value),
                            );
                        }}
                    >
                        <option value="none">Без коллайдера</option>
                        <option value="rectangle">Прямоугольник</option>
                        <option value="circle">Круг</option>
                        <option value="polygon">Многоугольник</option>
                    </select>
                </label>
                <button
                    type="button"
                    disabled={value.type === 'none'}
                    onClick={() => {
                        select(0);
                        onChange(reset(value.type, width, height, value));
                    }}
                >
                    Сбросить форму
                </button>
                <label>
                    Зум{' '}
                    <input
                        type="range"
                        min="0.5"
                        max="3"
                        step="0.1"
                        value={zoom}
                        onChange={(e) => setZoom(+e.target.value)}
                    />
                </label>
            </div>
            <svg
                ref={svg}
                className="collider-preview"
                aria-label="Изображение и контур"
                viewBox={`${(width - viewWidth) / 2} ${(height - viewHeight) / 2} ${viewWidth} ${viewHeight}`}
                onPointerMove={move}
                onLostPointerCapture={() => {
                    drag.current = null;
                    setFit(null);
                }}
                onPointerCancel={() => {
                    if (drag.current) onChange(drag.current.initial);
                    drag.current = null;
                }}
            >
                <image href={image.url} width={width} height={height} preserveAspectRatio="none" />
                {points.length > 0 && (
                    <polygon
                        points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                        fill={color}
                        fillOpacity="0.18"
                        stroke={color}
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                    />
                )}
                <circle
                    cx={pivot.x * width}
                    cy={pivot.y * height}
                    r={Math.max(viewWidth, viewHeight) / 85}
                    stroke="#fff"
                    strokeWidth="1.5"
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                />
                {handles.map((point, index) => (
                    <circle
                        key={index}
                        aria-label={`Маркер ${index + 1}`}
                        data-handle={index}
                        cx={point.x}
                        cy={point.y}
                        r={Math.max(viewWidth, viewHeight) / 63}
                        fill={selected === index ? '#ffffff' : color}
                        stroke="#162321"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                        onPointerDown={(e) => {
                            if (e.button !== 0 || drag.current) return;
                            e.preventDefault();
                            setFit({ x: extentX, y: extentY });
                            drag.current = { index, pointer: e.pointerId, initial: value };
                            select(index);
                            svg.current?.setPointerCapture(e.pointerId);
                        }}
                    />
                ))}
            </svg>
            {value.type === 'polygon' && (
                <div className="object-preset-actions">
                    <button
                        type="button"
                        disabled={value.points.length >= 32}
                        onClick={() => {
                            const a = value.points[selected],
                                b = value.points[(selected + 1) % value.points.length];
                            const next = [...value.points];
                            next.splice(selected + 1, 0, {
                                x: (a.x + b.x) / 2,
                                y: (a.y + b.y) / 2,
                            });
                            onChange({ ...value, points: next });
                            select(selected + 1);
                        }}
                    >
                        Вставить после маркера
                    </button>
                    <button
                        type="button"
                        disabled={value.points.length <= 3}
                        onClick={() => {
                            onChange({
                                ...value,
                                points: value.points.filter((_, i) => i !== selected),
                            });
                            select(0);
                        }}
                    >
                        Удалить маркер
                    </button>
                </div>
            )}
            {value.type !== 'none' && (
                <div className="object-preset-actions">
                    {Object.entries(flags).map(([key, label]) => (
                        <label key={key}>
                            <input
                                type="checkbox"
                                checked={value[key as keyof Blocking]}
                                onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
                            />{' '}
                            {label}
                        </label>
                    ))}
                </div>
            )}
            <small className="hint">Белое кольцо — pivot. Перетащите маркер, Shift — шаг 5.</small>
        </section>
    );
}
