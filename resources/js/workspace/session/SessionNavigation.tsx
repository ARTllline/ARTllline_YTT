import { Compass, Layers, Library, Menu, Settings2 } from 'lucide-react';
import type { WorkspaceMode } from '../workspaceState';

export function SessionNavigation({
    onMode,
    onSettings,
}: {
    onMode: (mode: WorkspaceMode) => void;
    onSettings: () => void;
}) {
    return (
        <details className="session-navigation">
            <summary title="Рабочее пространство" aria-label="Рабочее пространство">
                <Menu size={18} />
            </summary>
            <nav
                aria-label="Режим работы"
                onClick={(event) => {
                    if ((event.target as HTMLElement).closest('button'))
                        event.currentTarget.closest('details')?.removeAttribute('open');
                }}
            >
                <span className="eyebrow">Сессия · за столом</span>
                <button onClick={() => onMode('table')}>
                    <Compass size={16} /> Стол
                </button>
                <button onClick={() => onMode('prepare')}>
                    <Layers size={16} /> Подготовка
                </button>
                <button onClick={() => onMode('library')}>
                    <Library size={16} /> Библиотека
                </button>
                <button onClick={onSettings}>
                    <Settings2 size={16} /> Настройки рабочего стола
                </button>
            </nav>
        </details>
    );
}
