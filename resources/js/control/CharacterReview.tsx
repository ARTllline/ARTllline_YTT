import { UserRound } from 'lucide-react';
import type { Campaign } from '../api/workspace';
import type { Character } from '../tabletop/types/scene';
import { abilityLabels, signed, type AbilityKey, type DerivedCharacter } from '../rpg/rules';
import type { BuilderChoice } from './BuilderPicker';

export function CharacterReview({
    character: c,
    derived,
    campaign,
    items,
    spells,
    compact = false,
}: {
    character: Character;
    derived?: DerivedCharacter;
    campaign: Campaign | null;
    items: BuilderChoice[];
    spells: BuilderChoice[];
    compact?: boolean;
}) {
    return (
        <aside
            className={compact ? 'builder-preview' : 'builder-review'}
            aria-label={compact ? 'Предпросмотр героя' : 'Итоговая карточка'}
        >
            <div className="builder-review-identity">
                {c.portrait ? (
                    <img src={c.portrait.url} alt="Портрет героя" />
                ) : (
                    <UserRound size={40} />
                )}
                <div>
                    <small>{compact ? 'ВАШ ГЕРОЙ' : 'КАРТОЧКА ГЕРОЯ'}</small>
                    <h2>{c.name || 'Имя вашего героя'}</h2>
                    <p>
                        {[c.origin?.species, c.origin?.background].filter(Boolean).join(' · ') ||
                            'Происхождение не указано'}
                    </p>
                </div>
                <div className="builder-token" title="Токен использует тот же портрет">
                    {c.portrait ? (
                        <img src={c.portrait.url} alt="Токен героя" />
                    ) : (
                        <UserRound size={22} />
                    )}
                </div>
            </div>
            <div className="control-card-stats">
                <span>
                    HP{' '}
                    <b>
                        {c.hp} / {c.maxHp}
                    </b>
                </span>
                <span>
                    AC <b>{derived?.ac ?? '…'}</b>
                </span>
                <span>
                    Скорость <b>{derived?.speed ?? '…'} ft</b>
                </span>
            </div>
            {!compact && (
                <>
                    <div className="builder-scores">
                        {(Object.keys(abilityLabels) as AbilityKey[]).map((key) => (
                            <div key={key}>
                                <small>{key.toUpperCase()}</small>
                                <span>{c.rules?.scores[key] ?? '—'}</span>
                                <strong>
                                    {derived?.abilityModifiers?.[key] === undefined
                                        ? '—'
                                        : signed(derived.abilityModifiers[key]!)}
                                </strong>
                            </div>
                        ))}
                    </div>
                    <div className="builder-review-columns">
                        <section>
                            <h3>Навыки и спасброски</h3>
                            {derived?.checks
                                .filter((s) => s.proficient || s.expertise)
                                .map((s) => (
                                    <p key={s.key}>
                                        {s.label} <small>{s.ability?.toUpperCase()}</small>{' '}
                                        <b>{signed(s.modifier)}</b> ·{' '}
                                        {s.expertise ? 'Компетентность' : 'Владение'}
                                    </p>
                                ))}
                            {!derived?.checks.some((s) => s.proficient || s.expertise) && (
                                <p>Владения не выбраны</p>
                            )}
                        </section>
                        <section>
                            <h3>Снаряжение</h3>
                            {items.length ? (
                                items.map((i) => (
                                    <p key={i.id}>
                                        {i.name} ×{i.quantity} · в рюкзаке
                                    </p>
                                ))
                            ) : (
                                <p>Пустой рюкзак</p>
                            )}
                            <h3>Заклинания</h3>
                            {spells.length ? (
                                spells.map((s) => <p key={s.id}>{s.name}</p>)
                            ) : (
                                <p>Без заклинаний</p>
                            )}
                            {derived?.spellcasting && (
                                <p>
                                    Атака {signed(derived.spellcasting.attackBonus)} · Сл{' '}
                                    {derived.spellcasting.saveDc}
                                </p>
                            )}
                        </section>
                    </div>
                    <p>
                        Кости здоровья:{' '}
                        {c.hitPointDice?.map((d) => `${d.current}/${d.max} ${d.die}`).join(' · ') ||
                            'Не заданы'}{' '}
                        · Истощение: {c.exhaustion ?? 0}
                    </p>
                    {!!c.resources?.length && (
                        <p>Ресурсы: {c.resources.map((r) => r.label).join(' · ')}</p>
                    )}
                    <p>
                        Доступ:{' '}
                        <b>
                            {campaign?.members?.find((m) => m.id === c.ownerUserId)?.name ??
                                'Только GM'}
                        </b>
                    </p>
                </>
            )}
        </aside>
    );
}
