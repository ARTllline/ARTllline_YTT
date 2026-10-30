import { useEffect, useRef, useState } from 'react';
import type { Character, Token } from '../tabletop/types/scene';
import type { SceneStore } from '../tabletop/state/SceneStore';

export function HeroPortrait({
    store,
    actors,
    actor,
    character,
    disabled,
    onDetails,
}: {
    store: SceneStore;
    actors: Token[];
    actor?: Token;
    character?: Character;
    disabled: boolean;
    onDetails?: () => void;
}) {
    const [open, setOpen] = useState(false);
    const host = useRef<HTMLDivElement>(null);
    const scene = store.getSnapshot().scene;
    const heroes = [
        ...(scene.characters ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            image: c.portrait?.url,
            hp: c.hp,
            max: c.maxHp,
            character: true,
        })),
        ...actors
            .filter((t) => !t.characterId)
            .map((t) => ({
                id: t.id,
                name: t.name,
                image: t.image?.url,
                hp: t.hp,
                max: t.maxHp,
                character: false,
            })),
    ];
    const multiple = heroes.length > 1 || (!character && !actor && heroes.length > 0);
    const name = character?.name ?? actor?.name ?? 'Герой';
    const image = character?.portrait?.url ?? actor?.image?.url;
    useEffect(() => {
        if (!open) return;
        const dismiss = (e: PointerEvent) => {
            if (!host.current?.contains(e.target as Node)) setOpen(false);
        };
        const escape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
                host.current?.querySelector<HTMLButtonElement>('.hud-portrait')?.focus();
            }
        };
        document.addEventListener('pointerdown', dismiss);
        document.addEventListener('keydown', escape);
        host.current
            ?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')
            ?.focus();
        return () => {
            document.removeEventListener('pointerdown', dismiss);
            document.removeEventListener('keydown', escape);
        };
    }, [open]);
    return (
        <div className="hero-portrait-anchor" ref={host}>
            {multiple && (
                <span className="portrait-stack-marks" aria-hidden="true">
                    <i />
                    <i />
                </span>
            )}
            <button
                className="hud-portrait"
                disabled={disabled}
                aria-label={multiple ? `Сменить героя: ${name}` : `Подробнее: ${name}`}
                aria-haspopup={multiple ? 'menu' : undefined}
                aria-expanded={multiple ? open : undefined}
                onClick={() => (multiple ? setOpen(!open) : onDetails?.())}
            >
                {image ? (
                    <img src={image} alt="" />
                ) : (
                    <span className="portrait-initial">{name.slice(0, 1)}</span>
                )}
                {!!actor?.conditions?.length && (
                    <span
                        className="hud-condition-badge"
                        title={actor.conditions.map((c) => c.label).join(' · ')}
                    >
                        {actor.conditions.length}
                    </span>
                )}
            </button>
            {multiple && (
                <span className="portrait-party-count" aria-hidden="true">
                    {heroes.length}
                    <span>▴</span>
                </span>
            )}
            {open && (
                <div
                    className="hero-roster"
                    role="menu"
                    aria-label="Выберите героя"
                    onKeyDown={(e) => {
                        const buttons = [
                            ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                                '[role="menuitemradio"]',
                            ),
                        ];
                        if (
                            [
                                'ArrowRight',
                                'ArrowLeft',
                                'ArrowUp',
                                'ArrowDown',
                                'Home',
                                'End',
                            ].includes(e.key)
                        ) {
                            e.preventDefault();
                            const index = buttons.indexOf(
                                document.activeElement as HTMLButtonElement,
                            );
                            buttons[
                                e.key === 'Home'
                                    ? 0
                                    : e.key === 'End'
                                      ? buttons.length - 1
                                      : (index +
                                            (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1) +
                                            buttons.length) %
                                        buttons.length
                            ]?.focus();
                        }
                    }}
                >
                    <span className="eyebrow">ВАШ ОТРЯД</span>
                    <div>
                        {heroes.map((h) => (
                            <button
                                key={`${h.character}:${h.id}`}
                                role="menuitemradio"
                                aria-checked={
                                    h.character ? h.id === character?.id : h.id === actor?.id
                                }
                                onClick={() => {
                                    if (h.character) store.setActiveCharacter(h.id);
                                    else store.setActingToken(h.id);
                                    setOpen(false);
                                    requestAnimationFrame(() =>
                                        document
                                            .querySelector<HTMLButtonElement>('.hud-portrait')
                                            ?.focus(),
                                    );
                                }}
                            >
                                {h.image ? (
                                    <img src={h.image} alt="" />
                                ) : (
                                    <span>{h.name.slice(0, 1)}</span>
                                )}
                                <strong>{h.name}</strong>
                                <small>
                                    {h.hp} / {h.max}
                                </small>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
