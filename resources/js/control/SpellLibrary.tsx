import { useEffect, useState } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import { request } from '../api/client';
import type { Ability } from '../gameplay/model';
import { abilityBinding } from '../gameplay/hotbarModel';
import { RpgIcon } from '../gameplay/RpgIcon';
import { RpgDragProvider, useRpgDrag } from '../rpg/RpgDrag';
import { SpellAuthoring } from './SpellAuthoring';

export interface LibrarySpell {
    id: number;
    custom?: boolean;
    ability: Ability;
    source: { name: string; version: string; license: string; attribution: string; url: string };
}
export const spellLevel = (level: number) => (level === 0 ? 'Заговоры' : `Круг ${level}`);
export const librarySpellId = (id: number) => `library-spell:${id}`;
const schools = [
    'Abjuration',
    'Conjuration',
    'Divination',
    'Enchantment',
    'Evocation',
    'Illusion',
    'Necromancy',
    'Transmutation',
];

export function SpellFacts({ ability: a }: { ability: Ability }) {
    return (
        <p className="spell-facts">
            {a.spell ? `${spellLevel(a.spell.level)} · ${a.spell.school}` : 'Способность'}
            {a.spell?.casting_time && (
                <span>
                    {a.spell.casting_time} ·{' '}
                    {a.range
                        ? `${a.range.normal} ft`
                        : a.target === 'self'
                          ? 'На себя'
                          : 'По описанию'}
                </span>
            )}
            {a.spell?.concentration && <span>Концентрация</span>}
            {a.spell?.ritual && <span>Ритуал</span>}
        </p>
    );
}

export function SpellDetails({
    ability: a,
    source,
}: {
    ability: Ability;
    source?: LibrarySpell['source'];
}) {
    return (
        <>
            <RpgIcon icon={a.icon} size={64} />
            <h3>{a.name}</h3>
            <SpellFacts ability={a} />
            <p>{a.spell?.duration_text}</p>
            {!!a.damage_components?.length && (
                <p>{a.damage_components.map((c) => `${c.dice} ${c.type}`).join(' + ')}</p>
            )}
            {a.damage && <p>Урон · {a.damage}</p>}
            {a.result?.type === 'heal' && (
                <p>Восстановление HP · {a.result.dice || a.result.amount}</p>
            )}
            <p>
                {a.spell?.components?.join(' · ')} {a.spell?.material}
            </p>
            <p className="spell-reference">
                {a.spell?.reference || a.description || 'Описание пока не добавлено.'}
            </p>
            {a.spell && (
                <details>
                    <summary>Поддержка правил · {a.spell.coverage ?? 'MANUAL'}</summary>
                    <p>{a.spell.reasons?.join(' ')}</p>
                    <p className="hint">
                        Заклинания PARTIAL / MANUAL могут требовать решения GM. Подготовка не
                        включает ручное разрешение автоматически.
                    </p>
                </details>
            )}
            {source && (
                <details>
                    <summary>
                        Источник · {source.name} {source.version}
                    </summary>
                    <p>{source.attribution}</p>
                    <p>{source.license}</p>
                </details>
            )}
        </>
    );
}

export function SpellLibraryBrowser({
    selected,
    onInspect,
    onAdd,
    assigned = [],
    disabled = false,
    revision = 0,
}: {
    selected?: number;
    onInspect: (spell: LibrarySpell) => void;
    onAdd?: (spell: LibrarySpell) => void;
    assigned?: number[];
    disabled?: boolean;
    revision?: number;
}) {
    const [search, setSearch] = useState(''),
        [level, setLevel] = useState(''),
        [school, setSchool] = useState('');
    const [page, setPage] = useState(1),
        [retry, setRetry] = useState(0);
    const [data, setData] = useState<{
        entries: LibrarySpell[];
        pages: number;
        total: number;
    } | null>(null);
    const [error, setError] = useState(''),
        [loading, setLoading] = useState(true);
    useEffect(() => {
        const abort = new AbortController();
        const timer = setTimeout(() => {
            setLoading(true);
            setError('');
            const params = new URLSearchParams({ search, page: String(page) });
            if (level !== '') params.set('level', level);
            if (school) params.set('school', school);
            void request<{ entries: LibrarySpell[]; pages: number; total: number }>(
                `/library/spells?${params}`,
                'GET',
                undefined,
                abort.signal,
            )
                .then((r) => {
                    if (!abort.signal.aborted) setData(r);
                })
                .catch((e) => {
                    if (!abort.signal.aborted) setError(e.message);
                })
                .finally(() => {
                    if (!abort.signal.aborted) setLoading(false);
                });
        }, 180);
        return () => {
            abort.abort();
            clearTimeout(timer);
        };
    }, [search, level, school, page, retry, revision]);
    return (
        <section className="spell-library-browser" aria-label="Spell Library">
            <input
                aria-label="Найти заклинание"
                placeholder="Поиск в Spell Library…"
                maxLength={100}
                value={search}
                onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                    setLoading(true);
                }}
            />
            <div className="spell-library-filters">
                <select
                    aria-label="Круг заклинаний"
                    value={level}
                    onChange={(e) => {
                        setLevel(e.target.value);
                        setPage(1);
                        setLoading(true);
                    }}
                >
                    <option value="">Все круги</option>
                    {Array.from({ length: 10 }, (_, i) => (
                        <option key={i} value={i}>
                            {spellLevel(i)}
                        </option>
                    ))}
                </select>
                <select
                    aria-label="Школа магии"
                    value={school}
                    onChange={(e) => {
                        setSchool(e.target.value);
                        setPage(1);
                        setLoading(true);
                    }}
                >
                    <option value="">Все школы</option>
                    {schools.map((s) => (
                        <option key={s} value={s.toLowerCase()}>
                            {s}
                        </option>
                    ))}
                </select>
            </div>
            {error ? (
                <p role="alert" className="form-error">
                    {error} <button onClick={() => setRetry((v) => v + 1)}>Повторить</button>
                </p>
            ) : loading ? (
                <p role="status">Загрузка заклинаний…</p>
            ) : (
                <>
                    <div className="library-item-grid spell-library-grid">
                        {data?.entries.map((s) => (
                            <SpellSource
                                key={s.id}
                                spell={s}
                                selected={selected === s.id}
                                disabled={disabled}
                                assigned={assigned.includes(s.id)}
                                onInspect={() => onInspect(s)}
                                onAdd={onAdd ? () => onAdd(s) : undefined}
                            />
                        ))}
                    </div>
                    {!data?.entries.length && (
                        <div className="control-empty">
                            <BookOpen size={32} />
                            <p>
                                {search || level || school
                                    ? 'Заклинаний по этому запросу нет.'
                                    : 'Каталог пуст. Импортируйте заклинания SRD в Compendium.'}
                            </p>
                        </div>
                    )}
                    {!!data?.total && (
                        <div className="button-row spell-pagination">
                            <button
                                disabled={page <= 1}
                                onClick={() => {
                                    setPage((p) => p - 1);
                                    setLoading(true);
                                }}
                            >
                                Назад
                            </button>
                            <span>
                                {page} / {data.pages} · {data.total} заклинаний
                            </span>
                            <button
                                disabled={page >= data.pages}
                                onClick={() => {
                                    setPage((p) => p + 1);
                                    setLoading(true);
                                }}
                            >
                                Далее
                            </button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

function SpellSource({
    spell: s,
    selected,
    assigned,
    disabled,
    onInspect,
    onAdd,
}: {
    spell: LibrarySpell;
    selected: boolean;
    assigned: boolean;
    disabled: boolean;
    onInspect: () => void;
    onAdd?: () => void;
}) {
    const drag = useRpgDrag();
    return (
        <article className={`spell-library-entry ${assigned ? 'is-assigned' : ''}`}>
            <button
                className="library-item"
                aria-pressed={selected}
                aria-label={`Заклинание: ${s.ability.name}`}
                {...drag.source(
                    abilityBinding(librarySpellId(s.id)),
                    !!onAdd && !disabled && !assigned,
                )}
                onClick={() => {
                    if (!drag.consumeClick()) onInspect();
                }}
                onDoubleClick={() => {
                    if (!disabled && !assigned) onAdd?.();
                }}
            >
                <RpgIcon icon={s.ability.icon} size={48} />
                <strong>{s.ability.name}</strong>
                <small>
                    {s.custom ? 'Custom · ' : ''}
                    {spellLevel(s.ability.spell!.level)} · {s.ability.spell!.school}
                </small>
                <span className="rpg-tooltip">
                    <strong>{s.ability.name}</strong>
                    <SpellFacts ability={s.ability} />
                    <span>{s.ability.description}</span>
                </span>
            </button>
            {onAdd && (
                <button
                    className="spell-quick-add quiet-button"
                    aria-label={`Добавить ${s.ability.name}`}
                    title={assigned ? 'Уже в книге' : 'Добавить в книгу'}
                    disabled={disabled || assigned}
                    onClick={onAdd}
                >
                    {assigned ? '✓' : <Plus size={17} />}
                </button>
            )}
        </article>
    );
}

export function SpellLibrary() {
    const [selected, setSelected] = useState<LibrarySpell | null>(null);
    const [editing, setEditing] = useState<{ entry?: LibrarySpell; duplicate: boolean } | null>(
        null,
    );
    const [revision, setRevision] = useState(0);
    const edit = (entry?: LibrarySpell, duplicate = false) => {
        if (editing && !confirm('Отменить несохранённые изменения заклинания?')) return;
        setEditing({ entry, duplicate });
    };
    return (
        <section>
            <header className="control-heading">
                <div>
                    <span className="eyebrow">GM HUB / SPELL LIBRARY</span>
                    <h1>Заклинания</h1>
                    <p className="muted">
                        Ваши заклинания и SRD. Создавайте варианты через Duplicate.
                    </p>
                </div>
                <button className="primary-button" disabled={!!editing} onClick={() => edit()}>
                    <Plus size={17} />
                    Создать заклинание
                </button>
            </header>
            <RpgDragProvider icon={() => 'spark'}>
                <div className="item-library-layout">
                    <SpellLibraryBrowser
                        revision={revision}
                        selected={selected?.id}
                        onInspect={setSelected}
                    />
                    <aside className="library-inspector">
                        {editing ? (
                            <SpellAuthoring
                                key={`${editing.entry?.id ?? 'new'}:${editing.duplicate}`}
                                {...editing}
                                onCancel={() => setEditing(null)}
                                onSaved={(s) => {
                                    setSelected(s);
                                    setEditing(null);
                                    setRevision((v) => v + 1);
                                }}
                            />
                        ) : selected ? (
                            <>
                                <SpellDetails ability={selected.ability} source={selected.source} />
                                <div className="button-row">
                                    <button
                                        className="primary-button"
                                        onClick={() => edit(selected, true)}
                                    >
                                        Duplicate / Copy to custom
                                    </button>
                                    {selected.custom && (
                                        <button onClick={() => edit(selected)}>
                                            Редактировать
                                        </button>
                                    )}
                                </div>
                                {!selected.custom && (
                                    <p className="hint">
                                        SRD доступен только для чтения. Создайте custom-копию для
                                        изменений.
                                    </p>
                                )}
                                <p className="hint">
                                    Откройте Spellbook персонажа: перетащите заклинание из
                                    встроенной библиотеки или нажмите +.
                                </p>
                            </>
                        ) : (
                            <div className="control-empty">
                                <BookOpen size={36} />
                                <p>Выберите заклинание, чтобы прочитать описание.</p>
                            </div>
                        )}
                    </aside>
                </div>
            </RpgDragProvider>
        </section>
    );
}
