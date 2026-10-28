import { t } from '../i18n';
import { useState } from 'react';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { Tool } from '../tabletop/types/scene';
import type { FogBase } from '../tabletop/types/spatial';
import { ConfirmDialog } from './ConfirmDialog';

export function SpatialSettings({
    store,
    tool,
    onTool,
}: {
    store: SceneStore;
    tool: Tool;
    onTool: (tool: Tool) => void;
}) {
    const [settings, setSettings] = useState(store.spatial.settings);
    const [reset, setReset] = useState<FogBase | null>(null);
    const update = (patch: Partial<typeof settings>) => {
        store.spatial.setSettings(patch);
        setSettings(store.spatial.settings);
    };
    if (tool === 'select' || tool === 'pan') return null;
    if (tool === 'note')
        return (
            <div className="spatial-settings" aria-label={t('Active tool settings')}>
                <strong> {t('Private GM note')} </strong>
                <p>
                    {' '}
                    {t(
                        'Click the map to place a marker. Escape cancels. Only Game Masters receive these notes.',
                    )}{' '}
                </p>
            </div>
        );
    return (
        <>
            <div className="spatial-settings" aria-label={t('Active tool settings')}>
                {tool === 'fog' ? (
                    <>
                        <div className="spatial-row">
                            <strong> {t('Fog of war')} </strong>
                            <span> {t('GM view')} </span>
                        </div>
                        <div className="spatial-row">
                            <button
                                className={settings.operation === 'reveal' ? 'active' : ''}
                                onClick={() => update({ operation: 'reveal' })}
                            >
                                {' '}
                                {t('Reveal')}{' '}
                            </button>
                            <button
                                className={settings.operation === 'cover' ? 'active' : ''}
                                onClick={() => update({ operation: 'cover' })}
                            >
                                {' '}
                                {t('Cover')}{' '}
                            </button>
                            <select
                                aria-label={t('Fog shape')}
                                value={settings.shape}
                                onChange={(e) =>
                                    update({ shape: e.target.value as 'brush' | 'rectangle' })
                                }
                            >
                                <option value="brush"> {t('Brush')} </option>
                                <option value="rectangle"> {t('Rectangle')} </option>
                            </select>
                        </div>
                        {settings.shape === 'brush' && (
                            <label className="spatial-row">
                                {' '}
                                {t('Brush size')}{' '}
                                <input
                                    aria-label={t('Fog brush size')}
                                    type="range"
                                    min="15"
                                    max="300"
                                    step="15"
                                    value={settings.radius}
                                    onChange={(e) => update({ radius: +e.target.value })}
                                />
                                <span>{settings.radius * 2}px</span>
                            </label>
                        )}
                        <div className="spatial-row">
                            <button onClick={() => setReset('covered')}> {t('Cover all…')} </button>
                            <button onClick={() => setReset('clear')}> {t('Reveal all…')} </button>
                        </div>
                        <p>
                            {' '}
                            {t(
                                settings.operation === 'reveal' ? 'fogDragReveal' : 'fogDragCover',
                            )}{' '}
                        </p>
                    </>
                ) : (
                    <>
                        {['circle', 'cone', 'rectangle'].includes(tool) && (
                            <label className="spatial-row">
                                {' '}
                                {t('Area shape')}{' '}
                                <select
                                    aria-label={t('Area shape')}
                                    value={tool}
                                    onChange={(e) => onTool(e.target.value as Tool)}
                                >
                                    <option value="circle"> {t('Circle')} </option>
                                    <option value="cone"> {t('Cone · 60°')} </option>
                                    <option value="rectangle"> {t('Rectangle')} </option>
                                </select>
                            </label>
                        )}
                        {tool !== 'ping' && (
                            <label className="spatial-row">
                                {' '}
                                {t('Snap to cell centers')}{' '}
                                <input
                                    type="checkbox"
                                    checked={settings.snap}
                                    onChange={(e) => update({ snap: e.target.checked })}
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
                            {t('. Esc to clear.')}{' '}
                        </p>
                    </>
                )}
            </div>
            {reset && (
                <ConfirmDialog
                    title={
                        reset === 'covered'
                            ? t('Cover the entire scene?')
                            : t('Reveal the entire scene?')
                    }
                    description={t('This replaces the current fog and clears its brush history.')}
                    buttonLabel={reset === 'covered' ? t('Cover all') : t('Reveal all')}
                    onClose={() => setReset(null)}
                    submit={async () => store.resetFog(reset)}
                />
            )}
        </>
    );
}
