import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import { request } from '../api/client';
import type { Ability } from '../gameplay/model';
import { abilityBinding } from '../gameplay/hotbarModel';
import {
    CatalogCardHeader,
    CatalogBack,
    CatalogEmpty,
    CatalogIcon,
    CatalogLoading,
    CatalogOrigins,
    CatalogSearch,
    CoverageBadge,
    OriginBadge,
    rulesLabel,
    focusCatalogInspector,
    focusCatalogSearch,
} from '../compendium/Catalog';
import { commandId } from '../api/workspace';
import { RpgDragProvider, useRpgDrag } from '../rpg/RpgDrag';
import { SpellAuthoring } from './SpellAuthoring';
import { SpellCharacteristics, SpellResolutionFacts } from '../compendium/EntryFacts';
import {
    levelLabel,
    schoolLabel,
    schoolLabels,
    damageLabel,
    timeLabel,
    spellSummary,
} from '../compendium/presentation';
import { ContentReference } from '../compendium/ContentReference';

export interface LibrarySpell {
    copyable?: boolean;
    id: number;
    custom?: boolean;
    ability: Ability;
    source: { name: string; version: string; license: string; attribution: string; url: string };
}
export const spellLevel = levelLabel;
export const librarySpellId = (id: number) => `library-spell:${id}`;

export function SpellFacts({ ability: a }: { ability: Ability }) {
    return (
        <p className="spell-facts">
            {a.spell
                ? `${spellLevel(a.spell.level)} · ${schoolLabel(a.spell.school)}`
                : 'Способность'}
            {a.spell?.casting_time && (
                <span>
                    {timeLabel(a.spell.casting_time)} ·{' '}
                    {a.range
                        ? `${a.range.normal} фут.`
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
    actions,
}: {
    ability: Ability;
    source?: LibrarySpell['source'];
    actions?: ReactNode;
}) {
    return (
        <>
            <CatalogCardHeader
                name={a.name}
                icon={a.icon}
                kind="spell"
                tone={`school-${a.spell?.school?.toLowerCase().replace(/[^a-z]/g, '') ?? 'custom'}`}
                subtitle={
                    a.spell
                        ? `${spellLevel(a.spell.level)} · ${schoolLabel(a.spell.school)}`
                        : 'Способность'
                }
            >
                <span className="catalog-rules">
                    {rulesLabel(
                        a.spell?.content,
                        source ? `${source.name} ${source.version}` : undefined,
                    )}
                </span>
                <CoverageBadge coverage={a.spell?.coverage ?? 'MANUAL'} />
                {actions}
            </CatalogCardHeader>
            <section className="catalog-sheet-section">
                <h4 className="catalog-section-title">Характеристики</h4>
                <SpellCharacteristics ability={a} />
            </section>
            <section className="catalog-sheet-section">
                <h4 className="catalog-section-title">Механики YTT</h4>
                <SpellResolutionFacts ability={a} />
                {!!a.damage_components?.length && (
                    <p className="catalog-effect">
                        Урон ·{' '}
                        {a.damage_components
                            .map((c) => `${c.dice} ${damageLabel(c.type)}`)
                            .join(' + ')}
                    </p>
                )}
                {a.damage && !a.damage_components?.length && (
                    <p className="catalog-effect">Урон · {a.damage}</p>
                )}
                {a.result?.type === 'heal' && (
                    <p className="catalog-effect">
                        Восстановление HP · {a.result.dice || a.result.amount}
                    </p>
                )}
                <p className="hint">
                    {a.spell?.coverage === 'FULL'
                        ? 'Поддерживается существующим профилем YTT.'
                        : 'Часть условий и эффектов разрешает ГМ. Подготовка не включает ручное разрешение автоматически.'}
                </p>
                {!!a.spell?.reasons?.length && (
                    <details>
                        <summary>Границы поддержки</summary>
                        <p>{a.spell.reasons.join(' ')}</p>
                    </details>
                )}
            </section>
            <section className="catalog-sheet-section">
                <h4 className="catalog-section-title">Описание</h4>
                <p className="spell-reference">
                    {a.spell?.content?.reference ||
                        a.spell?.reference ||
                        a.description ||
                        'Описание пока не добавлено.'}
                </p>
            </section>
            {a.spell?.content && (
                <details className="catalog-source">
                    <summary>Сведения источника и примечания</summary>
                    <ContentReference content={a.spell.content} showText={false} />
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
        [school, setSchool] = useState(''),
        [origin, setOrigin] = useState('');
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
            if (origin) params.set('origin', origin);
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
    }, [search, level, school, origin, page, retry, revision]);
    return (
        <section className="spell-library-browser compendium-catalog" aria-label="Spell Library">
            <CatalogOrigins
                value={origin}
                onChange={(v) => {
                    setOrigin(v);
                    setPage(1);
                    setLoading(true);
                }}
            />
            <CatalogSearch
                label="Найти заклинание"
                placeholder="Название заклинания…"
                value={search}
                onChange={(v) => {
                    setSearch(v);
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
                    {Object.entries(schoolLabels).map(([key, label]) => (
                        <option key={key} value={key}>
                            {label}
                        </option>
                    ))}
                </select>
            </div>
            {error ? (
                <p role="alert" className="form-error">
                    {error} <button onClick={() => setRetry((v) => v + 1)}>Повторить</button>
                </p>
            ) : loading ? (
                <CatalogLoading />
            ) : (
                <>
                    <p className="catalog-result-count muted">{data?.total ?? 0} записей</p>
                    <div className="catalog-grid spell-library-grid">
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
                        <CatalogEmpty
                            filtered={!!(search || level || school || origin)}
                            onReset={() => {
                                setSearch('');
                                setLevel('');
                                setSchool('');
                                setOrigin('');
                                setPage(1);
                                setLoading(true);
                            }}
                        />
                    )}
                    {!!data?.total && (
                        <div className="button-row spell-pagination">
                            <button
                                disabled={page <= 1}
                                onClick={(e) => {
                                    setPage((p) => p - 1);
                                    setLoading(true);
                                    focusCatalogSearch(
                                        e.currentTarget.closest('.compendium-catalog'),
                                    );
                                }}
                            >
                                Назад
                            </button>
                            <span>
                                {page} / {data.pages} · {data.total} заклинаний
                            </span>
                            <button
                                disabled={page >= data.pages}
                                onClick={(e) => {
                                    setPage((p) => p + 1);
                                    setLoading(true);
                                    focusCatalogSearch(
                                        e.currentTarget.closest('.compendium-catalog'),
                                    );
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
                className={`catalog-entry catalog-entry-spell school-${s.ability.spell?.school} level-${s.ability.spell?.level}`}
                aria-pressed={selected}
                aria-label={`Заклинание: ${s.ability.name}`}
                {...drag.source(
                    abilityBinding(librarySpellId(s.id)),
                    !!onAdd && !disabled && !assigned && s.copyable !== false,
                )}
                onClick={() => {
                    if (!drag.consumeClick()) onInspect();
                }}
                onDoubleClick={() => {
                    if (!disabled && !assigned && s.copyable !== false) onAdd?.();
                }}
            >
                <CatalogIcon icon={s.ability.icon} kind="spell" />
                <span className="catalog-entry-copy">
                    <strong title={s.ability.name}>{s.ability.name}</strong>
                    <small>{schoolLabel(s.ability.spell!.school)}</small>
                </span>
                <span className="catalog-level" aria-label={levelLabel(s.ability.spell!.level)}>
                    <b>{s.ability.spell!.level || '◇'}</b>
                    <small>{s.ability.spell!.level ? 'круг' : 'заговор'}</small>
                </span>
                <span className="catalog-entry-facts">
                    {spellSummary(s.ability)
                        .slice(0, 2)
                        .map((fact, i) => (
                            <span key={i} title={fact}>
                                {fact}
                            </span>
                        ))}
                </span>
                <span className="catalog-entry-footer">
                    <OriginBadge custom={!!s.custom} />
                    <span
                        className="catalog-edition"
                        title={rulesLabel(
                            s.ability.spell?.content,
                            `${s.source.name} ${s.source.version}`,
                        )}
                    >
                        {s.source.version ? `SRD ${s.source.version}` : 'Своя запись'}
                    </span>
                </span>
            </button>
            {onAdd && (
                <button
                    className="spell-quick-add quiet-button"
                    aria-label={`Добавить ${s.ability.name}`}
                    title={assigned ? 'Уже в книге' : 'Добавить в книгу'}
                    disabled={disabled || assigned || s.copyable === false}
                    onClick={onAdd}
                >
                    {assigned ? '✓' : <Plus size={17} />}
                </button>
            )}
        </article>
    );
}

export function SpellLibrary() {
    const inspector = useRef<HTMLElement>(null);
    const [selected, setSelected] = useState<LibrarySpell | null>(null);
    const [editing, setEditing] = useState<{ entry?: LibrarySpell; duplicate: boolean } | null>(
        null,
    );
    const [revision, setRevision] = useState(0);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [message, setMessage] = useState('');
    const copy = async () => {
        if (!selected || busy || selected.copyable === false) return;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const r = await request<{ entry: LibrarySpell }>('/library/spells', 'POST', {
                copyFrom: selected.id,
                ability: structuredClone(selected.ability),
                clientMutationId: commandId(),
            });
            setSelected(r.entry);
            setRevision((v) => v + 1);
            setMessage(
                'Независимая копия добавлена в мою коллекцию. Теперь её можно редактировать.',
            );
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const edit = (entry?: LibrarySpell, duplicate = false) => {
        if (editing && !confirm('Отменить несохранённые изменения заклинания?')) return;
        setEditing({ entry, duplicate });
    };
    return (
        <section className="visual-compendium">
            <header className="control-heading">
                <div>
                    <span className="eyebrow">КОМПЕНДИУМ / ЗАКЛИНАНИЯ</span>
                    <h1>Заклинания</h1>
                    <p className="muted">
                        Ваш гримуар и системные правила. Найдите заклинание и создайте свой вариант.
                    </p>
                </div>
                <button
                    className="primary-button"
                    disabled={!!editing || busy}
                    onClick={() => edit()}
                >
                    <Plus size={17} />
                    Создать заклинание
                </button>
            </header>
            {message && (
                <p role="status" className="catalog-success">
                    {message}
                </p>
            )}
            {error && (
                <p role="alert" className="form-error">
                    {error}{' '}
                    <button disabled={busy} onClick={copy}>
                        Повторить копирование
                    </button>
                </p>
            )}
            <RpgDragProvider icon={() => 'spark'}>
                <div
                    className={`item-library-layout ${selected || editing ? 'has-inspection' : ''}`}
                >
                    <SpellLibraryBrowser
                        revision={revision}
                        selected={selected?.id}
                        disabled={busy}
                        onInspect={(s) => {
                            if (busy) return;
                            if (editing && !confirm('Отменить несохранённые изменения заклинания?'))
                                return;
                            setEditing(null);
                            setSelected(s);
                            setError('');
                            setMessage('');
                            focusCatalogInspector(inspector);
                        }}
                    />
                    <aside
                        ref={inspector}
                        tabIndex={-1}
                        className="library-inspector catalog-inspector"
                        aria-label="Просмотр заклинания"
                    >
                        {(selected || editing) && <CatalogBack />}
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
                                <OriginBadge custom={!!selected.custom} />
                                <SpellDetails
                                    ability={selected.ability}
                                    source={selected.source}
                                    actions={
                                        <div className="button-row">
                                            <button
                                                className="primary-button"
                                                disabled={busy || selected.copyable === false}
                                                onClick={copy}
                                            >
                                                {busy
                                                    ? 'Создание копии…'
                                                    : selected.custom
                                                      ? 'Создать вариант'
                                                      : 'Копировать в мою коллекцию'}
                                            </button>
                                            {selected.custom && (
                                                <button
                                                    disabled={busy}
                                                    onClick={() => edit(selected)}
                                                >
                                                    Редактировать
                                                </button>
                                            )}
                                        </div>
                                    }
                                />
                                {selected.copyable === false && (
                                    <p className="hint">
                                        Источник разрешает просмотр; копирование пока недоступно.
                                    </p>
                                )}
                                {!selected.custom && (
                                    <p className="hint">
                                        Системная запись доступна для чтения. Копия в вашей
                                        коллекции независима от каталога.
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
