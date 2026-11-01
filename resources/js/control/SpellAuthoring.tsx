import { AssetIconPicker } from './AssetLibrary';
import { useEffect, useState } from 'react';
import { request } from '../api/client';
import { commandId } from '../api/workspace';
import { newAbility, targetLabels, type Ability } from '../gameplay/model';
import { gameplayIcons, iconLabels } from '../gameplay/icons';
import { RpgIcon } from '../gameplay/RpgIcon';
import { CombatAbilityEditor } from '../gameplay/CombatAbilityEditor';
import { AbilityGeometryEditor } from '../gameplay/AbilityGeometryEditor';
import { SpellEffectEditor } from '../rpg/SpellEffectEditor';
import { SpellDetails, type LibrarySpell } from './SpellLibrary';

export function spellDraft(entry?: LibrarySpell): Ability {
    if (entry) return structuredClone(entry.ability);
    return {
        ...newAbility('effect', 0),
        name: '',
        target: 'token',
        attack_type: 'spell',
        range: { normal: 60, long: null },
        spell: {
            level: 0,
            school: 'evocation',
            classes: [],
            known: true,
            prepared: false,
            available: true,
            coverage: 'FULL',
            components: [],
            casting_time: 'Action',
            duration_text: 'Instantaneous',
            duration: { mode: 'instantaneous', amount: 0 },
        },
    };
}

export function SpellAuthoring({
    entry,
    duplicate,
    onSaved,
    onCancel,
}: {
    entry?: LibrarySpell;
    duplicate: boolean;
    onSaved: (s: LibrarySpell) => void;
    onCancel: () => void;
}) {
    const [draft, setDraft] = useState(() => {
        const a = spellDraft(entry);
        if (duplicate) a.name = `${a.name.slice(0, 51)} · копия`;
        return a;
    });
    const [mutation, setMutation] = useState(commandId);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    useEffect(() => {
        const guard = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener('beforeunload', guard);
        return () => window.removeEventListener('beforeunload', guard);
    }, []);
    const patch = (p: Partial<Ability>) => {
        setDraft((a) => ({ ...a, ...p }));
        setMutation(commandId());
    };
    const spell = draft.spell!;
    const metadata = (p: Partial<NonNullable<Ability['spell']>>) =>
        patch({ spell: { ...spell, ...p } });
    const save = async () => {
        setBusy(true);
        setError('');
        try {
            const r = await request<{ entry: LibrarySpell }>('/library/spells', 'POST', {
                ...(entry && !duplicate ? { id: entry.id } : {}),
                ability: draft,
                clientMutationId: mutation,
                ...(entry && duplicate ? { copyFrom: entry.id } : {}),
            });
            onSaved(r.entry);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="library-authoring">
            <header>
                <span className="eyebrow">CUSTOM SPELL</span>
                <h2>{entry && !duplicate ? 'Редактировать заклинание' : 'Новое заклинание'}</h2>
                <p className="hint">Копии в книгах персонажей сохраняют свои свойства.</p>
            </header>
            {error && (
                <p role="alert" className="form-error">
                    {error}
                </p>
            )}
            <fieldset disabled={busy}>
                <label className="field">
                    Название
                    <input
                        aria-label="Название заклинания"
                        maxLength={60}
                        value={draft.name}
                        onChange={(e) => patch({ name: e.target.value })}
                    />
                </label>
                <AssetIconPicker
                    icon={draft.icon ?? 'spark'}
                    onChange={(icon) => patch({ icon })}
                />
                <div className="library-icon-picker" aria-label="Иллюстрация заклинания">
                    {Object.keys(gameplayIcons).map((icon) => (
                        <button
                            key={icon}
                            aria-label={iconLabels[icon]}
                            title={iconLabels[icon]}
                            aria-pressed={draft.icon === icon}
                            onClick={() => patch({ icon })}
                        >
                            <RpgIcon icon={icon} size={36} />
                        </button>
                    ))}
                </div>
                <div className="gameplay-form-row">
                    <label>
                        Круг
                        <select
                            value={spell.level}
                            onChange={(e) => metadata({ level: Number(e.target.value) })}
                        >
                            {Array.from({ length: 10 }, (_, i) => (
                                <option key={i} value={i}>
                                    {i === 0 ? 'Заговор' : i}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        Школа
                        <input
                            maxLength={48}
                            value={spell.school}
                            onChange={(e) => metadata({ school: e.target.value })}
                        />
                    </label>
                </div>
                <label className="field">
                    Описание
                    <textarea
                        maxLength={30000}
                        value={spell.reference ?? draft.description ?? ''}
                        onChange={(e) => {
                            patch({
                                description: e.target.value.slice(0, 800),
                                spell: { ...spell, reference: e.target.value },
                            });
                        }}
                    />
                </label>
                <div className="rpg-chips">
                    {(['ritual', 'concentration'] as const).map((k, i) => (
                        <button
                            key={k}
                            aria-pressed={!!spell[k]}
                            onClick={() => metadata({ [k]: !spell[k] })}
                        >
                            {['Ритуал', 'Концентрация'][i]}
                        </button>
                    ))}
                </div>
                <label className="field">
                    Длительность · описание
                    <input
                        maxLength={500}
                        value={spell.duration_text ?? ''}
                        onChange={(e) => metadata({ duration_text: e.target.value })}
                    />
                </label>
                <label className="field">
                    Цель
                    <select
                        value={draft.target}
                        onChange={(e) => patch({ target: e.target.value as Ability['target'] })}
                    >
                        {Object.entries(targetLabels).map(([k, v]) => (
                            <option key={k} value={k}>
                                {v}
                            </option>
                        ))}
                    </select>
                </label>
                <AbilityGeometryEditor ability={draft} onChange={patch} />
                <label className="field">
                    Применение
                    <select
                        value={draft.category}
                        onChange={(e) =>
                            patch({
                                category: e.target.value as Ability['category'],
                                attack: null,
                                save: null,
                                check: null,
                                damage: null,
                                damage_components: [],
                                area: null,
                                target: 'token',
                                ...(e.target.value === 'attack'
                                    ? {
                                          attack: {
                                              ability: 'spellcasting',
                                              proficient: true,
                                              bonus: 0,
                                          },
                                      }
                                    : {}),
                            })
                        }
                    >
                        <option value="effect">Эффект / спасбросок</option>
                        <option value="attack">Атака заклинанием</option>
                        <option value="utility">Вспомогательное</option>
                    </select>
                </label>
                <CombatAbilityEditor ability={draft} onChange={patch} campaignId="" />
                <details>
                    <summary>Сотворение, компоненты и эффекты</summary>
                    <SpellEffectEditor ability={draft} onChange={patch} />
                </details>
                <details>
                    <summary>Восстановление HP</summary>
                    <label>
                        Кубики
                        <input
                            placeholder="2d4+2"
                            value={draft.result?.type === 'heal' ? (draft.result.dice ?? '') : ''}
                            onChange={(e) =>
                                patch({
                                    result: e.target.value
                                        ? {
                                              type: 'heal',
                                              amount: 0,
                                              dice: e.target.value,
                                              target: null,
                                          }
                                        : { type: 'nothing', amount: 0, target: null },
                                })
                            }
                        />
                    </label>
                </details>
                <details>
                    <summary>Advanced · классы</summary>
                    <label>
                        Классы через запятую
                        <input
                            value={spell.classes.join(', ')}
                            onChange={(e) =>
                                metadata({
                                    classes: e.target.value
                                        .split(',')
                                        .map((v) => v.trim())
                                        .filter(Boolean),
                                })
                            }
                        />
                    </label>
                </details>
                <div className="library-draft-preview" aria-label="Предпросмотр заклинания">
                    <span className="eyebrow">ПРЕДПРОСМОТР</span>
                    <SpellDetails ability={draft} />
                </div>
                <div className="button-row">
                    <button
                        className="primary-button"
                        disabled={!draft.name.trim() || !spell.school.trim()}
                        onClick={() => void save()}
                    >
                        {busy ? 'Сохранение…' : 'Сохранить заклинание'}
                    </button>
                    <button
                        onClick={() => {
                            if (confirm('Отменить изменения заклинания?')) onCancel();
                        }}
                    >
                        Отмена
                    </button>
                </div>
            </fieldset>
        </div>
    );
}
