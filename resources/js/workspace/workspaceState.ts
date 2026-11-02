export type WorkspaceMode = 'table' | 'prepare' | 'session' | 'library';
export type LeftPanel = 'scenes' | 'assets' | 'prefabs' | 'encounters' | 'cues' | 'session';
export type RightPanel =
    | 'context'
    | 'scene'
    | 'combat'
    | 'audio'
    | 'cues'
    | 'handouts'
    | 'players'
    | 'triggers'
    | 'settings'
    | 'region';
export interface WorkspaceState {
    mode: WorkspaceMode;
    left: LeftPanel | null;
    right: RightPanel;
    dismissedSelection: string | null;
    expanded: boolean;
    pinned: boolean;
}
export type WorkspaceAction =
    | { type: 'mode'; mode: WorkspaceMode }
    | { type: 'left'; panel: LeftPanel | null }
    | { type: 'right'; panel: RightPanel; compact?: boolean; force?: boolean }
    | { type: 'close-right'; selection: string }
    | { type: 'selection'; key: string }
    | { type: 'expand'; value: boolean }
    | { type: 'pin' };
// Surface preferences are local presentation state, never scene data.
export const initialWorkspace: WorkspaceState = {
    mode: 'table',
    left: null,
    right: 'context',
    dismissedSelection: null,
    expanded: false,
    pinned: false,
};
export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
    switch (action.type) {
        case 'mode':
            return {
                ...initialWorkspace,
                mode: action.mode,
                left:
                    action.mode === 'prepare'
                        ? 'scenes'
                        : action.mode === 'library'
                          ? 'assets'
                          : null,
            };
        case 'left':
            return {
                ...state,
                left: action.panel,
                right: 'context',
                dismissedSelection: null,
                expanded: false,
                pinned: false,
            };
        case 'right':
            return {
                ...state,
                right: state.right === action.panel && !action.force ? 'context' : action.panel,
                left: null,
                dismissedSelection: null,
                expanded: state.mode === 'session' && action.panel === 'context',
                pinned: false,
            };
        case 'close-right':
            return {
                ...state,
                right: 'context',
                dismissedSelection:
                    state.right === 'context' && !state.expanded ? action.selection : null,
                expanded: false,
                pinned: false,
            };
        case 'selection':
            return {
                ...state,
                dismissedSelection: null,
                expanded: state.pinned ? state.expanded : false,
                left: action.key && state.right === 'context' ? null : state.left,
            };
        case 'expand':
            return { ...state, expanded: action.value, pinned: action.value && state.pinned };
        case 'pin':
            return { ...state, pinned: !state.pinned, expanded: true };
    }
}
export function contextualPanel(state: WorkspaceState, selection: string): RightPanel | null {
    if (state.left) return null;
    if (state.right !== 'context') return state.right;
    if (state.pinned) return 'context';
    return selection && state.dismissedSelection !== selection ? 'context' : null;
}
