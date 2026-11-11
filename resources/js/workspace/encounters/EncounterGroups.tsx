import { EyeOff, Plus, X } from 'lucide-react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { Token } from '../../tabletop/types/scene';
import { assignMembers, type PreparedEncounter } from './model';

export function EncounterGroups({
    selected,
    tokens,
    selectedIds,
    busy,
    store,
    persist,
    libraryGroup,
    setLibraryGroup,
}: {
    selected: PreparedEncounter;
    tokens: ReadonlyMap<string, Token>;
    selectedIds: readonly string[];
    busy: boolean;
    store: SceneStore;
    persist: (value: PreparedEncounter) => void;
    libraryGroup: string | null;
    setLibraryGroup: (id: string | null) => void;
}) {
    return (
        <>
            {selected.groups.map((g, index) => {
                const visible = g.tokenIds.filter((id) => !tokens.get(id)?.isHidden);
                return (
                    <section className="encounter-group" key={g.id} aria-label={g.name}>
                        <header>
                            <span className="encounter-group-number">
                                {index === 0 ? 'I' : `R${index}`}
                            </span>
                            <input
                                key={g.name}
                                aria-label={`Название группы ${index + 1}`}
                                defaultValue={g.name}
                                disabled={busy}
                                maxLength={80}
                                onBlur={(e) => {
                                    const name = e.target.value.trim();
                                    if (name && name !== g.name)
                                        persist({
                                            ...selected,
                                            groups: selected.groups.map((group) =>
                                                group.id === g.id ? { ...group, name } : group,
                                            ),
                                        });
                                    else e.target.value = g.name;
                                }}
                            />
                            <small>{g.tokenIds.length}</small>
                            {index > 0 && (
                                <button
                                    className="icon-button"
                                    aria-label={`Удалить группу ${g.name}`}
                                    title="Участники перейдут в основную группу"
                                    disabled={busy}
                                    onClick={() => {
                                        setLibraryGroup(null);
                                        persist({
                                            ...selected,
                                            groups: selected.groups
                                                .filter((group) => group.id !== g.id)
                                                .map((group, i) =>
                                                    i === 0
                                                        ? {
                                                              ...group,
                                                              tokenIds: [
                                                                  ...group.tokenIds,
                                                                  ...g.tokenIds,
                                                              ].sort(
                                                                  (a, b) => Number(a) - Number(b),
                                                              ),
                                                          }
                                                        : group,
                                                ),
                                        });
                                    }}
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </header>
                        {index > 0 && (
                            <p className={visible.length ? 'encounter-warning' : 'hint'}>
                                {visible.length
                                    ? `${visible.length} без ручного скрытия`
                                    : 'Участники скрыты вручную'}{' '}
                                · появление вручную в сессии
                            </p>
                        )}
                        {g.tokenIds.map((id) => (
                            <div className="encounter-member" key={id}>
                                <button
                                    onClick={() => store.select(id)}
                                    title="Выбрать участника на карте"
                                >
                                    {tokens.get(id)?.isHidden && <EyeOff size={13} />}
                                    <span>{tokens.get(id)?.name ?? 'Участник'}</span>
                                </button>
                                <select
                                    aria-label={`Группа: ${tokens.get(id)?.name}`}
                                    disabled={busy}
                                    value={g.id}
                                    onChange={(e) =>
                                        persist(assignMembers(selected, [id], e.target.value))
                                    }
                                >
                                    {selected.groups.map((group) => (
                                        <option key={group.id} value={group.id}>
                                            {group.name}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    className="icon-button"
                                    aria-label={`Исключить ${tokens.get(id)?.name}`}
                                    title="Исключить из Encounter; оставить на карте"
                                    disabled={busy}
                                    onClick={() => persist(assignMembers(selected, [id], ''))}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                        {!g.tokenIds.length && <p className="hint">Пока нет участников</p>}
                        <div className="encounter-group-actions">
                            <button
                                className="secondary-button"
                                disabled={busy || !selectedIds.length}
                                onClick={() =>
                                    persist(assignMembers(selected, [...selectedIds], g.id))
                                }
                            >
                                <Plus size={13} /> Из выделения
                            </button>
                            <button
                                className="secondary-button"
                                disabled={busy}
                                aria-pressed={libraryGroup === g.id}
                                onClick={() => setLibraryGroup(libraryGroup === g.id ? null : g.id)}
                            >
                                NPC Library
                            </button>
                            {index > 0 && visible.length > 0 && (
                                <button
                                    className="secondary-button"
                                    disabled={busy}
                                    onClick={() =>
                                        store.objectCommand({
                                            endpoint: 'selection',
                                            data: {
                                                action: 'hide',
                                                tokenIds: g.tokenIds,
                                                propIds: [],
                                            },
                                        })
                                    }
                                >
                                    <EyeOff size={13} /> Скрыть резерв
                                </button>
                            )}
                        </div>
                    </section>
                );
            })}
            {selected.groups.length < 10 && (
                <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                        persist({
                            ...selected,
                            groups: [
                                ...selected.groups,
                                {
                                    id: crypto.randomUUID(),
                                    name: `Резерв ${selected.groups.length}`,
                                    tokenIds: [],
                                },
                            ],
                        })
                    }
                >
                    <Plus size={14} /> Резервная группа
                </button>
            )}
        </>
    );
}
