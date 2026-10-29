import { createContext, useContext, useEffect, type MutableRefObject } from 'react';

// A failed live command owns its retry identity until the GM resolves it.
export const PanelGuard = createContext<MutableRefObject<string> | null>(null);
export function usePanelGuard(reason: string) {
    const guardRef = useContext(PanelGuard);
    useEffect(() => {
        if (!guardRef) return;
        guardRef.current = reason;
        return () => {
            guardRef.current = '';
        };
    }, [guardRef, reason]);
}
