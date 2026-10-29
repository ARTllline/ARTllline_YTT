import { t } from '../i18n';
import { PreparationTabs } from './WorkspaceNavigation';
import type { LeftPanel } from './workspaceState';
import { TemplateLibrary } from './objects/TemplateLibrary';
import type { ContentTemplate } from '../api/objects';
import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { Layers, ChevronDown, Plus, Shield, EyeOff, Lock, X, Pencil, Trash2 } from 'lucide-react';
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
    panel,
    onPanel,
    onAutomation,
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
    panel: LeftPanel;
    onPanel: (panel: LeftPanel) => void;
    onAutomation: () => void;
    onUseAsset: (asset: LibraryAsset) => void;
}) {
    const tab = (
        {
            scenes: 'Scenes',
            assets: 'Assets',
            prefabs: 'Prefabs',
            encounters: 'Encounters',
            cues: 'Events',
            session: 'Scenes',
        } as const
    )[panel];
    const [search, setSearch] = useState('');
    const { scene, selectedIds } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    return (
        <aside className="sidebar panel" aria-label={t('Scene browser')}>
            <div className="workspace-panel-heading">
                <div>
                    <span className="eyebrow">ПОДГОТОВКА МИРА</span>
                    <h2>{t(tab)}</h2>
                </div>
                <button
                    className="icon-button"
                    onClick={onClose}
                    title="Закрыть библиотеку"
                    aria-label="Закрыть библиотеку"
                >
                    <X size={18} />
                </button>
            </div>
            <PreparationTabs panel={panel} onPanel={onPanel} onAutomation={onAutomation} />
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
                    <input
                        className="scene-search"
                        aria-label="Найти сцену"
                        placeholder="Найти сцену…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <div className="scene-list">
                        {campaign.scenes
                            .filter((item) =>
                                item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                            )
                            .map((item, index) => (
                                <button
                                    className={`persistent-scene ${scene.id === item.id ? 'selected' : ''}`}
                                    key={item.id}
                                    onClick={() =>
                                        onNavigate(`/campaigns/${campaign.id}/scenes/${item.id}`)
                                    }
                                >
                                    <span className="scene-tile">
                                        {scene.id === item.id && scene.map ? (
                                            <img src={scene.map.asset.url} alt="" />
                                        ) : (
                                            <span>{String(index + 1).padStart(2, '0')}</span>
                                        )}
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
                                    {campaign.activeSceneId === item.id && (
                                        <i className="status-dot" />
                                    )}
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
                    <details className="scene-outline">
                        <summary className="outline-title">
                            <ChevronDown size={14} />
                            <span> {t('SCENE OUTLINE')} </span>
                            <b>{scene.tokens.length + (scene.props?.length ?? 0)}</b>
                        </summary>
                        <div className="outline">
                            {scene.tokens.map((token) => (
                                <button
                                    key={token.id}
                                    aria-pressed={selectedIds.includes(token.id)}
                                    className={selectedIds.includes(token.id) ? 'selected' : ''}
                                    onClick={(e) =>
                                        store.selectObject('token', token.id, e.shiftKey)
                                    }
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
                                        store.getSnapshot().selectedPropIds?.includes(prop.id) ??
                                        false
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
                    </details>
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
        </aside>
    );
}
