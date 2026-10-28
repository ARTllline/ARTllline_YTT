import type { Handout } from '../api/preparation';
export interface HandoutPresentation {
    type: string;
    campaignId: string;
    presentationId: string;
    handout: Handout;
}
export interface PresentationState {
    selected: Handout | null;
    seen: string[];
}
export type PresentationAction =
    | { type: 'open'; handout: Handout }
    | { type: 'close' }
    | { type: 'revoke'; id: string }
    | { type: 'receive'; campaignId: string; event: HandoutPresentation };
export function presentationReducer(
    state: PresentationState,
    action: PresentationAction,
): PresentationState {
    if (action.type === 'close') return { ...state, selected: null };
    if (action.type === 'revoke')
        return state.selected?.id === action.id ? { ...state, selected: null } : state;
    if (action.type === 'open') return { ...state, selected: action.handout };
    const event = action.event;
    if (
        event.type !== 'handout.shown' ||
        event.campaignId !== action.campaignId ||
        state.seen.includes(event.presentationId)
    )
        return state;
    return { selected: event.handout, seen: [...state.seen.slice(-99), event.presentationId] };
}
