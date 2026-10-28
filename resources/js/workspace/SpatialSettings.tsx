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
    return (
        <>
            <div className="spatial-settings" aria-label="Active tool settings">
                {tool === 'fog' ? (
                    <>
                        <div className="spatial-row">
                            <strong>Fog of war</strong>
                            <span>GM view</span>
                        </div>
                        <div className="spatial-row">
                            <button
                                className={settings.operation === 'reveal' ? 'active' : ''}
                                onClick={() => update({ operation: 'reveal' })}
                            >
                                Reveal
                            </button>
                            <button
                                className={settings.operation === 'cover' ? 'active' : ''}
                                onClick={() => update({ operation: 'cover' })}
                            >
                                Cover
                            </button>
                            <select
                                aria-label="Fog shape"
                                value={settings.shape}
                                onChange={(e) =>
                                    update({ shape: e.target.value as 'brush' | 'rectangle' })
                                }
                            >
                                <option value="brush">Brush</option>
                                <option value="rectangle">Rectangle</option>
                            </select>
                        </div>
                        {settings.shape === 'brush' && (
                            <label className="spatial-row">
                                Brush size{' '}
                                <input
                                    aria-label="Fog brush size"
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
                            <button onClick={() => setReset('covered')}>Cover all…</button>
                            <button onClick={() => setReset('clear')}>Reveal all…</button>
                        </div>
                        <p>Drag to {settings.operation}. Space + drag to pan.</p>
                    </>
                ) : (
                    <>
                        {['circle', 'cone', 'rectangle'].includes(tool) && (
                            <label className="spatial-row">
                                Area shape{' '}
                                <select
                                    aria-label="Area shape"
                                    value={tool}
                                    onChange={(e) => onTool(e.target.value as Tool)}
                                >
                                    <option value="circle">Circle</option>
                                    <option value="cone">Cone · 60°</option>
                                    <option value="rectangle">Rectangle</option>
                                </select>
                            </label>
                        )}
                        {tool !== 'ping' && (
                            <label className="spatial-row">
                                Snap to cell centers{' '}
                                <input
                                    type="checkbox"
                                    checked={settings.snap}
                                    onChange={(e) => update({ snap: e.target.checked })}
                                />
                            </label>
                        )}
                        <p>
                            {tool === 'ping'
                                ? 'Click to ping · visible for 2 seconds'
                                : 'Drag to measure · stays for 5 seconds'}
                            <br />
                            {store.spatial.shareActive
                                ? 'Shared with the table'
                                : 'Local preview · prepared scene'}
                            . Esc to clear.
                        </p>
                    </>
                )}
            </div>
            {reset && (
                <ConfirmDialog
                    title={
                        reset === 'covered' ? 'Cover the entire scene?' : 'Reveal the entire scene?'
                    }
                    description="This replaces the current fog and clears its brush history."
                    buttonLabel={reset === 'covered' ? 'Cover all' : 'Reveal all'}
                    onClose={() => setReset(null)}
                    submit={async () => store.resetFog(reset)}
                />
            )}
        </>
    );
}
