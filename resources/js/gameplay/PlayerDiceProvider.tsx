import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { DiceRuntime } from './DiceRuntime';

const DiceContext = createContext<DiceRuntime | null>(null);
export const usePlayerDice = () => useContext(DiceContext);

export function PlayerDiceProvider({ children }: { children: ReactNode }) {
    const [runtime] = useState(() => new DiceRuntime());
    const park = useRef<HTMLDivElement>(null);
    useEffect(() => {
        runtime.mount(park.current!);
        return () => runtime.dispose();
    }, [runtime]);
    return (
        <DiceContext.Provider value={runtime}>
            {children}
            <div className="player-dice-park" ref={park} aria-hidden="true" />
        </DiceContext.Provider>
    );
}
