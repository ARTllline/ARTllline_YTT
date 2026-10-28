import { useState, useSyncExternalStore } from 'react';
import { MousePointer2, Hand, Grid2X2, CloudFog, Ruler, MapPin, X } from 'lucide-react';
import type { Tool } from '../tabletop/types/scene';
import type { SceneStore } from '../tabletop/state/SceneStore';
import { NumberField } from './NumberField';
export function Toolbar({
    store,
    tool,
    onTool,
}: {
    store: SceneStore;
    tool: Tool;
    onTool: (tool: Tool) => void;
}) {
    const [gridOpen, setGridOpen] = useState(false);
    const {
        scene: { grid },
    } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    return (
        <div className="toolbar-wrap">
            <div className="tabletop-toolbar" role="toolbar" aria-label="Tabletop tools">
                <button
                    className={tool === 'select' ? 'active' : ''}
                    aria-pressed={tool === 'select'}
                    aria-label="Select tool"
                    title="Select and drag tokens"
                    onClick={() => onTool('select')}
                >
                    <MousePointer2 size={18} />
                </button>
                <button
                    className={tool === 'pan' ? 'active' : ''}
                    aria-pressed={tool === 'pan'}
                    aria-label="Pan tool"
                    title="Pan · Space + drag or middle mouse"
                    onClick={() => onTool('pan')}
                >
                    <Hand size={18} />
                </button>
                <i />
                <button
                    className={gridOpen ? 'active' : ''}
                    aria-expanded={gridOpen}
                    aria-label="Grid settings"
                    title="Grid settings"
                    onClick={() => setGridOpen(!gridOpen)}
                >
                    <Grid2X2 size={18} />
                </button>
                <i />
                <button disabled title="Fog · coming later" aria-label="Fog (coming later)">
                    <CloudFog size={18} />
                </button>
                <button disabled title="Ruler · coming later" aria-label="Ruler (coming later)">
                    <Ruler size={18} />
                </button>
                <button disabled title="Ping · coming later" aria-label="Ping (coming later)">
                    <MapPin size={18} />
                </button>
            </div>
            {gridOpen && (
                <div
                    className="grid-popover"
                    role="region"
                    aria-label="Grid settings panel"
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            event.stopPropagation();
                            setGridOpen(false);
                        }
                    }}
                >
                    <div className="panel-heading">
                        <strong>Grid & snapping</strong>
                        <button
                            aria-label="Close grid settings"
                            className="icon-button"
                            onClick={() => setGridOpen(false)}
                        >
                            <X size={14} />
                        </button>
                    </div>
                    <label className="toggle-row">
                        Show grid
                        <input
                            type="checkbox"
                            checked={grid.visible}
                            onChange={(e) => store.updateGrid({ visible: e.target.checked })}
                        />
                    </label>
                    <label className="toggle-row">
                        Snap on drop
                        <input
                            type="checkbox"
                            checked={grid.snap}
                            onChange={(e) => store.updateGrid({ snap: e.target.checked })}
                        />
                    </label>
                    <NumberField
                        label="Cell size (px)"
                        value={grid.size}
                        min={20}
                        max={160}
                        onChange={(size) => store.updateGrid({ size })}
                    />
                    <div className="field-row">
                        <NumberField
                            label="Offset X"
                            value={grid.offset.x}
                            onChange={(x) => store.updateGrid({ offset: { ...grid.offset, x } })}
                        />
                        <NumberField
                            label="Offset Y"
                            value={grid.offset.y}
                            onChange={(y) => store.updateGrid({ offset: { ...grid.offset, y } })}
                        />
                    </div>
                    <p className="hint">
                        Token centers align to cell centers. The outline previews the landing cell.
                    </p>
                </div>
            )}
        </div>
    );
}
