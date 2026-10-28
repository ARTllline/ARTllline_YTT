import { t } from '../i18n';
import { TemplateLibrary } from './objects/TemplateLibrary';
import type { ContentTemplate } from '../api/objects';
import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import {
    Layers,
    Images,
    ChevronDown,
    Plus,
    Shield,
    EyeOff,
    Lock,
    X,
    Pencil,
    Trash2,
    FolderOpen,
    Film,
} from 'lucide-react';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { Campaign } from '../api/workspace';
import type { LibraryAsset } from '../api/preparation';
import { AssetLibrary } from './assets/LazyAssets';
const CueLibrary = lazy(() =>
    import('./cues/CueLibrary').then((module) => ({ default: module.CueLibrary })),
);
export function Sidebar({
    store,
    campaign,
    onClose,
    onNavigate,
    onCreate,
    onRename,
    onDelete,
    onCampaignRename,
    onUseAsset,
    onUseTemplate,
    templateRefresh,
}: {
    onUseTemplate: (template: Pick<ContentTemplate, 'id' | 'kind' | 'name'>) => void;
    templateRefresh: number;
    store: SceneStore;
    campaign: Campaign;
    onClose: () => void;
    onNavigate: (url: string) => void;
    onCreate: () => void;
    onRename: () => void;
    onDelete: () => void;
    onCampaignRename: () => void;
    onUseAsset: (asset: LibraryAsset) => void;
}) {
    const [tab, setTab] = useState<'Scenes' | 'Assets' | 'Prefabs' | 'Encounters' | 'Events'>(
        'Scenes',
    );
    const { scene, selectedIds } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    return (
        <aside className="sidebar panel" aria-label={t('Scene browser')}>
            <div className="campaign-card">
                <button
                    className="icon-button sidebar-close"
                    onClick={onClose}
                    title={t('Close library')}
                    aria-label={t('Close library')}
                >
                    <X size={15} />
                </button>
                <div className="eyebrow"> {t('CAMPAIGN WORKSPACE')} </div>
                <strong>{campaign.name}</strong>
                <div className="campaign-links">
                    <button onClick={() => onNavigate('/')}>
                        <FolderOpen size={12} /> {t('Switch campaign')}{' '}
                    </button>
                    <button
                        className="icon-button"
                        aria-label={t('Rename campaign')}
                        title={t('Rename campaign')}
                        onClick={onCampaignRename}
                    >
                        <Pencil size={12} />
                    </button>
                </div>
            </div>
            <nav className="library-tabs" aria-label={t('Workspace library')}>
                {(
                    [
                        [Layers, 'Scenes'],
                        [Images, 'Assets'],
                        [Layers, 'Prefabs'],
                        [Shield, 'Encounters'],
                        [Film, 'Events'],
                    ] as const
                ).map(([Icon, name]) => (
                    <button
                        key={name}
                        className={tab === name ? 'active' : ''}
                        aria-pressed={tab === name}
                        onClick={() => setTab(name)}
                    >
                        <Icon size={17} />
                        <span>{t(name)}</span>
                    </button>
                ))}
            </nav>
            {tab === 'Scenes' ? (
                <>
                    <div className="section-heading">
                        <span>
                            {' '}
                            {t('SCENES')}{' '}
                            <b>{campaign.scenes.length.toString().padStart(2, '0')}</b>
                        </span>
                        <button
                            className="icon-button"
                            title={t('Create scene')}
                            aria-label={t('Create scene')}
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
                                            ? t('Active for players')
                                            : scene.id === item.id
                                              ? t('Editing')
                                              : t('Prepared')}
                                    </small>
                                </span>
                                {campaign.activeSceneId === item.id && <i className="status-dot" />}
                            </button>
                        ))}
                    </div>
                    {scene.id && (
                        <div className="scene-actions">
                            <button onClick={onRename}>
                                <Pencil size={12} /> {t('Rename')}{' '}
                            </button>
                            <button onClick={onDelete}>
                                <Trash2 size={12} /> {t('Delete')}{' '}
                            </button>
                        </div>
                    )}
                    <div className="outline-title">
                        <ChevronDown size={14} />
                        <span> {t('SCENE OUTLINE')} </span>
                        <b>{scene.tokens.length + (scene.props?.length ?? 0)}</b>
                    </div>
                    <div className="outline">
                        {scene.tokens.map((token) => (
                            <button
                                key={token.id}
                                aria-pressed={selectedIds.includes(token.id)}
                                className={selectedIds.includes(token.id) ? 'selected' : ''}
                                onClick={(e) => store.selectObject('token', token.id, e.shiftKey)}
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
                        {(scene.props ?? []).map((prop) => (
                            <button
                                key={'prop' + prop.id}
                                aria-pressed={
                                    store.getSnapshot().selectedPropIds?.includes(prop.id) ?? false
                                }
                                onClick={(e) => store.selectObject('prop', prop.id, e.shiftKey)}
                            >
                                <Layers size={14} />
                                <span>{prop.name}</span>
                                {prop.isHidden ? (
                                    <EyeOff size={12} />
                                ) : prop.isLocked ? (
                                    <Lock size={12} />
                                ) : null}
                            </button>
                        ))}
                        {!scene.tokens.length && !scene.props?.length && (
                            <p className="hint outline-empty">
                                {' '}
                                {t('Your cast starts here.')} <br />{' '}
                                {t('Add a token to the tabletop.')}{' '}
                            </p>
                        )}
                    </div>
                </>
            ) : tab === 'Events' ? (
                <Suspense fallback={<p className="hint">Загрузка событий…</p>}>
                    <CueLibrary
                        key={scene.id}
                        scene={scene}
                        active={campaign.activeSceneId === scene.id}
                    />
                </Suspense>
            ) : tab === 'Assets' ? (
                <AssetLibrary campaignId={campaign.id} onUse={onUseAsset} />
            ) : (
                <TemplateLibrary
                    key={tab}
                    campaignId={campaign.id}
                    kind={tab === 'Prefabs' ? 'prefab' : 'encounter'}
                    refresh={templateRefresh}
                    onUse={onUseTemplate}
                />
            )}
            {tab === 'Scenes' && (
                <div className="sidebar-note">
                    <span className="eyebrow"> {t('YOUR WORLD, AT YOUR PACE')} </span>
                    <p>
                        {' '}
                        {t('Set the stage.')} <br /> {t('Make it your story.')}{' '}
                    </p>
                    <small> {t('Changes save as you work.')} </small>
                </div>
            )}
        </aside>
    );
}
