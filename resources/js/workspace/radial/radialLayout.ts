export const RADIAL_SIZE = 304;
export function radialPosition(x: number, y: number, width: number, height: number) {
    const size = Math.min(RADIAL_SIZE, width - 16, height - 16);
    return {
        left: Math.max(8, Math.min(x - size / 2, width - size - 8)),
        top: Math.max(8, Math.min(y - size / 2, height - size - 8)),
        size,
    };
}
export function radialSlot(index: number, count: number) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    return { left: `${50 + Math.cos(angle) * 35}%`, top: `${50 + Math.sin(angle) * 35}%` };
}
export function radialFocus(index: number, key: string, count: number) {
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return (index + (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1) + count) % count;
}
