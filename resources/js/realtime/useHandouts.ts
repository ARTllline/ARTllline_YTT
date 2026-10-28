import { useEffect, useReducer, useState } from 'react';
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
    useEffect(() => {
        let alive = true,
            generation = 0;
        let controller: AbortController | undefined;
        const refresh = () => {
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
        const receive = (event: HandoutPresentation) => {
            if (!alive || event.type !== 'handout.shown' || event.campaignId !== campaignId) return;
            dispatch({ type: 'receive', campaignId, event });
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
