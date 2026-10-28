import { t } from '../i18n';
import { useState } from 'react';
import { Dialog } from './Dialog';
export function ConfirmDialog({
    title,
    description,
    submit,
    onClose,
    buttonLabel = t('Delete'),
}: {
    title: string;
    description: string;
    submit: () => Promise<void>;
    onClose: () => void;
    buttonLabel?: string;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    return (
        <Dialog title={title} onClose={() => !busy && onClose()}>
            <p>{description}</p>
            {error && (
                <p role="alert" className="form-error">
                    {error}
                </p>
            )}
            <div className="dialog-actions">
                <button className="secondary-button" disabled={busy} onClick={onClose}>
                    {' '}
                    {t('Cancel')}{' '}
                </button>
                <button
                    className="danger-button"
                    disabled={busy}
                    onClick={() => {
                        setBusy(true);
                        void submit()
                            .then(onClose)
                            .catch((error) => {
                                setError(error.message);
                                setBusy(false);
                            });
                    }}
                >
                    {busy ? t('Working…') : buttonLabel}
                </button>
            </div>
        </Dialog>
    );
}
