import { EncounterGroups } from './EncounterGroups';
import { useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Plus, Swords, Trash2, X } from 'lucide-react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { SaveQueue } from '../../tabletop/state/SaveQueue';
import type { Placement } from '../creation/model';
import { EntityPicker, initialCatalogQuery } from '../creation/EntityPicker';
import { Panel } from '../ui/Controls';
import { newEncounter, type PreparedEncounter } from './model';
import '../../../css/encounters.css';

export function EncounterSelection({
    store,
    onOpen,
    disabled = false,
}: {
    store: SceneStore;
    onOpen: () => void;
    disabled?: boolean;
}) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    if (!state.selectedIds.length || store.role !== 'gm') return null;
    return (
        <button
            className="secondary-button encounter-selection-action"
            disabled={disabled}
            onClick={() => {
                const encounter = newEncounter([...state.selectedIds]);
                store.encounterCommand({ id: encounter.id, expected: null, value: encounter });
                store.selectEncounter(encounter.id);
                onOpen();
            }}
        >
            <Swords size={15} /> Создать Encounter · {state.selectedIds.length}
        </button>
    );
}

export function EncounterPanel({
    store,
    queue,
    onClose,
    onPlace,
    onDragStart,
    onDragEnd,
}: {
    store: SceneStore;
    queue: SaveQueue;
    onClose: () => void;
    onPlace: (item: Placement) => void;
    onDragStart?: (item: Placement) => void;
    onDragEnd?: () => void;
}) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const save = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
    const [listing, setListing] = useState(false);
    const [libraryGroup, setLibraryGroup] = useState<string | null>(null);
    const [query, setQuery] = useState(initialCatalogQuery);
    const [confirm, setConfirm] = useState(false);
    const busy = save.status !== 'saved' || !!state.duplicatePlacement;
    const encounters = state.scene.encounters ?? [];
    const selected = !listing && encounters.find((e) => e.id === state.selectedEncounterId);
    const tokens = new Map(state.scene.tokens.map((t) => [t.id, t]));
    const persist = (value: PreparedEncounter | null) => {
        if (!selected || busy) return;
        store.encounterCommand({
            id: selected.id,
            expected: selected,
            value:
                value && !value.groups[0].tokenIds.length ? { ...value, status: 'draft' } : value,
        });
    };
    const choose = (id: string) => {
        setListing(false);
        setLibraryGroup(null);
        setConfirm(false);
        store.selectEncounter(id);
    };
    const create = () => {
        const e = newEncounter([...state.selectedIds]);
        store.encounterCommand({ id: e.id, expected: null, value: e });
        choose(e.id);
    };
    return (
        <Panel title="Столкновения" subtitle="ПОДГОТОВКА · ТОЛЬКО GM" onClose={onClose}>
            <div className="encounter-panel">
                {state.editorNotice && (
                    <p className="encounter-warning" role="alert">
                        {state.editorNotice}
                    </p>
                )}
                {save.status === 'failed' && (
                    <p role="alert">
                        Сохранение не завершено. Используйте «Повторить» в статусе сохранения.
                    </p>
                )}
                {!selected ? (
                    <>
                        <p className="hint">
                            Соберите состав на карте. Расстановка и параметры сохраняются у
                            участников сцены.
                        </p>
                        <button
                            className="primary-button"
                            disabled={busy || encounters.length >= 50}
                            onClick={create}
                        >
                            <Plus size={15} />
                            {state.selectedIds.length
                                ? `Из выделения · ${state.selectedIds.length}`
                                : 'Новое столкновение'}
                        </button>
                        {!encounters.length && (
                            <div className="encounter-empty">
                                <Swords size={30} />
                                <strong>Сцена готова к замыслу</strong>
                                <p>Выберите NPC на карте или добавьте их из библиотеки.</p>
                            </div>
                        )}
                        <div className="encounter-cards">
                            {encounters.map((e) => {
                                const ids = e.groups.flatMap((g) => g.tokenIds);
                                const reserves = e.groups
                                    .slice(1)
                                    .reduce((n, g) => n + g.tokenIds.length, 0);
                                return (
                                    <button
                                        className="encounter-card"
                                        key={e.id}
                                        onClick={() => choose(e.id)}
                                    >
                                        <span className="encounter-card-heading">
                                            <strong>{e.name}</strong>
                                            <small data-ready={e.status === 'ready'}>
                                                {e.status === 'ready' ? 'Готово' : 'Черновик'}
                                            </small>
                                        </span>
                                        <span>
                                            {ids.length} участников · резерв {reserves}
                                        </span>
                                        <small>
                                            {ids
                                                .slice(0, 4)
                                                .map((id) => tokens.get(id)?.name ?? 'Участник')
                                                .join(', ') || 'Состав ещё не добавлен'}
                                            {ids.length > 4 ? ` +${ids.length - 4}` : ''}
                                        </small>
                                    </button>
                                );
                            })}
                        </div>
                    </>
                ) : (
                    <>
                        <button
                            className="encounter-back"
                            onClick={() => {
                                setListing(true);
                                setLibraryGroup(null);
                                setConfirm(false);
                            }}
                        >
                            <ArrowLeft size={14} /> Все столкновения · {encounters.length}
                        </button>
                        <label className="encounter-field">
                            Название
                            <input
                                key={`${selected.id}:${selected.name}`}
                                aria-label="Название столкновения"
                                maxLength={120}
                                defaultValue={selected.name}
                                disabled={busy}
                                onBlur={(e) => {
                                    const name = e.target.value.trim();
                                    if (name && name !== selected.name)
                                        persist({ ...selected, name });
                                    else e.target.value = selected.name;
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.currentTarget.blur();
                                }}
                            />
                        </label>
                        <div className="encounter-toolbar">
                            <button
                                className="secondary-button"
                                onClick={() => store.selectEncounter(selected.id)}
                            >
                                Выбрать на карте
                            </button>
                            <label>
                                Подготовка
                                <select
                                    aria-label="Статус подготовки"
                                    value={selected.status}
                                    disabled={busy}
                                    onChange={(e) =>
                                        persist({
                                            ...selected,
                                            status: e.target.value as PreparedEncounter['status'],
                                        })
                                    }
                                >
                                    <option value="draft">Черновик</option>
                                    <option value="ready">Готово</option>
                                </select>
                            </label>
                        </div>
                        <p className="hint">
                            {selected.groups.flatMap((g) => g.tokenIds).length} участников ·
                            сохранение автоматически. Выделяйте и перемещайте их обычными
                            инструментами карты.
                        </p>
                        <EncounterGroups
                            selected={selected}
                            tokens={tokens}
                            selectedIds={state.selectedIds}
                            busy={busy}
                            store={store}
                            persist={persist}
                            libraryGroup={libraryGroup}
                            setLibraryGroup={setLibraryGroup}
                        />
                        {libraryGroup && selected.groups.some((g) => g.id === libraryGroup) && (
                            <div className="encounter-library runtime-add preparation-catalog">
                                <header>
                                    <strong>
                                        NPC →{' '}
                                        {selected.groups.find((g) => g.id === libraryGroup)?.name}
                                    </strong>
                                    <button
                                        className="icon-button"
                                        aria-label="Закрыть NPC Library"
                                        onClick={() => setLibraryGroup(null)}
                                    >
                                        <X size={14} />
                                    </button>
                                </header>
                                <p className="hint">
                                    Клик по NPC, затем по карте.{' '}
                                    {libraryGroup !== 'main' && 'Резерв размещается скрытым.'}
                                </p>
                                <EntityPicker
                                    kind="npcs"
                                    campaignId={state.scene.campaignId!}
                                    placedCharacterIds={[]}
                                    onDragStart={
                                        onDragStart
                                            ? (item) => {
                                                  if (item.type === 'libraryActor')
                                                      onDragStart({
                                                          ...item,
                                                          encounter: {
                                                              id: selected.id,
                                                              groupId: libraryGroup,
                                                          },
                                                      });
                                              }
                                            : undefined
                                    }
                                    onDragEnd={onDragEnd}
                                    query={query}
                                    onQuery={setQuery}
                                    onPlace={(item) => {
                                        if (item.type === 'libraryActor')
                                            onPlace({
                                                ...item,
                                                encounter: {
                                                    id: selected.id,
                                                    groupId: libraryGroup,
                                                },
                                            });
                                    }}
                                />
                            </div>
                        )}
                        <div className="encounter-delete">
                            {confirm ? (
                                <>
                                    <p>
                                        Удалить подготовку «{selected.name}»? Участники останутся на
                                        карте.
                                    </p>
                                    <button
                                        className="danger-button"
                                        disabled={busy}
                                        onClick={() => {
                                            persist(null);
                                            setConfirm(false);
                                        }}
                                    >
                                        Удалить Encounter
                                    </button>
                                    <button
                                        className="secondary-button"
                                        onClick={() => setConfirm(false)}
                                    >
                                        Отмена
                                    </button>
                                </>
                            ) : (
                                <button
                                    className="encounter-back"
                                    disabled={busy}
                                    onClick={() => setConfirm(true)}
                                >
                                    <Trash2 size={14} /> Удалить Encounter…
                                </button>
                            )}
                        </div>
                        <p className="hint">
                            Резерв — только состав. Перевод между группами не меняет видимость.
                            Видимость участников меняется обычными действиями карты.
                        </p>
                    </>
                )}
            </div>
        </Panel>
    );
}
