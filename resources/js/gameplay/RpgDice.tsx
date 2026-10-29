export function RpgDice({
    dice,
    selected = 0,
    mode = 'normal',
    phase,
}: {
    dice?: number[];
    selected?: number;
    mode?: string;
    phase: string;
}) {
    const values = dice ?? (mode === 'normal' ? [null] : [null, null]);
    return (
        <div
            className={`rpg-dice-stage ${values.length > 1 ? 'is-pair' : ''}`}
            aria-label="Кубики d20"
        >
            {values.map((value, index) => (
                <figure
                    key={index}
                    className={`rpg-d20 ${dice ? (selected === index ? 'is-used' : 'is-discarded') : ''} ${value === 20 ? 'natural-high' : value === 1 ? 'natural-low' : ''}`}
                >
                    <div className="die-shadow" />
                    <div className="die-body">
                        <svg viewBox="0 0 180 194" aria-hidden="true">
                            <defs>
                                <linearGradient
                                    id={`die-metal-${index}`}
                                    x1="0"
                                    y1="0"
                                    x2="1"
                                    y2="1"
                                >
                                    <stop stopColor="#c2a375" />
                                    <stop offset=".45" stopColor="#806547" />
                                    <stop offset="1" stopColor="#322a25" />
                                </linearGradient>
                            </defs>
                            <path
                                d="M90 5 166 48 166 143 90 189 14 143 14 48Z"
                                fill={`url(#die-metal-${index})`}
                                stroke="#d7bd8d"
                                strokeWidth="1.4"
                            />
                            <path d="M90 5 45 68 14 48Z" fill="#ead8ac" opacity=".24" />
                            <path d="M90 5 135 68 166 48Z" fill="#f4dfb0" opacity=".16" />
                            <path d="M14 143 45 68 90 159Z" fill="#171514" opacity=".3" />
                            <path d="M166 143 135 68 90 159Z" fill="#090a09" opacity=".4" />
                            <path
                                d="M45 68 135 68 90 159Z"
                                fill="#242723"
                                stroke="#e3ca9e"
                                strokeWidth="1.2"
                            />
                            <path
                                d="M90 5 45 68 14 143 M90 5 135 68 166 143 M14 48 45 68 90 159 135 68 166 48 M14 143 90 159 166 143 M90 159 90 189"
                                fill="none"
                                stroke="#ddc197"
                                strokeWidth=".8"
                                opacity=".65"
                            />
                        </svg>
                        <strong>{value ?? 'd20'}</strong>
                    </div>
                    <figcaption>
                        {dice
                            ? index === selected
                                ? 'В ЗАЧЁТ'
                                : 'ОТБРОШЕН'
                            : phase === 'rolling'
                              ? 'БРОСОК'
                              : 'd20'}
                    </figcaption>
                </figure>
            ))}
        </div>
    );
}
