import { useState, useSyncExternalStore } from 'react';
import {
    Layers,
    Images,
    Clapperboard,
    ChevronDown,
    Plus,
    Shield,
    EyeOff,
    Lock,
    X,
    Pencil,
    Trash2,
    FolderOpen,
} from 'lucide-react';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { Campaign } from '../api/workspace';
export function Sidebar({
    store,
    campaign,
    onClose,
    onNavigate,
    onCreate,
    onRename,
    onDelete,
    onCampaignRename,
}: {
    store: SceneStore;
    campaign: Campaign;
    onClose: () => void;
    onNavigate: (url: string) => void;
    onCreate: () => void;
    onRename: () => void;
    onDelete: () => void;
    onCampaignRename: () => void;
}) {
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
                <div className="eyebrow">CAMPAIGN WORKSPACE</div>
                <strong>{campaign.name}</strong>
                <div className="campaign-links">
                    <button onClick={() => onNavigate('/')}>
                        <FolderOpen size={12} /> Switch campaign
                    </button>
                    <button
                        className="icon-button"
                        aria-label="Rename campaign"
                        title="Rename campaign"
                        onClick={onCampaignRename}
                    >
                        <Pencil size={12} />
                    </button>
                </div>
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
                            SCENES <b>{campaign.scenes.length.toString().padStart(2, '0')}</b>
                        </span>
                        <button
                            className="icon-button"
                            title="Create scene"
                            aria-label="Create scene"
                            onClick={onCreate}
                        >
                            <Plus size={15} />
                        </button>
                    </div>
                    <div className="scene-list">
                        {campaign.scenes.map((item) => (
                            <button
                                className={`persistent-scene ${scene.id === item.id ? 'selected' : ''}`}
                                key={item.id}
                                onClick={() =>
                                    onNavigate(`/campaigns/${campaign.id}/scenes/${item.id}`)
                                }
                            >
                                <span className="scene-tile">
                                    <Layers size={19} />
                                </span>
                                <span>
                                    <strong>{item.name}</strong>
                                    <small>
                                        {campaign.activeSceneId === item.id
                                            ? 'Active for players'
                                            : scene.id === item.id
                                              ? 'Editing'
                                              : 'Prepared'}
                                    </small>
                                </span>
                                {campaign.activeSceneId === item.id && <i className="status-dot" />}
                            </button>
                        ))}
                    </div>
                    {scene.id && (
                        <div className="scene-actions">
                            <button onClick={onRename}>
                                <Pencil size={12} /> Rename
                            </button>
                            <button onClick={onDelete}>
                                <Trash2 size={12} /> Delete
                            </button>
                        </div>
                    )}
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
                                    className={`object-icon ${token.isHidden ? 'gm-only' : 'hero'}`}
                                >
                                    <Shield size={14} />
                                </span>
                                <span>{token.name}</span>
                                {token.isHidden ? (
                                    <EyeOff size={12} />
                                ) : token.isLocked ? (
                                    <Lock size={12} />
                                ) : null}
                            </button>
                        ))}
                        {!scene.tokens.length && (
                            <p className="hint outline-empty">
                                Your cast starts here.
                                <br />
                                Add a token to the tabletop.
                            </p>
                        )}
                    </div>
                </>
            ) : (
                <div className="library-empty">
                    {tab === 'Assets' ? <Images size={26} /> : <Clapperboard size={26} />}
                    <h2>{tab === 'Assets' ? 'A place for your collection' : 'Set the scene'}</h2>
                    <p>
                        {tab === 'Assets'
                            ? 'Upload a map in Scene setup, or a token image in Inspector. Collections and reusable browsing come later.'
                            : 'Prepared reveals and cinematic sequences will live here in a future stage.'}
                    </p>
                    <span className="pill">Full library · coming later</span>
                </div>
            )}
            <div className="sidebar-note">
                <span className="eyebrow">YOUR WORLD, AT YOUR PACE</span>
                <p>
                    Set the stage.
                    <br />
                    Make it your story.
                </p>
                <small>Changes save as you work.</small>
            </div>
        </aside>
    );
}
