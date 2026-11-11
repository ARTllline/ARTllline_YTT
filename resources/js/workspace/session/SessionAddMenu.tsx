import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Box, CircleUserRound, Hand, PackageOpen, Skull, X } from 'lucide-react';
import type { Placement } from '../creation/model';
import { EntityPicker, initialCatalogQuery } from '../creation/EntityPicker';
import './session-add.css';

const kinds = [
    ['characters', 'Character', 'Герой из библиотеки', CircleUserRound],
    ['npcs', 'NPC', 'Независимая копия существа', Skull],
    ['prop', 'Prop', 'Объект на карте', Box],
    ['container', 'Container', 'Объект с пустым контейнером', PackageOpen],
    ['interaction', 'Interaction', 'Объект с действием «Осмотреть»', Hand],
] as const;
type Kind = (typeof kinds)[number][0];
export function SessionAddMenu({
    campaignId,
    placedCharacterIds,
    onPlace,
    onClose,
}: {
    campaignId: string;
    placedCharacterIds: string[];
    onPlace: (item: Placement) => void;
    onClose: () => void;
}) {
    const [kind, setKind] = useState<Kind | null>(null);
    const [query, setQuery] = useState(initialCatalogQuery);
    const root = useRef<HTMLElement>(null);
    const close = useRef(onClose);
    useEffect(() => {
        close.current = onClose;
    }, [onClose]);
    useEffect(() => {
        root.current?.querySelector<HTMLButtonElement>('button')?.focus();
        const outside = (e: PointerEvent) => {
            if (!(e.target as HTMLElement).closest('.runtime-add, .creation-launch'))
                close.current();
        };
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                close.current();
            }
        };
        document.addEventListener('pointerdown', outside, true);
        window.addEventListener('keydown', key, true);
        return () => {
            document.removeEventListener('pointerdown', outside, true);
            window.removeEventListener('keydown', key, true);
        };
    }, []);
    return (
        <section className="runtime-add" ref={root} aria-label="Добавить на карту">
            <header>
                {kind && (
                    <button
                        className="icon-button"
                        aria-label="Назад к типам"
                        onClick={() => setKind(null)}
                    >
                        <ArrowLeft size={16} />
                    </button>
                )}
                <strong>
                    {kind ? kinds.find((k) => k[0] === kind)?.[1] : 'Добавить на карту'}
                </strong>
                <button className="icon-button" aria-label="Закрыть добавление" onClick={onClose}>
                    <X size={16} />
                </button>
            </header>
            {kind ? (
                <EntityPicker
                    key={kind}
                    kind={kind}
                    campaignId={campaignId}
                    placedCharacterIds={placedCharacterIds}
                    onPlace={onPlace}
                    query={query}
                    onQuery={setQuery}
                />
            ) : (
                <div className="runtime-add-types">
                    {kinds.map(([key, label, hint, Icon]) => (
                        <button
                            key={key}
                            onClick={() => {
                                setQuery(initialCatalogQuery);
                                setKind(key);
                            }}
                        >
                            <Icon size={19} />
                            <span>
                                <strong>{label}</strong>
                                <small>{hint}</small>
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
}
