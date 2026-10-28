import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(error: Error) {
        console.error('Workspace failed:', error);
    }
    render() {
        if (this.state.failed)
            return (
                <div className="boot">
                    <h1>The workspace could not open.</h1>
                    <p>
                        Reload to restore the demo. Diagnostic details are available in the browser
                        console.
                    </p>
                    <button onClick={() => location.reload()}>Reload workspace</button>
                </div>
            );
        return this.props.children;
    }
}
