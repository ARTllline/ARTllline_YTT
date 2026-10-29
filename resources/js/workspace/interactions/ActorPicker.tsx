import type { Token } from '../../tabletop/types/scene';

export function ActorPortrait({ token }: { token?: Token }) {
    return (
        <span className="actor-portrait" aria-hidden="true">
            {token?.image ? <img src={token.image.url} alt="" /> : (token?.name.slice(0, 1) ?? '?')}
        </span>
    );
}

export function ActorPicker({
    tokens,
    actor,
    onChange,
    disabled = false,
}: {
    tokens: readonly Token[];
    actor?: Token;
    onChange: (id: string) => void;
    disabled?: boolean;
}) {
    return (
        <div className="actor-picker">
            <ActorPortrait token={actor} />
            <label>
                <span>ДЕЙСТВУЕТ</span>
                {tokens.length > 1 ? (
                    <select
                        aria-label="Действующий персонаж"
                        value={actor?.id ?? ''}
                        disabled={disabled}
                        onChange={(e) => onChange(e.target.value)}
                    >
                        <option value="" disabled>
                            Выберите персонажа
                        </option>
                        {tokens.map((token) => (
                            <option key={token.id} value={token.id}>
                                {token.name}
                            </option>
                        ))}
                    </select>
                ) : (
                    <strong>{actor?.name ?? 'Нет доступного персонажа'}</strong>
                )}
            </label>
        </div>
    );
}
