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
}
export type WorkspaceAction =
    | { type: 'mode'; mode: WorkspaceMode }
    | { type: 'left'; panel: LeftPanel | null }
    | { type: 'right'; panel: RightPanel; compact?: boolean; force?: boolean }
    | { type: 'close-right'; selection: string }
    | { type: 'selection'; key: string };
export const initialWorkspace: WorkspaceState = {
    mode: 'table',
    left: null,
    right: 'context',
    dismissedSelection: null,
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
                        : action.mode === 'session'
                          ? 'session'
                          : action.mode === 'library'
                            ? 'assets'
                            : null,
            };
        case 'left':
            return { ...state, left: action.panel, right: 'context', dismissedSelection: null };
        case 'right':
            return {
                ...state,
                right: state.right === action.panel && !action.force ? 'context' : action.panel,
                left: state.mode === 'session' && !action.compact ? state.left : null,
                dismissedSelection: null,
            };
        case 'close-right':
            return {
                ...state,
                right: 'context',
                dismissedSelection: state.right === 'context' ? action.selection : null,
            };
        case 'selection':
            return {
                ...state,
                dismissedSelection: null,
                left:
                    action.key && state.mode !== 'session' && state.right === 'context'
                        ? null
                        : state.left,
            };
    }
}
export function contextualPanel(state: WorkspaceState, selection: string): RightPanel | null {
    if (state.right !== 'context') return state.right;
    return selection && state.dismissedSelection !== selection ? 'context' : null;
}
