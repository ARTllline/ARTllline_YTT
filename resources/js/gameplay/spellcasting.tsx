import { useEffect, useRef, useState } from 'react';
import type { Ability } from './model';
import type { Character } from '../tabletop/types/scene';
import { commandId } from '../api/workspace';
import { request } from '../api/client';

export interface SpellcastingState {
    recovery?: 'manual' | 'long_rest';
    slots: Record<string, { max: number; current: number }>;
    cantrip_tier: number;
    scroll_list: string[];
    scroll_max_level: number;
    verbal_blocked: boolean;
}
export const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
export function SpellSlots({ state }: { state?: SpellcastingState }) {
    const rows = Object.entries(state?.slots ?? {}).filter(([, s]) => s.max > 0);
    return (
        <div className="spell-slots" aria-label="Ячейки заклинаний">
            {rows.length ? (
                rows.map(([level, s]) => (
                    <span key={level} title={`Круг ${level}: ${s.current} / ${s.max}`}>
                        <b>{roman[Number(level)]}</b>
                        <i aria-hidden="true">
                            {'●'.repeat(Math.min(s.current, 12))}
                            {'○'.repeat(Math.min(s.max - s.current, 12))}
                        </i>
                        <small>
                            {s.current}/{s.max}
                        </small>
                    </span>
                ))
            ) : (
                <small>Ячейки ещё не настроены GM · заговоры без ячеек</small>
            )}
        </div>
    );
}
export function SpellDetails({ ability }: { ability: Ability }) {
    const s = ability.spell;
    if (!s) return null;
    return (
        <div className="spell-canonical-details">
            <span className={`spell-coverage status-${s.coverage ?? 'PARTIAL'}`}>
                {s.coverage === 'FULL' ? 'Автоматически' : 'Требуется разрешение GM'} ·{' '}
                {s.coverage ?? 'PARTIAL'}
            </span>
            {s.coverage !== 'FULL' && s.reasons?.map((r) => <small key={r}>{r}</small>)}
            <p>
                {s.known ? 'Известно' : 'Неизвестно'} ·{' '}
                {s.prepared ? 'Подготовлено' : 'Не подготовлено'}
            </p>
            <dl>
                <div>
                    <dt>Сотворение</dt>
                    <dd>{s.casting_time ?? ability.activation ?? 'Действие'}</dd>
                </div>
                <div>
                    <dt>Длительность</dt>
                    <dd>
                        {s.concentration ? 'Концентрация · ' : ''}
                        {s.duration_text ?? 'Мгновенно'}
                    </dd>
                </div>
                <div>
                    <dt>Компоненты</dt>
                    <dd>
                        {s.components?.join(' · ') || 'Нет данных'}
                        {s.material && <small>{s.material}</small>}
                    </dd>
                </div>
            </dl>
            <small>
                Жесты, доступность материала и использование фокуса подтверждает GM. Настроенные
                расходуемые компоненты списываются при сотворении.
            </small>
            {s.reference && (
                <details>
                    <summary>Полное описание SRD</summary>
                    <p className="spell-reference">{s.reference}</p>
                </details>
            )}
            {ability.casting && !ability.casting.available && (
                <p role="status">{ability.casting.reason}</p>
            )}
        </div>
    );
}
export function CastLevelChooser({
    ability,
    onChoose,
    onClose,
}: {
    ability: Ability;
    onChoose: (level: number, choice?: string) => void;
    onClose: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null),
        levels = ability.casting?.levels ?? [{ level: ability.spell?.level ?? 0, current: null }];
    const [level, setLevel] = useState(levels[0]?.level ?? 0),
        [choice, setChoice] = useState('');
    const choices = ability.spell?.effects?.flatMap((e) => e.choices ?? []) ?? [];
    useEffect(() => {
        dialog.current?.showModal();
    }, []);
    return (
        <dialog ref={dialog} className="spell-cast-chooser" onCancel={onClose}>
            <header>
                <h3>{ability.name}</h3>
                <button aria-label="Отменить сотворение" onClick={onClose}>
                    ×
                </button>
            </header>
            <p>Круг сотворения</p>
            <div className="cast-level-chips">
                {levels.map((l) => (
                    <button
                        key={l.level}
                        aria-pressed={level === l.level}
                        onClick={() => setLevel(l.level)}
                    >
                        <b>{l.level ? roman[l.level] : 'Заговор'}</b>
                        <small>{l.current === null ? 'Без ячейки' : `${l.current} доступно`}</small>
                        <small>{l.damage ?? l.healing ?? 'Эффект по описанию'}</small>
                    </button>
                ))}
            </div>
            {choices.length > 0 && (
                <div className="cast-level-chips" aria-label="Состояние для снятия">
                    {choices.map((c) => (
                        <button key={c} aria-pressed={choice === c} onClick={() => setChoice(c)}>
                            {c}
                        </button>
                    ))}
                </div>
            )}
            <SpellDetails ability={ability} />
            <button
                className="primary-button"
                disabled={!levels.length || (!!choices.length && !choice)}
                onClick={() => onChoose(level, choice || undefined)}
            >
                Выбрать цель
            </button>
        </dialog>
    );
}
export function ConcentrationHUD({
    character,
    campaign,
    onChanged,
}: {
    character: Character;
    campaign: string;
    onChanged: () => void;
}) {
    const [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const effects = character.spellEffects?.filter((e) => e.concentration) ?? [];
    if (!effects.length && !character.temporaryHp) return null;
    return (
        <div className="concentration-hud">
            {!!character.temporaryHp && <span>Временные HP · {character.temporaryHp}</span>}
            {effects.map((e) => (
                <span
                    key={e.id}
                    title={
                        e.expiresAt ??
                        (e.remainingRounds ? `${e.remainingRounds} раундов` : 'Пока поддерживается')
                    }
                >
                    <b>Концентрация · {e.name}</b>
                    {e.remainingRounds !== null && <small>{e.remainingRounds} раундов</small>}
                    <button
                        disabled={busy}
                        aria-label={`Прекратить концентрацию: ${e.name}`}
                        onClick={() => {
                            setBusy(true);
                            void request(`/campaigns/${campaign}/spellcasting`, 'POST', {
                                characterId: character.id,
                                action: 'end-effect',
                                effectId: e.id,
                                clientMutationId: commandId(),
                            })
                                .then(onChanged)
                                .catch((err) => setError(err.message))
                                .finally(() => setBusy(false));
                        }}
                    >
                        ×
                    </button>
                </span>
            ))}
            {error && <small role="alert">{error}</small>}
        </div>
    );
}
