import { useEffect, useRef, useState } from 'react';
import {
    Box,
    ChevronRight,
    Play,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
    Maximize,
    Minus,
    Plus,
    Keyboard,
    X,
} from 'lucide-react';
import { SceneStore } from '../tabletop/state/SceneStore';
import { createDemoScene } from '../tabletop/state/demoScene';
import type { TabletopRenderer } from '../tabletop/renderer/TabletopRenderer';
import type { Tool } from '../tabletop/types/scene';
import { Sidebar } from './Sidebar';
import { Inspector } from './Inspector';
import { Tabletop } from './Tabletop';
import { Toolbar } from './Toolbar';
export function Workspace() {
    const [store] = useState(() => new SceneStore(createDemoScene()));
    const renderer = useRef<TabletopRenderer | null>(null);
    const [zoom, setZoom] = useState(100);
    const [tool, setTool] = useState<Tool>('select');
    const [left, setLeft] = useState(() => window.innerWidth >= 900);
    const [right, setRight] = useState(() => window.innerWidth >= 1180);
    const help = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const compact = window.matchMedia('(max-width: 1179px)');
        const narrow = window.matchMedia('(max-width: 899px)');
        const collapseInspector = () => {
            if (compact.matches) setRight(false);
        };
        const collapseLibrary = () => {
            if (narrow.matches) setLeft(false);
        };
        compact.addEventListener('change', collapseInspector);
        narrow.addEventListener('change', collapseLibrary);
        return () => {
            compact.removeEventListener('change', collapseInspector);
            narrow.removeEventListener('change', collapseLibrary);
        };
    }, []);
    const toggleLibrary = () => {
        if (!left && window.innerWidth < 900) setRight(false);
        setLeft(!left);
    };
    const toggleInspector = () => {
        if (!right && window.innerWidth < 900) setLeft(false);
        setRight(!right);
    };
    const changeTool = (next: Tool) => {
        setTool(next);
        renderer.current?.setTool(next);
    };
    return (
        <div className="workspace">
            <header className="topbar">
                <a className="brand" href="/" aria-label="YTT home">
                    <Box size={25} />
                    <strong>
                        YTT<span> / </span>
                    </strong>
                </a>
                <div className="breadcrumb">
                    <span>The Hollow Marches</span>
                    <ChevronRight size={13} />
                    <strong>The Sunken Observatory</strong>
                </div>
                <div className="topbar-actions">
                    <span className="local-badge">
                        <i /> Local demo
                    </span>
                    <span
                        title="Multiplayer is not available in this preview"
                        className="gm-avatar"
                    >
                        GM
                    </span>
                    <button
                        className="present-button"
                        disabled
                        title="Player presentation comes in a later stage"
                    >
                        <Play size={13} fill="currentColor" /> Present <span>SOON</span>
                    </button>
                </div>
            </header>
            <div
                className={`workspace-body ${left ? '' : 'left-closed'} ${right ? '' : 'right-closed'}`}
            >
                {left && <Sidebar store={store} onClose={() => setLeft(false)} />}
                <main className="tabletop" aria-label="Tabletop workspace">
                    <Tabletop store={store} rendererRef={renderer} onZoom={setZoom} />
                    <div className="canvas-topline">
                        <button
                            className="icon-button surface"
                            onClick={toggleLibrary}
                            title={left ? 'Hide library' : 'Show library'}
                            aria-label={left ? 'Hide library' : 'Show library'}
                        >
                            {left ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
                        </button>
                        <div className="canvas-heading">
                            <span className="eyebrow">
                                SCENE 01 <span>/</span> EXPLORATION
                            </span>
                            <h1>The Sunken Observatory</h1>
                        </div>
                        <button
                            className="icon-button surface inspector-toggle"
                            onClick={toggleInspector}
                            title={right ? 'Hide inspector' : 'Show inspector'}
                            aria-label={right ? 'Hide inspector' : 'Show inspector'}
                        >
                            {right ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
                        </button>
                    </div>
                    <Toolbar store={store} tool={tool} onTool={changeTool} />
                    <div className="canvas-bottomline">
                        <span className="canvas-tip">
                            <kbd>Space</kbd> + drag to pan <span>·</span> Scroll to zoom
                        </span>
                        <div className="zoom-control">
                            <button
                                aria-label="Zoom out"
                                title="Zoom out"
                                onClick={() => renderer.current?.zoom(1 / 1.2)}
                            >
                                <Minus size={14} />
                            </button>
                            <output aria-label="Zoom level">{zoom}%</output>
                            <button
                                aria-label="Zoom in"
                                title="Zoom in"
                                onClick={() => renderer.current?.zoom(1.2)}
                            >
                                <Plus size={14} />
                            </button>
                            <i />
                            <button
                                aria-label="Fit scene"
                                title="Fit scene to viewport"
                                onClick={() => renderer.current?.fit()}
                            >
                                <Maximize size={14} />
                            </button>
                        </div>
                    </div>
                </main>
                {right && <Inspector store={store} onClose={() => setRight(false)} />}
            </div>
            <footer className="statusbar">
                <span>
                    <i className="status-dot" /> RENDERER PREVIEW <b>01</b>
                </span>
                <span className="session-note">Local changes only · resets on reload</span>
                <button onClick={() => help.current?.showModal()}>
                    <Keyboard size={14} /> Shortcuts
                </button>
            </footer>
            <dialog
                ref={help}
                className="shortcuts-dialog"
                onClick={(event) => {
                    if (event.target === event.currentTarget) help.current?.close();
                }}
            >
                <div className="panel-heading">
                    <strong>At your fingertips</strong>
                    <button
                        className="icon-button"
                        aria-label="Close shortcuts"
                        onClick={() => help.current?.close()}
                    >
                        <X size={16} />
                    </button>
                </div>
                <p>Click the tabletop to focus its controls.</p>
                <dl>
                    <dt>Select / move token</dt>
                    <dd>Click / drag</dd>
                    <dt>Pan</dt>
                    <dd>
                        <kbd>Space</kbd> + drag
                    </dd>
                    <dt>Pan anywhere on canvas</dt>
                    <dd>Middle mouse drag</dd>
                    <dt>Zoom to cursor</dt>
                    <dd>Mouse wheel</dd>
                    <dt>Cancel drag / clear selection</dt>
                    <dd>
                        <kbd>Esc</kbd>
                    </dd>
                    <dt>Apply Inspector field</dt>
                    <dd>
                        <kbd>Enter</kbd> or blur
                    </dd>
                </dl>
                <p className="hint">
                    The Pan toolbar tool also works with a touch or pen drag. Pinch zoom is not part
                    of this preview.
                </p>
            </dialog>
        </div>
    );
}
