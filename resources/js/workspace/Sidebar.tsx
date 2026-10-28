import { useState, useSyncExternalStore } from 'react';
import {
    Layers,
    Images,
    Clapperboard,
    ChevronDown,
    Plus,
    Shield,
    Circle,
    ArrowUpRight,
    X,
} from 'lucide-react';
import type { SceneStore } from '../tabletop/state/SceneStore';
export function Sidebar({ store, onClose }: { store: SceneStore; onClose: () => void }) {
    const [tab, setTab] = useState<'Scenes' | 'Assets' | 'Cues'>('Scenes');
    const { scene, selectedIds } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    return (
        <aside className="sidebar panel" aria-label="Scene browser">
            <div className="campaign-card">
                <button
                    className="icon-button sidebar-close"
                    onClick={onClose}
                    title="Close library"
                    aria-label="Close library"
                >
                    <X size={15} />
                </button>
                <div className="eyebrow">DEMO CAMPAIGN</div>
                <strong>The Hollow Marches</strong>
                <span>A place for your next story</span>
            </div>
            <nav className="library-tabs" aria-label="Workspace library">
                {(
                    [
                        [Layers, 'Scenes'],
                        [Images, 'Assets'],
                        [Clapperboard, 'Cues'],
                    ] as const
                ).map(([Icon, name]) => (
                    <button
                        key={name}
                        className={tab === name ? 'active' : ''}
                        aria-pressed={tab === name}
                        onClick={() => setTab(name)}
                    >
                        <Icon size={17} />
                        <span>{name}</span>
                    </button>
                ))}
            </nav>
            {tab === 'Scenes' ? (
                <>
                    <div className="section-heading">
                        <span>
                            SCENES <b>01</b>
                        </span>
                        <button
                            className="icon-button"
                            disabled
                            title="Scene creation comes in a later stage"
                            aria-label="Create scene (coming later)"
                        >
                            <Plus size={15} />
                        </button>
                    </div>
                    <button
                        className="scene-card active"
                        onClick={() => store.select(null)}
                        aria-label="The Sunken Observatory demo scene"
                    >
                        <div className="scene-thumbnail">
                            <div className="mini-ruin" />
                            <span className="demo-tag">DEMO</span>
                            <span className="scene-number">01</span>
                        </div>
                        <div className="scene-card-copy">
                            <strong>The Sunken Observatory</strong>
                            <small>Exploration · Lower court</small>
                            <span className="scene-active">
                                <i /> Open in workspace
                            </span>
                        </div>
                    </button>
                    <div className="outline-title">
                        <ChevronDown size={14} />
                        <span>SCENE OUTLINE</span>
                        <b>{scene.tokens.length}</b>
                    </div>
                    <div className="outline">
                        {scene.tokens.map((token) => (
                            <button
                                key={token.id}
                                aria-pressed={selectedIds.includes(token.id)}
                                className={selectedIds.includes(token.id) ? 'selected' : ''}
                                onClick={() => store.select(token.id)}
                            >
                                <span
                                    className={
                                        token.kind === 'hero'
                                            ? 'object-icon hero'
                                            : 'object-icon enemy'
                                    }
                                >
                                    <Shield size={14} />
                                </span>
                                <span>{token.name}</span>
                                <Circle size={6} fill="currentColor" />
                            </button>
                        ))}
                    </div>
                </>
            ) : (
                <div className="library-empty">
                    {tab === 'Assets' ? <Images size={26} /> : <Clapperboard size={26} />}
                    <h2>{tab === 'Assets' ? 'Your future collection' : 'Set the scene'}</h2>
                    <p>
                        {tab === 'Assets'
                            ? 'Maps, tokens and handouts will live here. This demo uses original vector artwork.'
                            : 'Prepared reveals and cinematic sequences will live here once the tabletop foundation is ready.'}
                    </p>
                    <span className="pill">Planned · not available yet</span>
                </div>
            )}
            <div className="sidebar-note">
                <span className="eyebrow">
                    A SMALL BEGINNING <ArrowUpRight size={12} />
                </span>
                <p>
                    Set the stage.
                    <br />
                    Make it your story.
                </p>
                <small>Renderer preview / 01</small>
            </div>
        </aside>
    );
}
