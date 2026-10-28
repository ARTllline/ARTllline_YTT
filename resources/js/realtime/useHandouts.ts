import { useEffect, useReducer, useState, useRef } from 'react';
import { ApiError } from '../api/client';
import { preparation, type Handout } from '../api/preparation';
import type { LiveEcho } from './useCampaignLive';
import { presentationReducer, type HandoutPresentation } from './handoutPresentation';

/** Campaign-scoped adapter: independent of active-scene subscriptions and revisions. */
export function useHandouts(
    campaignId: string,
    userId: string,
    echo: LiveEcho | null,
    page: number,
    open: boolean,
) {
    const [items, setItems] = useState<Handout[]>([]),
        [pages, setPages] = useState(1),
        [error, setError] = useState('');
    const [presentation, dispatch] = useReducer(presentationReducer, { selected: null, seen: [] });
    const selectedRef = useRef(presentation.selected);
    useEffect(() => {
        selectedRef.current = presentation.selected;
    }, [presentation.selected]);
    useEffect(() => {
        let alive = true,
            generation = 0;
        let presentationGeneration = 0;
        let controller: AbortController | undefined;
        const refresh = () => {
            const selected = selectedRef.current;
            const selectedGeneration = presentationGeneration;
            if (selected)
                void preparation.handout(campaignId, selected.id).catch((e) => {
                    if (
                        alive &&
                        selectedGeneration === presentationGeneration &&
                        e instanceof ApiError &&
                        [403, 404].includes(e.status)
                    )
                        dispatch({ type: 'revoke', id: selected.id });
                });
            const current = ++generation;
            controller?.abort();
            controller = new AbortController();
            void preparation
                .handouts(campaignId, page, controller.signal)
                .then((data) => {
                    if (alive && current === generation) {
                        setItems(data.handouts);
                        setPages(data.pages);
                        setError('');
                    }
                })
                .catch((e) => {
                    if (alive && current === generation && e.name !== 'AbortError')
                        setError(e.message);
                });
        };
        const receive = (event: HandoutPresentation & { handoutId?: string }) => {
            if (!alive || event.campaignId !== campaignId) return;
            const currentPresentation = ++presentationGeneration;
            if (event.type === 'handout.revoked' && event.handoutId) {
                dispatch({ type: 'revoke', id: event.handoutId });
                setItems((items) => items.filter((h) => h.id !== event.handoutId));
            } else if (event.type === 'handout.shown') {
                void preparation
                    .handout(campaignId, event.handout.id)
                    .then((handout) => {
                        if (alive && currentPresentation === presentationGeneration)
                            dispatch({ type: 'receive', campaignId, event: { ...event, handout } });
                    })
                    .catch(() => {
                        /* A late presentation may have already been revoked. */
                    });
            } else return;
            refresh();
        };
        const channel = `campaign.${campaignId}.handouts.user.${userId}`;
        echo?.private(channel).listen('.tabletop', receive).subscribed(refresh);
        refresh();
        const timer = setInterval(refresh, 15000);
        window.addEventListener('online', refresh);
        return () => {
            alive = false;
            controller?.abort();
            clearInterval(timer);
            window.removeEventListener('online', refresh);
            echo?.leave(channel);
        };
    }, [campaignId, userId, echo, page, open]);
    return {
        items,
        pages,
        error,
        selected: presentation.selected,
        select: (handout: Handout) => dispatch({ type: 'open', handout }),
        close: () => dispatch({ type: 'close' }),
    };
}
