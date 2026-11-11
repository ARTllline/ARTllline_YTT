import { EncounterPanel, EncounterSelection } from './encounters/EncounterPanel';
import { SessionEncounters } from './encounters/SessionEncounters';
import { GroupInspector } from './objects/GroupInspector';
import { lazy, Suspense, type ComponentProps } from 'react';
import { Inspector } from './Inspector';
import { NoteInspector } from './notes/NoteInspector';
import { CombatPanel } from './combat/CombatPanel';
import { PlayersPanel } from './PlayersPanel';
import { HandoutShelf } from './handouts/HandoutShelf';
import { Panel } from './ui/Controls';
import { Pin, PinOff, ChevronLeft, X } from 'lucide-react';
import { SelectionContext } from './session/SelectionContext';
import type { Token } from '../tabletop/types/scene';
import type { RightPanel } from './workspaceState';
import type { SaveQueue } from '../tabletop/state/SaveQueue';
import type { Member, ConnectionState, LiveEcho } from '../realtime/useCampaignLive';
const MediaPanel = lazy(() =>
    import('../media/MediaPanel').then((m) => ({ default: m.MediaPanel })),
);
const CueLibrary = lazy(() => import('./cues/CueLibrary').then((m) => ({ default: m.CueLibrary })));
const TriggerPanel = lazy(() =>
    import('../automation/TriggerPanel').then((m) => ({ default: m.TriggerPanel })),
);
const RegionControls = lazy(() =>
    import('../automation/RegionControls').then((m) => ({ default: m.RegionControls })),
);

export function WorkspaceDock({
    panel,
    renderer,
    inspector,
    queue,
    members,
    connection,
    echo,
    userId,
    syncError,
    settings,
    session = false,
    compact = false,
    expanded = false,
    pinned = false,
    onExpand,
    onPin,
    selectionToken,
    catalog,
    onEncounterPlace,
    onEncounterDrag,
    onEncounterDragEnd,
    onEncounters,
    onCombat,
}: {
    panel: RightPanel;
    catalog?: React.ReactNode;
    onEncounterPlace: (item: import('./creation/model').Placement) => void;
    onEncounterDrag: (item: import('./creation/model').Placement) => void;
    onEncounterDragEnd: () => void;
    onEncounters: () => void;
    onCombat: () => void;
    renderer?: React.RefObject<
        import('../tabletop/renderer/TabletopRenderer').TabletopRenderer | null
    >;
    inspector: ComponentProps<typeof Inspector>;
    queue: SaveQueue;
    members: Member[];
    connection: ConnectionState;
    echo: LiveEcho | null;
    userId: string;
    syncError: string;
    settings: React.ReactNode;
    session?: boolean;
    compact?: boolean;
    expanded?: boolean;
    pinned?: boolean;
    onExpand?: (value: boolean) => void;
    onPin?: () => void;
    selectionToken?: Token;
}) {
    const { store, campaign, onClose } = inspector;
    const state = store.getSnapshot();
    const group =
        !!state.entityAuthoring &&
        state.selectedIds.length + (state.selectedPropIds?.length ?? 0) > 1;
    const active = campaign.activeSceneId === state.scene.id;
    const runtimeToken = session && panel === 'context' && selectionToken;
    const contextProps = runtimeToken
        ? {
              token: runtimeToken,
              store,
              disabled: inspector.combatBusy,
              renderer,
              onExpand: () => onExpand?.(true),
              onClose,
          }
        : null;
    const selectedObject =
        state.scene.props?.find((p) => p.id === state.selectedPropIds?.[0]) ??
        state.scene.notes?.find((n) => n.id === state.selectedNoteId) ??
        state.scene.regions?.find((r) => r.id === state.selectedRegionId);
    const emptyContext = session && panel === 'context' && !runtimeToken && !selectedObject;
    return (
        <aside
            key={panel}
            className={`workspace-dock dock-${panel} ${session ? `session-surface ${compact ? 'is-compact' : 'is-expanded'} ${pinned && panel !== 'combat' ? 'is-pinned' : ''}` : ''}`}
            aria-label="Контекстная панель"
        >
            {session && !compact && panel !== 'combat' && panel !== 'encounters' && (
                <div className="session-surface-controls">
                    {panel === 'context' && expanded && (
                        <button onClick={() => onExpand?.(false)} title="Свернуть к контексту">
                            <ChevronLeft size={14} /> Контекст
                        </button>
                    )}
                    <button
                        onClick={onPin}
                        aria-pressed={pinned}
                        title={pinned ? 'Открепить панель' : 'Закрепить панель'}
                        aria-label={pinned ? 'Открепить панель' : 'Закрепить панель'}
                    >
                        {pinned ? <PinOff size={14} /> : <Pin size={14} />}{' '}
                        {pinned ? 'Открепить' : 'Pin'}
                    </button>
                    <button onClick={onClose} title="Закрыть панель" aria-label="Закрыть панель">
                        <X size={14} />
                    </button>
                </div>
            )}
            {contextProps && (
                <SelectionContext
                    key={contextProps.token.id}
                    {...contextProps}
                    expanded={!compact}
                />
            )}
            {emptyContext && (
                <p className="empty-pinned-context">
                    Панель следует за выбором. Выберите объект на карте.
                </p>
            )}
            {session && compact && !runtimeToken && !emptyContext && (
                <section className="object-context selection-context">
                    <header className="selection-context-heading">
                        <h2>
                            {selectedObject &&
                                ('name' in selectedObject
                                    ? selectedObject.name
                                    : selectedObject.title)}
                        </h2>
                        <button
                            className="icon-button"
                            onClick={onClose}
                            aria-label="Скрыть контекст"
                        >
                            <X size={15} />
                        </button>
                    </header>
                    <button className="context-expand" onClick={() => onExpand?.(true)}>
                        Подробнее · Inspector <span>↗</span>
                    </button>
                </section>
            )}
            {!runtimeToken && !compact && !emptyContext && (
                <Suspense
                    fallback={
                        <Panel title="Загрузка…" onClose={onClose}>
                            <p className="hint">Открываем инструменты</p>
                        </Panel>
                    }
                >
                    {panel === 'encounters' && session && (
                        <SessionEncounters
                            store={store}
                            queue={queue}
                            onClose={onClose}
                            onCombat={onCombat}
                        />
                    )}
                    {panel === 'encounters' && !session && (
                        <EncounterPanel
                            store={store}
                            queue={queue}
                            onClose={onClose}
                            onPlace={onEncounterPlace}
                            onDragStart={onEncounterDrag}
                            onDragEnd={onEncounterDragEnd}
                        />
                    )}
                    {panel === 'context' && state.entityAuthoring && !group && (
                        <EncounterSelection
                            store={store}
                            onOpen={onEncounters}
                            disabled={inspector.combatBusy}
                        />
                    )}
                    {panel === 'entities' && catalog}
                    {panel === 'context' && group && (
                        <GroupInspector
                            store={store}
                            queue={queue}
                            onClose={onClose}
                            onEncounters={onEncounters}
                        />
                    )}
                    {!group &&
                        (panel === 'scene' ||
                            (panel === 'context' &&
                                !state.selectedNoteId &&
                                !state.selectedRegionId)) && <Inspector {...inspector} />}
                    {panel === 'context' && state.selectedNoteId && <NoteInspector store={store} />}
                    {(panel === 'region' || (panel === 'context' && state.selectedRegionId)) && (
                        <Panel title="Области" subtitle="АВТОМАТИЗАЦИЯ" onClose={onClose}>
                            <RegionControls store={store} />
                        </Panel>
                    )}
                    {panel === 'combat' && (
                        <CombatPanel
                            encounterOnly={session}
                            renderer={renderer}
                            store={store}
                            queue={queue}
                            onClose={onClose}
                        />
                    )}
                    {panel === 'audio' && (
                        <MediaPanel
                            campaignId={campaign.id}
                            gm
                            docked
                            syncError={syncError}
                            onClose={onClose}
                        />
                    )}
                    {panel === 'cues' && (
                        <Panel title="События" subtitle="РЕЖИССЁРСКИЙ ПУЛЬТ" onClose={onClose}>
                            {state.scene.id ? (
                                <CueLibrary scene={state.scene} active={active} live />
                            ) : (
                                <p>Создайте сцену для событий.</p>
                            )}
                        </Panel>
                    )}
                    {panel === 'triggers' &&
                        (state.scene.id ? (
                            <TriggerPanel
                                store={store}
                                queue={queue}
                                active={active}
                                docked
                                onClose={onClose}
                                onUpdated={() => undefined}
                            />
                        ) : (
                            <Panel title="Автоматизация" onClose={onClose}>
                                <p>Создайте сцену для триггеров.</p>
                            </Panel>
                        ))}
                    {panel === 'players' && (
                        <PlayersPanel
                            campaign={campaign}
                            members={members}
                            connection={connection}
                            scene={state.scene}
                            docked
                            onClose={onClose}
                        />
                    )}
                    {panel === 'handouts' && (
                        <HandoutShelf
                            campaignId={campaign.id}
                            userId={userId}
                            echo={echo}
                            gm
                            docked
                            onClose={onClose}
                        />
                    )}
                    {panel === 'settings' && (
                        <Panel title="Рабочий стол" subtitle="YTT / НАСТРОЙКИ" onClose={onClose}>
                            {settings}
                        </Panel>
                    )}
                </Suspense>
            )}
        </aside>
    );
}
