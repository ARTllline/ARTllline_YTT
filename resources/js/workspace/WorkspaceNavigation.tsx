import {
    BookOpen,
    Clapperboard,
    Compass,
    Film,
    FolderOpen,
    Images,
    Layers,
    Library,
    Settings2,
    Swords,
    Users,
    Volume2,
    Zap,
} from 'lucide-react';
import type { LeftPanel, RightPanel, WorkspaceMode } from './workspaceState';
import { IconButton } from './ui/Controls';

export function NavigationRail({
    mode,
    onMode,
    onSettings,
}: {
    mode: WorkspaceMode;
    onMode: (mode: WorkspaceMode) => void;
    onSettings: () => void;
}) {
    return (
        <nav className="navigation-rail" aria-label="Режим работы">
            {(
                [
                    { id: 'table', label: 'Стол', Icon: Compass },
                    { id: 'prepare', label: 'Подготовка', Icon: Layers },
                    { id: 'session', label: 'Сессия', Icon: Clapperboard },
                    { id: 'library', label: 'Библиотека', Icon: Library },
                ] as const
            ).map(({ id, label, Icon }) => (
                <button
                    key={id}
                    aria-label={label}
                    title={label}
                    aria-pressed={mode === id}
                    onClick={() => onMode(id)}
                >
                    <Icon size={21} strokeWidth={1.6} />
                    <span>{label}</span>
                </button>
            ))}
            <button
                className="rail-settings"
                aria-label="Настройки рабочего стола"
                title="Настройки рабочего стола"
                onClick={onSettings}
            >
                <Settings2 size={21} strokeWidth={1.6} />
                <span>Настройки</span>
            </button>
        </nav>
    );
}

export function PreparationTabs({
    panel,
    onPanel,
    onAutomation,
}: {
    panel: LeftPanel;
    onPanel: (panel: LeftPanel) => void;
    onAutomation: () => void;
}) {
    return (
        <nav className="preparation-tabs" aria-label="Инструменты подготовки">
            {(
                [
                    { id: 'scenes', label: 'Сцены', Icon: Layers },
                    { id: 'assets', label: 'Материалы', Icon: Images },
                    { id: 'prefabs', label: 'Заготовки', Icon: FolderOpen },
                    { id: 'encounters', label: 'Столкновения', Icon: Swords },
                    { id: 'cues', label: 'События', Icon: Film },
                ] as const
            ).map(({ id, label, Icon }) => (
                <button key={id} aria-pressed={panel === id} onClick={() => onPanel(id)}>
                    <Icon size={14} />
                    {label}
                </button>
            ))}
            <button onClick={onAutomation}>
                <Zap size={14} />
                Автоматизация
            </button>
        </nav>
    );
}

export function LiveDock({
    panel,
    round,
    onPanel,
}: {
    panel: RightPanel | null;
    round?: number;
    onPanel: (panel: RightPanel) => void;
}) {
    return (
        <nav className="live-dock" aria-label="Управление игрой">
            <button
                className={`combat-launch ${panel === 'combat' ? 'active' : ''}`}
                aria-pressed={panel === 'combat'}
                aria-label="Открыть бой"
                title="Открыть бой"
                onClick={() => onPanel('combat')}
            >
                <Swords size={17} />
                <span>Бой{round ? ` · Раунд ${round}` : ''}</span>
            </button>
            <i />
            {(
                [
                    { id: 'cues', label: 'События · запуск и очередь', Icon: Film },
                    { id: 'handouts', label: 'Раздаточные материалы', Icon: BookOpen },
                    { id: 'audio', label: 'Звук и атмосфера', Icon: Volume2 },
                    { id: 'players', label: 'Игроки', Icon: Users },
                    { id: 'triggers', label: 'Триггеры', Icon: Zap },
                ] as const
            ).map(({ id, label, Icon }) => (
                <IconButton
                    key={id}
                    label={label}
                    aria-pressed={panel === id}
                    onClick={() => onPanel(id)}
                >
                    <Icon size={17} strokeWidth={1.7} />
                </IconButton>
            ))}
        </nav>
    );
}
