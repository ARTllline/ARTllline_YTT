import { useSyncExternalStore } from 'react';
import { Play, Square } from 'lucide-react';
import { audioEngine } from './AudioEngine';
import type { LibraryAsset } from '../api/preparation';

export function AudioPreview({ asset }: { asset: LibraryAsset }) {
    const view = useSyncExternalStore(audioEngine.subscribe, audioEngine.getSnapshot);
    return (
        <button
            type="button"
            className="audio-preview"
            onClick={() => void audioEngine.preview(asset)}
        >
            {view.preview === asset.id ? <Square size={13} /> : <Play size={13} />}
            {view.preview === asset.id ? 'Остановить просмотр' : 'Прослушать'}
        </button>
    );
}
