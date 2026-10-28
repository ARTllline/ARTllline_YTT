import {
    useEffect,
    useState,
    useSyncExternalStore,
    type RefObject,
    type CSSProperties,
} from 'react';
import { X } from 'lucide-react';
import type { LiveEcho, ConnectionState } from '../realtime/useCampaignLive';
import type { TabletopRenderer } from '../tabletop/renderer/TabletopRenderer';
import { DirectorState, type DirectorEvent } from './DirectorState';

export function DirectorLayer({
    sceneId,
    epoch,
    channel,
    echo,
    connection,
    renderer,
}: {
    sceneId: string;
    epoch: number;
    channel: string;
    echo: LiveEcho | null;
    connection: ConnectionState;
    renderer: RefObject<TabletopRenderer | null>;
}) {
    const [state] = useState(() => new DirectorState(sceneId, epoch));
    const view = useSyncExternalStore(state.subscribe, state.getSnapshot);
    useEffect(() => {
        state.bindCamera((event) => renderer.current?.direct(event));
        if (!echo || connection !== 'connected') {
            state.reset();
            return;
        }
        const receive = (event: DirectorEvent) => {
            if (navigator.onLine) state.accept(event);
        };
        const subscription = echo.private(channel).listen('.tabletop', receive);
        const timer = setInterval(() => state.tick(), 200);
        const escape = (event: KeyboardEvent) => {
            if (event.code === 'Escape') state.release();
        };
        window.addEventListener('keydown', escape);
        window.addEventListener('offline', state.reset);
        return () => {
            subscription.stopListening('.tabletop', receive);
            clearInterval(timer);
            window.removeEventListener('keydown', escape);
            window.removeEventListener('offline', state.reset);
            state.reset();
        };
    }, [state, echo, channel, connection, renderer]);
    return (
        <div
            className={`director-layer ${view.directed || view.blackout || view.message ? 'active' : ''}`}
        >
            <div
                className="director-fade"
                style={{
                    opacity: view.blackout ? 1 : 0,
                    transitionDuration: `${view.fadeDuration}ms`,
                }}
            />
            {view.pulse && (
                <div
                    key={view.pulse.id}
                    className={`screen-pulse ${view.pulse.kind}`}
                    style={
                        {
                            '--pulse-color': view.pulse.color,
                            '--pulse-duration': `${view.pulse.duration}ms`,
                        } as CSSProperties
                    }
                />
            )}
            {view.message && (
                <div className="director-message" role="status">
                    {view.message.title && <h2>{view.message.title}</h2>}
                    <p>{view.message.text}</p>
                </div>
            )}
            {(view.directed || view.blackout || view.message) && (
                <button className="director-release" onClick={state.release}>
                    <X size={14} /> Вернуть управление · Esc
                </button>
            )}
        </div>
    );
}
