import { t } from '../../i18n';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Copy, Trash2, PackagePlus, Swords, X } from 'lucide-react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { SaveQueue } from '../../tabletop/state/SaveQueue';
import { objects } from '../../api/objects';
import { NameDialog } from '../NameDialog';
import { ConfirmDialog } from '../ConfirmDialog';

export function SelectionControls({
    store,
    queue,
    campaignId,
    onSaved,
}: {
    store: SceneStore;
    queue: SaveQueue;
    campaignId: string;
    onSaved: () => void;
}) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const save = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
    const [modal, setModal] = useState<'delete' | 'prefab' | 'encounter' | null>(null);
    const [error, setError] = useState('');
    const count = state.selectedIds.length + (state.selectedPropIds?.length ?? 0),
        busy = save.status !== 'saved';
    useEffect(() => {
        store.bindSelectionActions((action) => {
            const s = store.selection();
            if ((!s.tokenIds.length && !s.propIds.length) || queue.getSnapshot().status !== 'saved')
                return;
            if (action === 'delete') setModal('delete');
            else store.objectCommand({ endpoint: 'selection', data: { action, ...s } });
        });
        return () => {
            store.bindSelectionActions();
        };
    }, [store, queue]);
    const addCombat = async () => {
        setError('');
        try {
            await queue.flush();
            if (!store.getSnapshot().scene.combat) {
                store.combatCommand({ action: 'prepare' });
                await queue.flush();
            }
            const current = store.getSnapshot(),
                combat = current.scene.combat!;
            const tokenIds =
                current.spawnedEncounter?.tokenIds.filter((id) =>
                    current.scene.tokens.some((t) => t.id === id),
                ) ?? [];
            if (tokenIds.length) {
                store.combatCommand({ action: 'add', combatId: combat.id, tokenIds });
                await queue.flush();
            }
            store.clearEncounterNotice();
        } catch (e) {
            setError((e as Error).message);
        }
    };
    return (
        <>
            {count > 0 && (
                <div className="selection-actions surface" aria-label={t('Selection actions')}>
                    <span>
                        {count} {t('selected')}{' '}
                    </span>
                    <button
                        disabled={busy}
                        title={t('Duplicate selection · Ctrl+D')}
                        onClick={() => store.onSelectionAction?.('duplicate')}
                    >
                        <Copy size={14} />
                        <span> {t('Duplicate')} </span>
                    </button>
                    <button
                        disabled={busy}
                        title={t('Delete selection')}
                        onClick={() => setModal('delete')}
                    >
                        <Trash2 size={14} />
                        <span> {t('Delete')} </span>
                    </button>
                    <button disabled={busy} onClick={() => setModal('prefab')}>
                        <PackagePlus size={14} />
                        <span> {t('Save as prefab')} </span>
                    </button>
                    {!state.selectedPropIds?.length && (
                        <button disabled={busy} onClick={() => setModal('encounter')}>
                            <Swords size={14} />
                            <span> {t('Save as encounter')} </span>
                        </button>
                    )}
                </div>
            )}
            {state.spawnedEncounter && (
                <div className="encounter-notice surface">
                    <strong>{state.spawnedEncounter.name}</strong>
                    <span> {t('Placed on the scene')} </span>
                    <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() => void addCombat()}
                    >
                        {' '}
                        {t('Add to combat')}{' '}
                    </button>
                    <button
                        className="icon-button"
                        aria-label={t('Close')}
                        onClick={() => store.clearEncounterNotice()}
                    >
                        <X size={14} />
                    </button>
                    {error && <p role="alert">{error}</p>}
                </div>
            )}
            {modal === 'delete' && (
                <ConfirmDialog
                    title={t('Delete selection?')}
                    description={t(
                        'Selected objects will be removed from this scene. Saved templates remain available.',
                    )}
                    onClose={() => setModal(null)}
                    submit={async () => {
                        store.objectCommand({
                            endpoint: 'selection',
                            data: { action: 'delete', ...store.selection() },
                        });
                        await queue.flush();
                    }}
                />
            )}
            {(modal === 'prefab' || modal === 'encounter') && (
                <NameDialog
                    title={modal === 'prefab' ? t('Save as prefab') : t('Save as encounter')}
                    label={t('Name')}
                    description={t('templateStartingState')}
                    onClose={() => setModal(null)}
                    submit={async (name) => {
                        await queue.flush();
                        await objects.save(
                            campaignId,
                            state.scene.id!,
                            modal,
                            name,
                            store.selection(),
                        );
                        onSaved();
                    }}
                />
            )}
        </>
    );
}
