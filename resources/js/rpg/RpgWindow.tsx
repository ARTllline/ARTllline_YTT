import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Backpack, BookOpen, UserRound, X } from 'lucide-react';
export type RpgWindowKind = 'inventory' | 'spellbook' | 'character';
const nav = [
    { key: 'inventory' as const, label: 'Инвентарь', keycap: 'I', Icon: Backpack },
    { key: 'spellbook' as const, label: 'Книга способностей', keycap: 'K', Icon: BookOpen },
    { key: 'character' as const, label: 'Персонаж', keycap: 'C', Icon: UserRound },
];
export function RpgWindow({
    kind,
    name,
    onChange,
    onClose,
    children,
}: {
    kind: RpgWindowKind;
    name: string;
    onChange: (v: RpgWindowKind) => void;
    onClose: () => void;
    children: ReactNode;
}) {
    const [closing, setClosing] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
        host = useRef<HTMLElement>(null);
    const close = () => {
        setClosing(true);
        timer.current = setTimeout(
            onClose,
            matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 130,
        );
    };
    useEffect(() => {
        host.current?.focus();
        return () => clearTimeout(timer.current);
    }, []);
    return createPortal(
        <section
            className={`rpg-window window-${kind} ${closing ? 'is-closing' : ''}`}
            role="dialog"
            aria-modal="false"
            aria-label={nav.find((v) => v.key === kind)!.label}
            tabIndex={-1}
            ref={host}
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    close();
                }
            }}
        >
            <header className="rpg-window-header">
                <div className="rpg-window-identity">
                    <span>YTT · ГЕРОЙ</span>
                    <strong>{name}</strong>
                </div>
                <nav aria-label="Окна персонажа">
                    {nav.map(({ key, label, keycap, Icon }) => (
                        <button key={key} aria-pressed={kind === key} onClick={() => onChange(key)}>
                            <Icon size={19} />
                            <span>{label}</span>
                            <kbd>{keycap}</kbd>
                        </button>
                    ))}
                </nav>
                <button className="rpg-window-close" aria-label="Закрыть RPG окно" onClick={close}>
                    <X size={22} />
                </button>
            </header>
            <div className="rpg-window-body">{children}</div>
            <div className="rpg-window-footnote">
                Перетащите на панель действий · Удерживайте на сенсорном экране · Esc — закрыть
            </div>
        </section>,
        document.body,
    );
}
