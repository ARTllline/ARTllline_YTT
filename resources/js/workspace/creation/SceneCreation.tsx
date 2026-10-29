import { useState } from 'react';
import { Grid2X2, Images, Upload } from 'lucide-react';
import { Dialog } from '../Dialog';
import { AssetLibrary } from '../assets/LazyAssets';
import { preparation, type LibraryAsset } from '../../api/preparation';

export function SceneCreation({
    campaignId,
    onClose,
    onCreate,
}: {
    campaignId: string;
    onClose: () => void;
    onCreate: (name: string, asset?: LibraryAsset) => Promise<void>;
}) {
    const [mode, setMode] = useState<'library' | 'upload' | 'blank'>('library');
    const [asset, setAsset] = useState<LibraryAsset>();
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const choose = (value: LibraryAsset) => {
        setAsset(value);
        if (!name.trim()) setName(value.name.slice(0, 120));
    };
    return (
        <Dialog title="Новая сцена" onClose={() => !busy && onClose()}>
            <div className="scene-creation">
                <p className="hint">
                    Выберите место для следующей истории. Сцена сохранится в подготовке.
                </p>
                <div className="scene-source-options">
                    {(
                        [
                            ['library', 'Выбрать карту', Images],
                            ['upload', 'Загрузить карту', Upload],
                            ['blank', 'Пустая сцена', Grid2X2],
                        ] as const
                    ).map(([key, label, Icon]) => (
                        <button
                            key={key}
                            disabled={busy}
                            aria-pressed={mode === key}
                            onClick={() => {
                                setMode(key);
                                setError('');
                            }}
                        >
                            <Icon size={25} />
                            <strong>{label}</strong>
                        </button>
                    ))}
                </div>
                {mode === 'library' && (
                    <AssetLibrary campaignId={campaignId} pickerKind="map" onUse={choose} />
                )}
                {mode === 'upload' && (
                    <label className="scene-upload">
                        <Upload size={32} />
                        <strong>{busy ? 'Загружаем карту…' : 'Выберите PNG, JPEG или WebP'}</strong>
                        <span>Карта останется в библиотеке кампании</span>
                        <input
                            type="file"
                            aria-label="Загрузить карту новой сцены"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={busy}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (!file) return;
                                setBusy(true);
                                setError('');
                                void preparation
                                    .upload(campaignId, file, 'map')
                                    .then(choose)
                                    .catch((e) => setError(e.message))
                                    .finally(() => setBusy(false));
                            }}
                        />
                    </label>
                )}
                {mode === 'blank' ? (
                    <div className="scene-preview blank-scene">
                        <Grid2X2 size={42} />
                        <span>Чистая сетка · 1440 × 1080</span>
                    </div>
                ) : (
                    asset && (
                        <div className="scene-preview">
                            <img src={asset.thumbnailUrl} alt={asset.name} />
                            <div>
                                <strong>{asset.name}</strong>
                                <small>
                                    {asset.width} × {asset.height}
                                </small>
                            </div>
                        </div>
                    )
                )}
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (busy || !name.trim() || (mode !== 'blank' && !asset)) return;
                        setBusy(true);
                        setError('');
                        void onCreate(name.trim(), mode === 'blank' ? undefined : asset).catch(
                            (e) => {
                                setError(e.message);
                                setBusy(false);
                            },
                        );
                    }}
                >
                    <label className="field">
                        <span>Название сцены</span>
                        <input
                            required
                            maxLength={120}
                            disabled={busy}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Например, Засада у старой мельницы"
                        />
                    </label>
                    {error && (
                        <p className="form-error" role="alert">
                            {error}
                        </p>
                    )}
                    <div className="dialog-actions">
                        <button
                            type="button"
                            className="secondary-button"
                            disabled={busy}
                            onClick={onClose}
                        >
                            Отмена
                        </button>
                        <button
                            className="primary-button"
                            disabled={busy || !name.trim() || (mode !== 'blank' && !asset)}
                        >
                            {busy ? 'Сохраняем…' : 'Создать сцену'}
                        </button>
                    </div>
                </form>
            </div>
        </Dialog>
    );
}
