import { useState } from 'react';
import { RpgIcon } from '../gameplay/RpgIcon';
import { AbilityCost } from '../gameplay/AbilityCost';
import { canAfford, targetLabels, type Ability, type CharacterResource } from '../gameplay/model';
import { abilityBinding } from '../gameplay/hotbarModel';
import { useRpgDrag } from './RpgDrag';
export function SpellbookView({
    abilities,
    resources,
    onChoose,
    onBind,
}: {
    abilities: Ability[];
    resources: CharacterResource[];
    onChoose: (a: Ability) => void;
    onBind: (a: Ability) => void;
}) {
    const drag = useRpgDrag(),
        [selectedId, setSelected] = useState<string | null>(null),
        [category, setCategory] = useState('all'),
        [prepared, setPrepared] = useState(false),
        [school, setSchool] = useState('all'),
        [classTag, setClassTag] = useState('all'),
        [level, setLevel] = useState(-1),
        [search, setSearch] = useState('');
    const available = abilities.filter(
            (a) => !a.item_only && a.enabled && a.spell?.known !== false,
        ),
        schools = [...new Set(available.map((a) => a.spell?.school).filter(Boolean))] as string[],
        classes = [...new Set(available.flatMap((a) => a.spell?.classes ?? []))];
    const selected = available.find((a) => a.id === selectedId);
    const shown = available.filter(
        (a) =>
            (category === 'all' ||
                (category === 'spells'
                    ? !!a.spell || a.attack_type === 'spell'
                    : !a.spell && a.attack_type !== 'spell')) &&
            (!prepared || !a.spell || a.spell.prepared) &&
            (school === 'all' || a.spell?.school === school) &&
            (classTag === 'all' || a.spell?.classes.includes(classTag)) &&
            (level === -1 || a.spell?.level === level) &&
            a.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    );
    const groups = [
        ...new Set(shown.map((a) => a.spell?.level ?? (a.attack_type === 'spell' ? 0 : -1))),
    ].sort((a, b) => a - b);
    return (
        <div className={`spellbook-layout ${selected ? 'has-selection' : ''}`}>
            <section className="spellbook-catalog">
                <div className="rpg-filterbar">
                    <div className="rpg-chips">
                        {[
                            ['all', 'Все'],
                            ['spells', 'Заклинания'],
                            ['actions', 'Действия'],
                        ].map(([v, label]) => (
                            <button
                                key={v}
                                aria-pressed={category === v}
                                onClick={() => setCategory(v)}
                            >
                                {label}
                            </button>
                        ))}
                        <button aria-pressed={prepared} onClick={() => setPrepared(!prepared)}>
                            Подготовлены
                        </button>
                    </div>
                    <input
                        aria-label="Поиск в книге способностей"
                        placeholder="Поиск…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <details className="spellbook-filters">
                    <summary>Класс, школа и круг</summary>
                    <div className="rpg-chips">
                        {classes.map((v) => (
                            <button
                                key={v}
                                aria-pressed={classTag === v}
                                onClick={() => setClassTag(classTag === v ? 'all' : v)}
                            >
                                {v}
                            </button>
                        ))}
                    </div>
                    <div className="rpg-chips">
                        {schools.map((v) => (
                            <button
                                key={v}
                                aria-pressed={school === v}
                                onClick={() => setSchool(school === v ? 'all' : v)}
                            >
                                {v}
                            </button>
                        ))}
                    </div>
                    <div className="rpg-chips">
                        {[
                            ...new Set(
                                available.map((a) => a.spell?.level).filter((v) => v !== undefined),
                            ),
                        ].map((v) => (
                            <button
                                key={v}
                                aria-pressed={level === v}
                                onClick={() => setLevel(level === v ? -1 : v!)}
                            >
                                {v === 0 ? 'Заговоры' : `Круг ${v}`}
                            </button>
                        ))}
                    </div>
                </details>
                <div className="spellbook-groups">
                    {groups.map((group) => (
                        <section className="spellbook-section" key={group}>
                            <h2>
                                {group < 0
                                    ? 'Умения и действия'
                                    : group === 0
                                      ? 'Заговоры'
                                      : `${group} круг`}
                            </h2>
                            <div className="spell-tiles">
                                {shown
                                    .filter(
                                        (a) =>
                                            (a.spell?.level ??
                                                (a.attack_type === 'spell' ? 0 : -1)) === group,
                                    )
                                    .map((a) => (
                                        <button
                                            key={a.id}
                                            className={`spell-tile ${selected?.id === a.id ? 'is-selected' : ''} ${a.spell && !a.spell.prepared ? 'is-unprepared' : ''} ${drag.active?.sourceId === a.id ? 'is-lifted' : ''}`}
                                            aria-label={`Изучить: ${a.name}`}
                                            {...drag.source(abilityBinding(a.id))}
                                            onClick={() => {
                                                if (!drag.consumeClick()) setSelected(a.id);
                                            }}
                                            onDoubleClick={() => onChoose(a)}
                                        >
                                            <RpgIcon icon={a.icon} size={56} />
                                            <strong>{a.name}</strong>
                                            <small>
                                                {a.spell?.school ??
                                                    (a.category === 'attack' ? 'Атака' : 'Умение')}
                                            </small>
                                            <AbilityCost ability={a} resources={resources} />
                                            {a.spell && (
                                                <i>
                                                    {a.spell.prepared ? 'Подготовлено' : 'Известно'}
                                                </i>
                                            )}
                                            <span className="rpg-tooltip">
                                                <strong>{a.name}</strong>
                                                <span>{a.description}</span>
                                                <small>Перетащите в панель действий</small>
                                            </span>
                                        </button>
                                    ))}
                            </div>
                        </section>
                    ))}
                </div>
                {!shown.length && (
                    <p className="rpg-empty">
                        Здесь пока нет способностей. Измените фильтры или попросите GM добавить их
                        персонажу.
                    </p>
                )}
            </section>
            <aside className="spell-inspection">
                {selected ? (
                    <>
                        <button
                            className="rpg-quiet-button spell-details-back"
                            onClick={() => setSelected(null)}
                        >
                            ← К книге
                        </button>
                        <RpgIcon icon={selected.icon} size={100} />
                        <span className="rpg-kicker">
                            {selected.spell
                                ? `${selected.spell.level === 0 ? 'Заговор' : `${selected.spell.level} круг`} · ${selected.spell.school}`
                                : 'Действие персонажа'}
                        </span>
                        <h2>{selected.name}</h2>
                        <p>{selected.description}</p>
                        <div className="spell-traits">
                            {selected.spell?.classes.map((v) => (
                                <span key={v}>{v}</span>
                            ))}
                            {selected.spell?.ritual && <span>Ритуал</span>}
                            {selected.spell?.concentration && <span>Концентрация</span>}
                        </div>
                        <dl>
                            <div>
                                <dt>Цель</dt>
                                <dd>{targetLabels[selected.target]}</dd>
                            </div>
                            {selected.range && (
                                <div>
                                    <dt>Дальность</dt>
                                    <dd>
                                        {selected.range.normal}
                                        {selected.range.long ? ` / ${selected.range.long}` : ''}
                                    </dd>
                                </div>
                            )}
                            {selected.area && selected.area.shape !== 'none' && (
                                <div>
                                    <dt>Область</dt>
                                    <dd>
                                        {
                                            {
                                                circle: 'Круг',
                                                cone: 'Конус',
                                                line: 'Линия',
                                                rectangle: 'Прямоугольник',
                                                none: 'Нет',
                                            }[selected.area.shape]
                                        }{' '}
                                        · {selected.area.size}
                                    </dd>
                                </div>
                            )}
                            {selected.damage && (
                                <div>
                                    <dt>Урон</dt>
                                    <dd>{selected.damage}</dd>
                                </div>
                            )}
                            {selected.check && (
                                <div>
                                    <dt>Проверка</dt>
                                    <dd>{selected.check.stat_key ?? 'Бросок d20'}</dd>
                                </div>
                            )}
                        </dl>
                        <AbilityCost ability={selected} resources={resources} />
                        <button
                            className="rpg-gold-button"
                            disabled={
                                !canAfford(selected, resources) ||
                                selected.spell?.prepared === false
                            }
                            onClick={() => onChoose(selected)}
                        >
                            Применить
                        </button>
                        <button className="rpg-quiet-button" onClick={() => onBind(selected)}>
                            В панель действий
                        </button>
                    </>
                ) : (
                    <>
                        <RpgIcon icon="book" size={90} />
                        <h2>Знание — ваша сила</h2>
                        <p>Выберите способность. Здесь будут её свойства, стоимость и описание.</p>
                        <small>Перетащите любую иконку на панель действий.</small>
                    </>
                )}
            </aside>
        </div>
    );
}
