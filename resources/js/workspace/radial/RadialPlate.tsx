/** Presentation only; buttons retain the existing menu keyboard/permission paths. */
export function RadialPlate({ count, active }: { count: number; active: number | null }) {
    const point = (radius: number, angle: number) =>
        `${152 + Math.cos(angle) * radius},${152 + Math.sin(angle) * radius}`;
    return (
        <svg className="radial-sector-plate" viewBox="0 0 304 304" aria-hidden="true">
            {Array.from({ length: count }, (_, i) => {
                const step = (Math.PI * 2) / count;
                const center = -Math.PI / 2 + step * i;
                const start = center - step / 2 + 0.025,
                    end = center + step / 2 - 0.025;
                const large = end - start > Math.PI ? 1 : 0;
                return (
                    <path
                        key={i}
                        className={active === i ? 'is-active' : ''}
                        d={`M${point(143, start)} A143,143 0 ${large} 1 ${point(143, end)} L${point(58, end)} A58,58 0 ${large} 0 ${point(58, start)} Z`}
                    />
                );
            })}
        </svg>
    );
}
