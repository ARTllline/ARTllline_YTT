// Hold a newly delivered Handout behind the check until the Player dismisses its result.
let active = false;
const listeners = new Set<() => void>();
export const checkPresentation = {
    getSnapshot: () => active,
    subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
    setActive: (value: boolean) => {
        active = value;
        listeners.forEach((listener) => listener());
    },
};

export type CheckPhase = 'ready' | 'rolling' | 'settle' | 'total' | 'outcome';
export function checkTimings(reducedMotion: boolean) {
    return reducedMotion
        ? { roll: 0, settle: 0, total: 0 }
        : { roll: 720, settle: 180, total: 240 };
}
