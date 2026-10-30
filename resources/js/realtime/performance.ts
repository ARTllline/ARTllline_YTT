/** Optional local profiling observer installed by the QA browser before app startup. */
export function performanceMark(phase: string, detail: Record<string, unknown>) {
    const observer = (
        globalThis as {
            __yttPerformance?: (phase: string, detail: Record<string, unknown>) => void;
        }
    ).__yttPerformance;
    observer?.(phase, { ...detail, at: performance.timeOrigin + performance.now() });
}
export function observingPerformance() {
    return typeof (globalThis as { __yttPerformance?: unknown }).__yttPerformance === 'function';
}
