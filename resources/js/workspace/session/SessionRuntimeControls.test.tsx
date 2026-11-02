import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionRuntimeControls } from './SessionRuntimeControls';
import { LiveDock } from '../WorkspaceNavigation';
import type { Campaign } from '../../api/workspace';

const campaign: Campaign = {
    id: '5',
    name: 'Campaign',
    role: 'gm',
    liveRevision: 1,
    activeSceneId: '5',
    scenes: [
        { id: '5', name: 'Townhouse' },
        { id: '6', name: 'Tavern' },
    ],
};
const props = { campaign, sceneId: '5', onOpen: vi.fn(), onPanel: vi.fn(), onActivate: vi.fn() };
it('keeps runtime entry small and shows the current authoritative scene only after opening', () => {
    const closed = renderToStaticMarkup(<SessionRuntimeControls {...props} open={false} />);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain('Переключить сцену');
    const open = renderToStaticMarkup(<SessionRuntimeControls {...props} open />);
    expect(open).toContain('Townhouse');
    expect(open).toContain('В эфире');
    for (const action of ['Переключить сцену', 'Показать Handout', 'Игроки и подключение'])
        expect(open).toContain(action);
    for (const duplicate of ['Добавить', 'Бой', 'Триггеры', 'Изменить план', 'Создать сцену'])
        expect(open).not.toContain(duplicate);
});
it('distinguishes the viewed scene from the scene currently shown to players', () => {
    const html = renderToStaticMarkup(<SessionRuntimeControls {...props} sceneId="6" open />);
    expect(html).toContain('Tavern');
    expect(html).toContain('Игроки: Townhouse');
    expect(html).not.toContain('В эфире');
});
it('leaves compact Combat independent and retains other workspace tools outside Session', () => {
    const compact = renderToStaticMarkup(<LiveDock panel={null} onPanel={vi.fn()} compact />);
    expect(compact).toContain('Открыть бой');
    expect(compact).not.toContain('Раздаточные материалы');
    expect(compact).not.toContain('Триггеры');
    const preparation = renderToStaticMarkup(<LiveDock panel={null} onPanel={vi.fn()} />);
    expect(preparation).toContain('Триггеры');
});
