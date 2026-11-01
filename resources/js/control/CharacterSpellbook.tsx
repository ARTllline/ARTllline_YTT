import { useRef, useState } from 'react';
import { BookOpen, Star, Trash2 } from 'lucide-react';
import type { Character } from '../tabletop/types/scene';
import type { Ability } from '../gameplay/model';
import { request } from '../api/client';
import { commandId } from '../api/workspace';
import { RpgIcon } from '../gameplay/RpgIcon';
import { RpgDragProvider, useRpgDrag } from '../rpg/RpgDrag';
import { SpellcastingEditor } from '../rpg/SpellcastingEditor';
import {
    SpellDetails,
    SpellFacts,
    SpellLibraryBrowser,
    spellLevel,
    type LibrarySpell,
} from './SpellLibrary';

type Command = {
    action: string;
    entryId?: number;
    abilityId?: string;
    prepared?: boolean;
    known?: boolean;
    available?: boolean;
    manual_allowed?: boolean;
};
export function CharacterSpellbook({
    character,
    locked,
    onChange,
    onDirtyChange,
    childDirty,
}: {
    character: Character;
    locked: boolean;
    onChange: (c: Character) => void;
    onDirtyChange: (dirty: boolean) => void;
    childDirty: boolean;
}) {
    const [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const [selection, setSelection] = useState<
        { abilityId: string } | { template: LibrarySpell } | null
    >(null);
    const [search, setSearch] = useState(''),
        [preparedOnly, setPreparedOnly] = useState(false);
    const pending = useRef<(Command & { clientMutationId: string }) | null>(null);
    const inFlight = useRef(false);
    const blocked = busy || locked || childDirty;
    const abilities = character.abilities ?? [];
    const assigned = abilities.flatMap((a) =>
        a.spell?.source_entry_id ? [a.spell.source_entry_id] : [],
    );
    const inspected =
        selection &&
        ('template' in selection
            ? selection.template.ability
            : abilities.find((a) => a.id === selection.abilityId));
    const owned = selection && 'abilityId' in selection ? inspected : undefined;
    const send = async (command?: Command) => {
        if (inFlight.current || locked || childDirty) return;
        const data = command ? { ...command, clientMutationId: commandId() } : pending.current;
        if (!data) return;
        pending.current = data;
        inFlight.current = true;
        setBusy(true);
        setError('');
        try {
            const result = await request<{ character: Character }>(
                `/library/characters/${character.id}/spells`,
                'POST',
                data,
            );
            onChange(result.character);
            pending.current = null;
        } catch (e) {
            setError((e as Error).message);
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    };
    const add = (s: LibrarySpell) => void send({ action: 'add', entryId: s.id });
    return (
        <div className="character-spellbook">
            <header className="equipment-intro">
                <div>
                    <span className="eyebrow">SPELLBOOK / {character.name}</span>
                    <h2>Книга заклинаний</h2>
                    <p className="muted">
                        {abilities.filter((a) => a.spell?.prepared).length} подготовлено ·{' '}
                        {abilities.filter((a) => a.spell).length} в книге
                    </p>
                </div>
                <span className="hint" role="status">
                    {locked
                        ? 'Сохраните изменения персонажа перед изменением книги.'
                        : childDirty
                          ? 'Сохраните настройки ячеек.'
                          : busy
                            ? 'Сохранение…'
                            : 'Изменения книги сохраняются сразу'}
                </span>
            </header>
            {error && (
                <p className="form-error" role="alert">
                    {error}{' '}
                    <button disabled={blocked} onClick={() => void send()}>
                        Повторить
                    </button>
                </p>
            )}
            {!!character.spellcasting && (
                <div className="gm-spell-slots" aria-label="Ячейки персонажа">
                    {Object.entries(character.spellcasting.slots)
                        .filter(([, slot]) => slot.max > 0)
                        .map(([level, slot]) => (
                            <span key={level}>
                                {spellLevel(Number(level))}{' '}
                                <strong>
                                    {slot.current} / {slot.max}
                                </strong>
                            </span>
                        ))}
                </div>
            )}
            <RpgDragProvider
                icon={(b) => abilities.find((a) => a.id === b.sourceId)?.icon ?? 'spark'}
            >
                <div className="gm-spellbook-layout">
                    <SpellbookPages
                        abilities={abilities}
                        assigned={assigned}
                        search={search}
                        setSearch={setSearch}
                        preparedOnly={preparedOnly}
                        setPreparedOnly={setPreparedOnly}
                        blocked={blocked}
                        selected={owned?.id}
                        inspect={(a) => setSelection({ abilityId: a.id })}
                        send={send}
                    />
                    <aside className="equipment-library spellbook-library">
                        <header>
                            <BookOpen size={18} />
                            <h3>Spell Library</h3>
                        </header>
                        <p className="hint">
                            Перетащите в книгу, нажмите + или дважды щёлкните карточку.
                        </p>
                        <SpellLibraryBrowser
                            selected={
                                selection && 'template' in selection
                                    ? selection.template.id
                                    : undefined
                            }
                            onInspect={(template) => setSelection({ template })}
                            onAdd={add}
                            assigned={assigned}
                            disabled={blocked}
                        />
                    </aside>
                    <aside className="library-inspector spellbook-inspector">
                        {inspected ? (
                            <>
                                <SpellDetails
                                    ability={inspected}
                                    source={
                                        selection && 'template' in selection
                                            ? selection.template.source
                                            : undefined
                                    }
                                />
                                {owned ? (
                                    <div className="spellbook-actions">
                                        {owned.spell && (
                                            <button
                                                className="secondary-button"
                                                disabled={blocked}
                                                onClick={() =>
                                                    void send({
                                                        action: 'configure',
                                                        abilityId: owned.id,
                                                        prepared: !owned.spell!.prepared,
                                                    })
                                                }
                                            >
                                                <Star size={16} />
                                                {owned.spell.prepared
                                                    ? 'Снять подготовку'
                                                    : 'Подготовить'}
                                            </button>
                                        )}
                                        <button
                                            className="quiet-button"
                                            disabled={blocked}
                                            onClick={() =>
                                                void send({ action: 'remove', abilityId: owned.id })
                                            }
                                        >
                                            <Trash2 size={15} />
                                            Убрать из книги
                                        </button>
                                        {owned.spell && (
                                            <details>
                                                <summary>Advanced · доступ и разрешения</summary>
                                                {(
                                                    [
                                                        ['known', 'Известно персонажу'],
                                                        ['available', 'Доступно для сотворения'],
                                                        [
                                                            'manual_allowed',
                                                            'Разрешить ручное применение GM',
                                                        ],
                                                    ] as const
                                                ).map(([key, label]) => (
                                                    <label key={key}>
                                                        <input
                                                            type="checkbox"
                                                            disabled={blocked}
                                                            checked={
                                                                owned.spell![key] ??
                                                                key === 'available'
                                                            }
                                                            onChange={(e) =>
                                                                void send({
                                                                    action: 'configure',
                                                                    abilityId: owned.id,
                                                                    [key]: e.target.checked,
                                                                })
                                                            }
                                                        />
                                                        {label}
                                                    </label>
                                                ))}
                                            </details>
                                        )}
                                    </div>
                                ) : (
                                    selection &&
                                    'template' in selection && (
                                        <button
                                            className="secondary-button"
                                            disabled={
                                                blocked || assigned.includes(selection.template.id)
                                            }
                                            onClick={() => add(selection.template)}
                                        >
                                            +{' '}
                                            {assigned.includes(selection.template.id)
                                                ? 'Уже в книге'
                                                : 'В книгу заклинаний'}
                                        </button>
                                    )
                                )}
                            </>
                        ) : (
                            <div className="control-empty">
                                <BookOpen size={32} />
                                <p>Выберите заклинание в книге или библиотеке.</p>
                            </div>
                        )}
                    </aside>
                </div>
            </RpgDragProvider>
            {character.campaignId ? (
                <fieldset disabled={locked || busy}>
                    <SpellcastingEditor
                        key={character.id}
                        character={character}
                        campaignId={character.campaignId}
                        onDirtyChange={onDirtyChange}
                        onSaved={onChange}
                    />
                </fieldset>
            ) : (
                <p className="hint">
                    {character.kind === 'npc'
                        ? 'Ячейки NPC настраиваются ниже. Применение — у независимой копии на сцене.'
                        : 'Книга доступна без кампании. Ячейки и применение в сессии — после назначения кампании.'}
                </p>
            )}
        </div>
    );
}

function SpellbookPages({
    abilities,
    assigned,
    search,
    setSearch,
    preparedOnly,
    setPreparedOnly,
    blocked,
    selected,
    inspect,
    send,
}: {
    abilities: Ability[];
    assigned: number[];
    search: string;
    setSearch: (v: string) => void;
    preparedOnly: boolean;
    setPreparedOnly: (v: boolean) => void;
    blocked: boolean;
    selected?: string;
    inspect: (a: Ability) => void;
    send: (c: Command) => Promise<void>;
}) {
    const drag = useRpgDrag();
    const key = 'character-spellbook';
    const filtered = abilities.filter(
        (a) =>
            a.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
            (!preparedOnly || a.spell?.prepared),
    );
    const groups = [...new Set(filtered.map((a) => (a.spell ? a.spell.level : -1)))].sort(
        (a, b) => a - b,
    );
    return (
        <section
            className={`spellbook-pages ${drag.over?.key === key ? (drag.over.valid ? 'drop-valid' : 'drop-invalid') : ''}`}
            aria-label="Книга персонажа"
            {...drag.destination(
                key,
                (b) =>
                    !blocked &&
                    b.sourceType === 'ability' &&
                    /^library-spell:\d+$/.test(b.sourceId) &&
                    !assigned.includes(Number(b.sourceId.slice(14))),
                (b) => void send({ action: 'add', entryId: Number(b.sourceId.slice(14)) }),
            )}
        >
            <div className="spellbook-tools">
                <input
                    aria-label="Поиск в книге"
                    placeholder="Найти в книге…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <button aria-pressed={preparedOnly} onClick={() => setPreparedOnly(!preparedOnly)}>
                    <Star size={15} />
                    Подготовленные
                </button>
            </div>
            {drag.active && (
                <p className="spell-drop-hint">
                    Отпустите заклинание здесь, чтобы добавить в книгу
                </p>
            )}
            {groups.map((level) => (
                <section className="gm-spell-level" key={level}>
                    <h3>
                        <span>{level < 0 ? 'Способности' : spellLevel(level)}</span>
                        <small>
                            {filtered.filter((a) => (a.spell?.level ?? -1) === level).length}
                        </small>
                    </h3>
                    <div className="spellbook-card-grid">
                        {filtered
                            .filter((a) => (a.spell?.level ?? -1) === level)
                            .map((a) => (
                                <article
                                    className={`spellbook-card ${a.spell?.prepared ? 'is-prepared' : ''}`}
                                    key={a.id}
                                >
                                    <button
                                        className="library-item"
                                        aria-pressed={selected === a.id}
                                        onClick={() => inspect(a)}
                                    >
                                        <RpgIcon icon={a.icon} size={48} />
                                        <strong>{a.name}</strong>
                                        <small>
                                            {a.spell
                                                ? !a.spell.known
                                                    ? 'Не изучено'
                                                    : a.spell.available === false
                                                      ? 'Доступ закрыт'
                                                      : a.spell.prepared
                                                        ? 'Подготовлено'
                                                        : 'В книге'
                                                : 'Способность'}
                                        </small>
                                        <span className="rpg-tooltip">
                                            <strong>{a.name}</strong>
                                            <SpellFacts ability={a} />
                                            <span>{a.description}</span>
                                        </span>
                                    </button>
                                    {a.spell && (
                                        <button
                                            className="spell-prepare quiet-button"
                                            aria-label={`Подготовить: ${a.name}`}
                                            aria-pressed={a.spell.prepared}
                                            disabled={blocked}
                                            onClick={() =>
                                                void send({
                                                    action: 'configure',
                                                    abilityId: a.id,
                                                    prepared: !a.spell!.prepared,
                                                })
                                            }
                                        >
                                            <Star
                                                size={15}
                                                fill={a.spell.prepared ? 'currentColor' : 'none'}
                                            />
                                        </button>
                                    )}
                                </article>
                            ))}
                    </div>
                </section>
            ))}
            {!filtered.length && (
                <div className="control-empty">
                    <BookOpen size={46} />
                    <h3>
                        {abilities.length
                            ? 'Нет подходящих заклинаний'
                            : 'Здесь начинается ваша магия'}
                    </h3>
                    <p>Перетащите заклинание из Spell Library или добавьте его кнопкой +.</p>
                </div>
            )}
            <p className="hint">
                {abilities.length} / 24 способностей · новые заклинания нужно подготовить перед
                применением.
            </p>
        </section>
    );
}
