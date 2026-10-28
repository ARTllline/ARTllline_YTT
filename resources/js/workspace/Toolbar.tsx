import { useState, useSyncExternalStore } from 'react';
import { MousePointer2, Hand, Grid2X2, CloudFog, Ruler, MapPin, X, Circle } from 'lucide-react';
import type { Tool } from '../tabletop/types/scene';
import type { SceneStore } from '../tabletop/state/SceneStore';
import { SpatialSettings } from './SpatialSettings';
import { NumberField } from './NumberField';
export function Toolbar({ store, onTool }: { store: SceneStore; onTool: (tool: Tool) => void }) {
    const tool = useSyncExternalStore(store.spatial.subscribe, store.spatial.getTool);
    const [gridOpen, setGridOpen] = useState(false);
    const {
        scene: { grid },
    } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const choose = (next: Tool) => {
        setGridOpen(false);
        onTool(next);
    };
    return (
        <div className="toolbar-wrap">
            <div className="tabletop-toolbar" role="toolbar" aria-label="Tabletop tools">
                <button
                    className={tool === 'select' ? 'active' : ''}
                    aria-pressed={tool === 'select'}
                    aria-label="Select tool"
                    title="Select and drag tokens"
                    onClick={() => choose('select')}
                >
                    <MousePointer2 size={18} />
                </button>
                <button
                    className={tool === 'pan' ? 'active' : ''}
                    aria-pressed={tool === 'pan'}
                    aria-label="Pan tool"
                    title="Pan · Space + drag or middle mouse"
                    onClick={() => choose('pan')}
                >
                    <Hand size={18} />
                </button>
                <i />
                {store.role === 'gm' && (
                    <button
                        className={gridOpen ? 'active' : ''}
                        aria-expanded={gridOpen}
                        aria-label="Grid settings"
                        title="Grid settings"
                        onClick={() => setGridOpen(!gridOpen)}
                    >
                        <Grid2X2 size={18} />
                    </button>
                )}
                <i />
                {store.role === 'gm' && (
                    <button
                        className={tool === 'fog' ? 'active' : ''}
                        aria-label="Fog tool"
                        title="Fog · F"
                        aria-pressed={tool === 'fog'}
                        onClick={() => choose('fog')}
                    >
                        <CloudFog size={18} />
                    </button>
                )}
                <button
                    className={tool === 'ruler' ? 'active' : ''}
                    aria-label="Ruler tool"
                    title="Ruler · R"
                    aria-pressed={tool === 'ruler'}
                    onClick={() => choose('ruler')}
                >
                    <Ruler size={18} />
                </button>
                <button
                    className={['circle', 'cone', 'rectangle'].includes(tool) ? 'active' : ''}
                    aria-label="Area template tool"
                    title="Area templates"
                    aria-pressed={['circle', 'cone', 'rectangle'].includes(tool)}
                    onClick={() => choose('circle')}
                >
                    <Circle size={18} />
                </button>
                <button
                    className={tool === 'ping' ? 'active' : ''}
                    aria-label="Ping tool"
                    title="Ping · P"
                    aria-pressed={tool === 'ping'}
                    onClick={() => choose('ping')}
                >
                    <MapPin size={18} />
                </button>
            </div>
            <SpatialSettings store={store} tool={tool} onTool={choose} />
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
                    <NumberField
                        label="Distance per cell"
                        value={grid.distancePerCell ?? 5}
                        min={0.1}
                        max={1000}
                        onChange={(distancePerCell) => store.updateGrid({ distancePerCell })}
                    />
                    <label className="toggle-row">
                        Distance unit{' '}
                        <select
                            aria-label="Distance unit"
                            value={grid.distanceUnit ?? 'ft'}
                            onChange={(e) => store.updateGrid({ distanceUnit: e.target.value })}
                        >
                            <option value="ft">ft</option>
                            <option value="m">m</option>
                            <option value="squares">squares</option>
                        </select>
                    </label>
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
