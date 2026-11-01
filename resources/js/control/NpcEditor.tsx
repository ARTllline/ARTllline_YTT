import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { request } from '../api/client';
import { commandId } from '../api/workspace';
import { charactersApi } from '../api/characters';
import type { Character } from '../tabletop/types/scene';
import type { CharacterRules, DerivedCharacter } from '../rpg/rules';
import { CharacterSheetRules } from './CharacterSheetRules';
import { CharacterEquipment } from './CharacterEquipment';
import { CharacterSpellbook } from './CharacterSpellbook';
import { AbilityEditor } from '../gameplay/AbilityEditor';
import { NpcIdentity, NpcCombat, NpcSlots } from './NpcEditorPanels';
import { RulesEditor } from '../rpg/RulesEditor';

const sections = [
    'Личность',
    'Характеристики',
    'Навыки и спасброски',
    'Бой',
    'Атаки и способности',
    'Заклинания',
    'Снаряжение / Loot',
] as const;

export function NpcEditor({
    initial,
    onSaved,
}: {
    initial?: Character;
    onSaved: (c: Character) => void;
}) {
    const [draft, setDraft] = useState<Character | null>(initial ?? null);
    const [baseline, setBaseline] = useState(initial ? JSON.stringify(initial) : '');
    const [section, setSection] = useState<(typeof sections)[number]>('Личность');
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [message, setMessage] = useState('');
    const [childDirty, setChildDirty] = useState(false);
    const [derived, setDerived] = useState<DerivedCharacter | undefined>(initial?.derived);
    const [previewError, setPreviewError] = useState('');
    const dirty = !!draft && JSON.stringify(draft) !== baseline;
    const accept = (c: Character) => {
        setDraft(c);
        setBaseline(JSON.stringify(c));
        setDerived(c.derived);
        onSaved(c);
    };
    useEffect(() => {
        const abort = new AbortController();
        if (!initial)
            void request<{ defaults: CharacterRules | null }>(
                '/library/character-rules/catalog',
                'GET',
                undefined,
                abort.signal,
            )
                .then((r) => {
                    const c: Character = {
                        id: '',
                        campaignId: null,
                        name: '',
                        kind: 'npc',
                        disposition: 'hostile',
                        portrait: null,
                        ownerUserId: null,
                        hp: 10,
                        maxHp: 10,
                        ac: 10,
                        speed: 30,
                        checkStats: [],
                        resources: [],
                        abilities: [],
                        rules: r.defaults,
                        combatProfile: {},
                    };
                    setDraft(c);
                    setBaseline(JSON.stringify(c));
                })
                .catch((e) => {
                    if (!abort.signal.aborted) setError(e.message);
                });
        return () => abort.abort();
    }, [initial]);
    useEffect(() => {
        if (!dirty && !childDirty && !busy) return;
        const guard = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', guard);
        return () => window.removeEventListener('beforeunload', guard);
    }, [dirty, childDirty, busy]);
    const preview = draft
        ? JSON.stringify({
              id: draft.id,
              rules: draft.rules,
              ac: draft.ac,
              speed: draft.speed,
              checkStats: draft.checkStats,
          })
        : '';
    useEffect(() => {
        if (!preview) return;
        const abort = new AbortController();
        const timer = setTimeout(() => {
            void charactersApi
                .preview(null, JSON.parse(preview) as Character, abort.signal)
                .then((r) => {
                    if (!abort.signal.aborted) {
                        setDerived(r.derived);
                        setPreviewError('');
                    }
                })
                .catch((e) => {
                    if (!abort.signal.aborted) setPreviewError(e.message);
                });
        }, 250);
        return () => {
            abort.abort();
            clearTimeout(timer);
        };
    }, [preview]);
    const patch = (values: Partial<Character>) => setDraft((c) => (c ? { ...c, ...values } : c));
    const save = async () => {
        if (!draft || busy) return;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const { character } = await request<{ character: Character }>('/library/npcs', 'POST', {
                id: draft.id || undefined,
                name: draft.name,
                kind: 'npc',
                disposition: draft.disposition,
                portrait_asset_id: draft.portrait?.id ?? null,
                origin: draft.origin,
                hp: draft.hp,
                max_hp: draft.maxHp,
                ac: draft.ac,
                speed: draft.speed,
                rules: draft.rules,
                check_stats: draft.checkStats,
                resources: draft.resources ?? [],
                abilities: draft.abilities ?? [],
                combat_profile: draft.combatProfile,
                npc_loot_backpack: draft.npcLootBackpack ?? false,
                spellcasting: draft.spellcasting,
                clientMutationId: commandId(),
            });
            accept(character);
            setMessage('NPC сохранён');
            if (!draft.id) {
                setBusy(false);
                window.setTimeout(() => location.assign(`/control/npcs/${character.id}`), 0);
            }
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    if (!draft) return <p role={error ? 'alert' : 'status'}>{error || 'Загрузка редактора…'}</p>;
    return (
        <div className="control-editor npc-editor">
            <div className="control-editor-toolbar">
                <a href="/control/npcs">← NPC Library</a>
                <span className="muted">
                    {dirty ? 'Есть несохранённые изменения' : message || 'Все изменения сохранены'}
                </span>
                <button
                    className="primary-button"
                    disabled={busy || childDirty || !draft.name.trim() || draft.hp > draft.maxHp}
                    onClick={() => void save()}
                >
                    <Save size={16} />
                    {busy ? 'Сохранение…' : draft.id ? 'Сохранить NPC' : 'Создать NPC'}
                </button>
            </div>
            {error && (
                <p role="alert" className="form-error">
                    {error}
                </p>
            )}
            {previewError && (
                <p role="alert" className="form-error">
                    {previewError}
                </p>
            )}
            <nav className="control-editor-tabs" aria-label="Разделы NPC">
                {sections.map((s) => (
                    <button
                        key={s}
                        aria-pressed={section === s}
                        disabled={busy || childDirty}
                        onClick={() => setSection(s)}
                    >
                        {s}
                    </button>
                ))}
            </nav>
            <fieldset disabled={busy} className="control-editor-body">
                {section === 'Личность' && <NpcIdentity draft={draft} patch={patch} />}
                {(section === 'Характеристики' || section === 'Навыки и спасброски') && (
                    <CharacterSheetRules
                        character={draft}
                        derived={derived}
                        view={section === 'Характеристики' ? 'attributes' : 'skills'}
                        onChange={(rules) => patch({ rules })}
                    />
                )}
                {section === 'Бой' && <NpcCombat draft={draft} derived={derived} patch={patch} />}
                {section === 'Атаки и способности' && (
                    <>
                        <p className="hint">
                            Атаки и действия используют существующие правила combat. Условные и
                            текстовые эффекты разрешает GM.
                        </p>
                        <AbilityEditor
                            character={draft}
                            campaignId=""
                            onChange={(abilities) => patch({ abilities })}
                        />
                    </>
                )}
                {section === 'Заклинания' && (
                    <>
                        {draft.id ? (
                            <CharacterSpellbook
                                character={draft}
                                locked={dirty}
                                onChange={accept}
                                childDirty={childDirty}
                                onDirtyChange={setChildDirty}
                            />
                        ) : (
                            <p className="hint">
                                Создайте NPC, чтобы назначать заклинания из Spell Library
                                перетаскиванием.
                            </p>
                        )}
                        <NpcSlots character={draft} patch={patch} />
                        <details>
                            <summary>Advanced · параметры заклинаний</summary>
                            <RulesEditor
                                view="spells"
                                character={draft}
                                derived={derived}
                                onChange={(rules) => patch({ rules })}
                            />
                        </details>
                    </>
                )}
                {section === 'Снаряжение / Loot' && (
                    <>
                        <label className="field">
                            <span>
                                <input
                                    type="checkbox"
                                    checked={draft.npcLootBackpack ?? false}
                                    onChange={(e) => patch({ npcLootBackpack: e.target.checked })}
                                />{' '}
                                Рюкзак — подготовленная добыча
                            </span>
                        </label>
                        <p className="hint">
                            При размещении неэкипированные вещи попадут в закрытый corpse loot.
                            Игроки получат доступ после поражения NPC. Экипировка остаётся у NPC.
                        </p>
                        <p className="hint">
                            Экипируйте оружие и броню; настройте рюкзак экземпляра NPC.
                        </p>
                        {draft.id ? (
                            <CharacterEquipment
                                character={draft}
                                locked={dirty}
                                onChange={accept}
                            />
                        ) : (
                            <p>
                                Создайте NPC, чтобы добавлять предметы из Item Library
                                перетаскиванием.
                            </p>
                        )}
                    </>
                )}
                {draft.npcSource && (
                    <details className="npc-source">
                        <summary>SRD · исходный stat block и атрибуция</summary>
                        <p>
                            {draft.npcSource.name} {draft.npcSource.version} ·{' '}
                            {draft.npcSource.license}
                        </p>
                        <p>{draft.npcSource.attribution}</p>
                        <p className="hint">
                            Простые атаки перенесены. Особые эффекты, альтернативный урон,
                            легендарные действия и текстовые правила проверяет GM. Полный исходник
                            сохранён ниже.
                        </p>
                        <pre>{JSON.stringify(draft.npcSource.reference, null, 2)}</pre>
                    </details>
                )}
            </fieldset>
        </div>
    );
}
