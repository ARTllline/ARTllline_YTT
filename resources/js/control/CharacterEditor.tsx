import { CharacterAccess } from './CharacterAccess';
import { ResourceEditor } from '../gameplay/ResourceEditor';
import { useEffect, useState } from 'react';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { api, type Campaign, type CampaignSummary } from '../api/workspace';
import { request } from '../api/client';
import { charactersApi } from '../api/characters';
import type { Character } from '../tabletop/types/scene';
import { RulesEditor } from '../rpg/RulesEditor';
import { canonicalStatKey, type CharacterRules, type DerivedCharacter } from '../rpg/rules';
import { CharacterIdentity } from './CharacterIdentity';
import { CharacterCombat } from './CharacterCombat';
import { CheckStatsEditor } from '../workspace/interactions/TokenCheckEditor';
import { AbilityBuilder, pointRemaining, validArray, type ScoreMethod } from './AbilityBuilder';
import { BuilderPicker, type BuilderChoice } from './BuilderPicker';
import { CharacterReview } from './CharacterReview';
import { CharacterEquipment } from './CharacterEquipment';
import { AbilityEditor } from '../gameplay/AbilityEditor';
import { CharacterSpellbook } from './CharacterSpellbook';
import { CharacterSheetRules } from './CharacterSheetRules';

const builderSteps = [
    'Личность',
    'Происхождение',
    'Характеристики',
    'Навыки и спасброски',
    'Бой и ресурсы',
    'Снаряжение',
    'Заклинания и способности',
    'Обзор',
] as const;
const sections = [
    'Личность',
    'Характеристики',
    'Навыки и спасброски',
    'Бой',
    'Снаряжение',
    'Заклинания и способности',
    'Ресурсы',
    'Доступ',
] as const;
export function CharacterEditor({
    campaigns,
    initialCampaignId,
    initial,
    onSaved,
}: {
    campaigns: CampaignSummary[];
    initialCampaignId?: string;
    initial?: Character;
    onSaved: (character: Character) => void;
}) {
    const creating = !initial;
    const [campaignResult, setCampaignResult] = useState<{
        id: string;
        campaign?: Campaign;
        error?: string;
    }>();
    const [step, setStep] = useState(0);
    const [spellAdvanced, setSpellAdvanced] = useState(false);
    const [method, setMethod] = useState<ScoreMethod>('array');
    const [items, setItems] = useState<BuilderChoice[]>([]),
        [spells, setSpells] = useState<BuilderChoice[]>([]);
    const base = '/control/characters';
    const [draft, setDraft] = useState<Character | null>(initial ?? null);
    const [baseline, setBaseline] = useState(initial ? JSON.stringify(initial) : '');
    const [editSection, setSection] = useState<(typeof sections)[number]>('Личность');
    const section = creating ? builderSteps[step] : editSection;
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [message, setMessage] = useState('');
    const [derived, setDerived] = useState<DerivedCharacter | undefined>(initial?.derived);
    const [calculatedFor, setCalculatedFor] = useState('');
    const [previewError, setPreviewError] = useState(''),
        [previewBusy, setPreviewBusy] = useState(false);
    const [childDirty, setChildDirty] = useState(false);
    const dirty =
        !!draft &&
        (JSON.stringify(draft) !== baseline ||
            (creating && (items.length > 0 || spells.length > 0)));
    const accept = (c: Character) => {
        setDraft(c);
        setBaseline(JSON.stringify(c));
        setDerived(c.derived);
    };
    useEffect(() => {
        if (initial) return;
        const abort = new AbortController();
        void request<{ defaults: CharacterRules | null }>(
            '/library/character-rules/catalog',
            'GET',
            undefined,
            abort.signal,
        )
            .then((r) => {
                const c: Character = {
                    id: '',
                    campaignId: initialCampaignId ?? null,
                    name: '',
                    portrait: null,
                    ownerUserId: null,
                    kind: 'player_character',
                    disposition: 'friendly',
                    hp: 10,
                    maxHp: 10,
                    ac: 10,
                    speed: 30,
                    checkStats: [],
                    resources: [],
                    abilities: [],
                    rules: r.defaults
                        ? {
                              ...r.defaults,
                              scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
                          }
                        : null,
                    exhaustion: 0,
                    hitPointDice: [],
                };
                setDraft(c);
                setBaseline(JSON.stringify(c));
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [initialCampaignId, initial]);
    const assignedId = draft ? draft.campaignId : initial?.campaignId;
    const campaign = campaignResult?.id === assignedId ? (campaignResult?.campaign ?? null) : null;
    const campaignBusy = !!assignedId && campaignResult?.id !== assignedId;
    useEffect(() => {
        if (!assignedId) return;
        const abort = new AbortController();
        void api
            .campaign(assignedId, abort.signal)
            .then((c) => {
                if (!abort.signal.aborted) setCampaignResult({ id: assignedId, campaign: c });
            })
            .catch((e) => {
                if (!abort.signal.aborted) {
                    setCampaignResult({ id: assignedId, error: e.message });
                    setError(e.message);
                }
            });
        return () => abort.abort();
    }, [assignedId]);
    useEffect(() => {
        if (!dirty && !childDirty && !busy) return;
        const guard = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', guard);
        return () => window.removeEventListener('beforeunload', guard);
    }, [dirty, childDirty, busy]);
    const previewData = draft
        ? JSON.stringify({
              id: draft.id,
              rules: draft.rules,
              ac: draft.ac,
              speed: draft.speed,
              checkStats: draft.checkStats,
          })
        : '';
    useEffect(() => {
        if (!previewData) return;
        const abort = new AbortController();
        const timer = setTimeout(() => {
            setPreviewBusy(true);
            void charactersApi
                .preview(null, JSON.parse(previewData) as Character, abort.signal)
                .then((r) => {
                    if (!abort.signal.aborted) {
                        setDerived(r.derived);
                        setCalculatedFor(previewData);
                        setPreviewError('');
                    }
                })
                .catch((e) => {
                    if (!abort.signal.aborted) setPreviewError(e.message);
                })
                .finally(() => {
                    if (!abort.signal.aborted) setPreviewBusy(false);
                });
        }, 250);
        return () => {
            abort.abort();
            clearTimeout(timer);
        };
    }, [previewData]);
    const leave = () => {
        if (
            (!dirty && !childDirty) ||
            confirm('Есть несохранённые изменения. Покинуть редактор?')
        ) {
            setBaseline(JSON.stringify(draft));
            setChildDirty(false);
            window.setTimeout(() => location.assign(base), 0);
        }
    };
    const save = async () => {
        if (!draft || busy) return;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const { character } = await charactersApi.save(
                null,
                draft,
                creating
                    ? {
                          starting_items: items.map((i) => ({
                              definitionId: i.id,
                              quantity: i.quantity,
                          })),
                          starting_spells: spells.map((s) => Number(s.id)),
                      }
                    : undefined,
            );
            accept(character);
            setMessage('Персонаж сохранён');
            if (!draft.id) {
                setBusy(false);
                window.setTimeout(() => location.assign(`${base}/${character.id}`), 0);
            }
            onSaved(character);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (
            !draft?.id ||
            !confirm(
                `Удалить «${draft.name}» и его снаряжение? Персонаж со сценическими токенами удалён не будет.`,
            )
        )
            return;
        setBusy(true);
        setError('');
        try {
            await charactersApi.delete(null, draft.id);
            setBaseline(JSON.stringify(draft));
            setChildDirty(false);
            setBusy(false);
            window.setTimeout(() => location.assign(base), 0);
        } catch (e) {
            setError((e as Error).message);
            setBusy(false);
        }
    };
    if (!draft)
        return (
            <div>
                {error ? (
                    <p role="alert" className="form-error">
                        {error}
                        <button onClick={() => location.reload()}>Повторить</button>
                    </p>
                ) : (
                    <p role="status">Подготавливаем редактор…</p>
                )}
            </div>
        );
    const patch = (v: Partial<Character>) => {
        setDraft({ ...draft, ...v });
        setMessage('');
    };
    const scoresValid =
        !draft.rules ||
        (Object.values(draft.rules.scores).every((n) => Number.isInteger(n) && n >= 1 && n <= 30) &&
            (!creating ||
                method === 'manual' ||
                (method === 'array'
                    ? validArray(draft.rules.scores)
                    : pointRemaining(draft.rules.scores) >= 0)));
    const valid =
        !!draft.name.trim() &&
        scoresValid &&
        draft.hp <= draft.maxHp &&
        items.length <= 30 &&
        spells.length <= 24 &&
        items.every((i) => Number.isInteger(i.quantity) && i.quantity >= 1 && i.quantity <= 99);
    const reserved = draft.rules
        ? [...(derived?.checks ?? []).filter((s) => s.ability).map((s) => s.key), 'spell_save_dc']
        : [];
    return (
        <div className="control-editor">
            <div className="control-editor-toolbar">
                <button className="quiet-button" onClick={leave} disabled={busy}>
                    <ArrowLeft size={16} />К списку
                </button>
                <span role="status">
                    {busy
                        ? 'Сохранение…'
                        : childDirty
                          ? 'Сохраните настройки ячеек ниже'
                          : dirty
                            ? 'Есть изменения'
                            : message ||
                              (draft.id ? 'Все изменения сохранены' : 'Новый персонаж · черновик')}
                </span>
                {(!creating || section === 'Обзор') && (
                    <button
                        className="primary-button"
                        onClick={() => void save()}
                        disabled={
                            busy ||
                            campaignBusy ||
                            (!!draft.campaignId && !campaign) ||
                            childDirty ||
                            !valid ||
                            (creating &&
                                (previewBusy || !!previewError || calculatedFor !== previewData)) ||
                            (!dirty && !!draft.id)
                        }
                    >
                        <Save size={16} />
                        {draft.id ? 'Сохранить' : 'Подтвердить и создать'}
                    </button>
                )}
            </div>
            {error && (
                <p role="alert" className="form-error">
                    {error}
                </p>
            )}
            <nav className="control-editor-tabs" aria-label="Разделы персонажа">
                {(creating ? builderSteps : sections).map((s, index) => (
                    <button
                        key={s}
                        aria-pressed={section === s}
                        disabled={
                            busy || (creating && index > step) || (childDirty && s !== section)
                        }
                        onClick={() =>
                            creating ? setStep(index) : setSection(s as typeof editSection)
                        }
                    >
                        {creating ? `${index + 1}. ${s}` : s}
                    </button>
                ))}
            </nav>
            {creating && (
                <CharacterReview
                    compact
                    character={draft}
                    derived={derived}
                    campaign={campaign}
                    items={items}
                    spells={spells}
                />
            )}
            {campaignBusy && <p role="status">Загрузка назначения кампании…</p>}
            {creating && previewBusy && <p role="status">Обновляем расчёт на сервере…</p>}
            {creating && previewError && (
                <p role="alert" className="form-error">
                    {previewError}
                </p>
            )}
            <fieldset disabled={busy} className="control-editor-body">
                {(section === 'Доступ' || (creating && section === 'Личность')) && (
                    <>
                        <label className="field">
                            <span>Кампания · необязательно</span>
                            <select
                                aria-label="Назначить кампанию"
                                value={draft.campaignId ?? ''}
                                onChange={(e) => {
                                    patch({
                                        campaignId: e.target.value || null,
                                        ownerUserId: null,
                                    });
                                    setItems([]);
                                    setSpells([]);
                                }}
                            >
                                <option value="">Без кампании</option>
                                {campaigns.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <p className="hint">
                            Герой хранится в личной библиотеке. Кампания определяет доступного
                            игрока, приватный портрет и снаряжение. Перед переносом уберите
                            сценические токены и предметы текущей кампании.
                        </p>
                        {campaign && (
                            <CharacterAccess draft={draft} campaign={campaign} patch={patch} />
                        )}
                    </>
                )}
                {section === 'Ресурсы' && (
                    <ResourceEditor
                        sheet
                        resources={draft.resources ?? []}
                        onChange={(resources) => patch({ resources })}
                    />
                )}

                {section === 'Происхождение' && (
                    <section>
                        <h2>Откуда начинается история?</h2>
                        <p className="hint">
                            Необязательное описание героя. Происхождение не назначает бонусы, навыки
                            или классы автоматически.
                        </p>
                        {(['species', 'background'] as const).map((key) => (
                            <label className="field" key={key}>
                                <span>
                                    {key === 'species' ? 'Вид / происхождение' : 'Предыстория'}
                                </span>
                                <input
                                    maxLength={key === 'species' ? 120 : 240}
                                    value={draft.origin?.[key] ?? ''}
                                    onChange={(e) =>
                                        patch({
                                            origin: { ...draft.origin, [key]: e.target.value },
                                        })
                                    }
                                />
                            </label>
                        ))}
                    </section>
                )}
                {section === 'Обзор' && (
                    <>
                        <h2>Герой готов к вашей истории</h2>
                        <p className="hint">
                            Проверьте выбор перед созданием. Снаряжение попадёт в рюкзак; экипировка
                            и ячейки заклинаний доступны в быстром редакторе.
                        </p>
                        <CharacterReview
                            character={draft}
                            derived={derived}
                            campaign={campaign}
                            items={items}
                            spells={spells}
                        />
                    </>
                )}
                {section === 'Навыки и спасброски' && (
                    <>
                        {creating && <h2>Что умеет ваш герой?</h2>}
                        <p className="hint">
                            Владения выбираются вручную. Происхождение не задаёт лимит. ● —
                            владение, ◆ — компетентность.
                        </p>
                        {draft.rules && (
                            <p>
                                Выбрано навыков:{' '}
                                {
                                    Object.values(draft.rules.skills).filter((s) => s.proficient)
                                        .length
                                }
                            </p>
                        )}
                        <CharacterSheetRules
                            view="skills"
                            character={draft}
                            derived={calculatedFor === previewData ? derived : undefined}
                            onChange={(rules) => patch({ rules })}
                        />
                        {calculatedFor !== previewData && !previewError && (
                            <p role="status">Обновляем бонусы на сервере…</p>
                        )}
                        {previewError && (
                            <p role="alert" className="form-error">
                                {previewError}
                            </p>
                        )}
                    </>
                )}

                {section === 'Личность' && (
                    <CharacterIdentity
                        key={campaign?.id ?? 'none'}
                        draft={draft}
                        campaign={campaign}
                        creating={creating}
                        patch={patch}
                    />
                )}
                {section === 'Характеристики' && (
                    <>
                        {creating && draft.rules ? (
                            <AbilityBuilder
                                method={method}
                                rules={draft.rules}
                                derived={derived}
                                onChange={(rules) => patch({ rules })}
                                onMethod={setMethod}
                            />
                        ) : (
                            <CharacterSheetRules
                                view="attributes"
                                character={draft}
                                derived={calculatedFor === previewData ? derived : undefined}
                                onChange={(rules) => patch({ rules })}
                            />
                        )}
                        {previewBusy && <p role="status">Расчёт на сервере…</p>}
                        {previewError && (
                            <p role="alert" className="form-error">
                                {previewError}
                            </p>
                        )}
                        <details>
                            <summary>Advanced · особые проверки и legacy overrides</summary>
                            <CheckStatsEditor
                                stats={draft.checkStats.filter(
                                    (s) => !reserved.includes(canonicalStatKey(s.key)),
                                )}
                                reservedKeys={reserved}
                                disabled={busy}
                                save={(checkStats) =>
                                    patch({
                                        checkStats: [
                                            ...draft.checkStats.filter((s) =>
                                                reserved.includes(canonicalStatKey(s.key)),
                                            ),
                                            ...checkStats,
                                        ],
                                    })
                                }
                            />
                        </details>
                    </>
                )}
                {(section === 'Бой и ресурсы' || section === 'Бой') && (
                    <CharacterCombat
                        includeResources={creating}
                        draft={draft}
                        derived={calculatedFor === previewData ? derived : undefined}
                        patch={patch}
                    />
                )}
                {(section === 'Снаряжение' || section === 'Заклинания и способности') &&
                    (!creating && section === 'Снаряжение' ? (
                        <CharacterEquipment character={draft} locked={dirty} onChange={accept} />
                    ) : !creating ? (
                        <>
                            <CharacterSpellbook
                                key={draft.id}
                                character={draft}
                                locked={dirty}
                                onChange={accept}
                                onDirtyChange={setChildDirty}
                                childDirty={childDirty}
                            />
                            <details onToggle={(e) => setSpellAdvanced(e.currentTarget.open)}>
                                <summary>Advanced · правила и индивидуальные overrides</summary>
                                <fieldset disabled={childDirty}>
                                    <RulesEditor
                                        view="spells"
                                        character={draft}
                                        derived={derived}
                                        onChange={(rules) => patch({ rules })}
                                    />
                                    {spellAdvanced && (
                                        <AbilityEditor
                                            character={draft}
                                            campaignId={draft.campaignId ?? ''}
                                            onChange={(abilities) => patch({ abilities })}
                                        />
                                    )}
                                </fieldset>
                            </details>
                        </>
                    ) : !campaign ? (
                        <p className="hint">
                            Этот шаг необязателен. Назначьте кампанию в разделе «
                            {creating ? 'Личность' : 'Доступ'}», чтобы выбрать её предметы и
                            заклинания.
                        </p>
                    ) : (
                        <>
                            {section === 'Заклинания и способности' && (
                                <RulesEditor
                                    view="spells"
                                    character={draft}
                                    derived={derived}
                                    onChange={(rules) => patch({ rules })}
                                />
                            )}
                            <BuilderPicker
                                key={section}
                                campaignId={campaign!.id}
                                mode={section === 'Снаряжение' ? 'items' : 'spells'}
                                selected={section === 'Снаряжение' ? items : spells}
                                onChange={section === 'Снаряжение' ? setItems : setSpells}
                            />
                        </>
                    ))}
            </fieldset>
            {creating && (
                <div className="builder-footer">
                    <button
                        className="quiet-button"
                        disabled={busy || step === 0}
                        onClick={() => setStep((s) => s - 1)}
                    >
                        Назад
                    </button>
                    <span>
                        Шаг {step + 1} из {builderSteps.length}
                    </span>
                    {step < builderSteps.length - 1 && (
                        <button
                            className="primary-button"
                            disabled={busy || !valid}
                            onClick={() => setStep((s) => s + 1)}
                        >
                            Далее →
                        </button>
                    )}
                    {!valid && (
                        <p role="alert">
                            Проверьте имя, характеристики, HP и количество выбранных предметов /
                            заклинаний.
                        </p>
                    )}
                </div>
            )}
            {draft.id && (
                <div className="control-danger">
                    <p>Удаление доступно после удаления всех токенов персонажа со сцен.</p>
                    <button
                        className="quiet-button"
                        disabled={busy || childDirty}
                        onClick={() => void remove()}
                    >
                        <Trash2 size={15} />
                        Удалить персонажа
                    </button>
                </div>
            )}
        </div>
    );
}
