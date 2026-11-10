import { t } from '../i18n';
import { useSyncExternalStore } from 'react';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { Tool } from '../tabletop/types/scene';

export function SpatialSettings({
    store,
    tool,
    onTool,
}: {
    store: SceneStore;
    tool: Tool;
    onTool: (tool: Tool) => void;
}) {
    const settings = useSyncExternalStore(store.spatial.subscribe, store.spatial.getSettings);
    if (['select', 'pan', 'region', 'fog'].includes(tool)) return null;
    if (tool === 'note')
        return (
            <div className="spatial-settings" aria-label={t('Active tool settings')}>
                <strong>{t('Private GM note')}</strong>
                <p>
                    {t(
                        'Click the map to place a marker. Escape cancels. Only Game Masters receive these notes.',
                    )}
                </p>
            </div>
        );
    return (
        <div className="spatial-settings" aria-label={t('Active tool settings')}>
            {['circle', 'cone', 'rectangle'].includes(tool) && (
                <label className="spatial-row">
                    {t('Area shape')}
                    <select
                        aria-label={t('Area shape')}
                        value={tool}
                        onChange={(e) => onTool(e.target.value as Tool)}
                    >
                        <option value="circle">{t('Circle')}</option>
                        <option value="cone">{t('Cone · 60°')}</option>
                        <option value="rectangle">{t('Rectangle')}</option>
                    </select>
                </label>
            )}
            {tool !== 'ping' && (
                <label className="spatial-row">
                    {t('Snap to cell centers')}
                    <input
                        type="checkbox"
                        checked={settings.snap}
                        onChange={(e) => store.spatial.setSettings({ snap: e.target.checked })}
                    />
                </label>
            )}
            <p>
                {tool === 'ping'
                    ? t('Click to ping · visible for 2 seconds')
                    : t('Drag to measure · stays for 5 seconds')}
                <br />
                {store.spatial.shareActive
                    ? t('Shared with the table')
                    : t('Local preview · prepared scene')}
                {t('. Esc to clear.')}
            </p>
        </div>
    );
}
