import { lazy, Suspense, type ComponentProps } from 'react';
import { Inspector } from './Inspector';
import { NoteInspector } from './notes/NoteInspector';
import { CombatPanel } from './combat/CombatPanel';
import { PlayersPanel } from './PlayersPanel';
import { HandoutShelf } from './handouts/HandoutShelf';
import { Panel } from './ui/Controls';
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
    inspector,
    queue,
    members,
    connection,
    echo,
    userId,
    syncError,
    settings,
}: {
    panel: RightPanel;
    inspector: ComponentProps<typeof Inspector>;
    queue: SaveQueue;
    members: Member[];
    connection: ConnectionState;
    echo: LiveEcho | null;
    userId: string;
    syncError: string;
    settings: React.ReactNode;
}) {
    const { store, campaign, onClose } = inspector;
    const state = store.getSnapshot();
    const active = campaign.activeSceneId === state.scene.id;
    return (
        <aside
            key={panel}
            className={`workspace-dock dock-${panel}`}
            aria-label="Контекстная панель"
        >
            <Suspense
                fallback={
                    <Panel title="Загрузка…" onClose={onClose}>
                        <p className="hint">Открываем инструменты</p>
                    </Panel>
                }
            >
                {(panel === 'scene' ||
                    (panel === 'context' && !state.selectedNoteId && !state.selectedRegionId)) && (
                    <Inspector {...inspector} />
                )}
                {panel === 'context' && state.selectedNoteId && <NoteInspector store={store} />}
                {(panel === 'region' || (panel === 'context' && state.selectedRegionId)) && (
                    <Panel title="Области" subtitle="АВТОМАТИЗАЦИЯ" onClose={onClose}>
                        <RegionControls store={store} />
                    </Panel>
                )}
                {panel === 'combat' && (
                    <CombatPanel store={store} queue={queue} onClose={onClose} />
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
        </aside>
    );
}
