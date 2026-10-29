/** CSS owns the timing scale. Canvas and Web Animations read the same tokens. */
export function motionDuration(kind: 'instant' | 'fast' | 'normal' | 'cinematic') {
    const value = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(`--motion-${kind}`),
    );
    return Number.isFinite(value) ? value : 0;
}
/** A noninteractive visual copy lets layout settle immediately while the old surface leaves. */
export function leaveSurface(selector: string) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const source = document.querySelector<HTMLElement>(selector);
    if (!source) return;
    const bounds = source.getBoundingClientRect(),
        ghost = source.cloneNode(true) as HTMLElement;
    ghost.inert = true;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.dataset.motionGhost = 'true';
    // Keep inherited workspace styles, without carrying an interactive React tree.
    const shell = document.createElement('div');
    shell.className = 'redesigned-workspace motion-ghost';
    shell.inert = true;
    Object.assign(shell.style, {
        position: 'fixed',
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        pointerEvents: 'none',
        zIndex: '80',
    });
    Object.assign(ghost.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        animation: 'none',
        resize: 'none',
        pointerEvents: 'none',
    });
    shell.appendChild(ghost);
    document.body.appendChild(shell);
    void shell
        .animate(
            [
                { opacity: 1, transform: 'translateX(0)' },
                { opacity: 0, transform: 'translateX(6px)' },
            ],
            { duration: motionDuration('fast'), easing: 'ease-out' },
        )
        .finished.catch(() => {})
        .finally(() => shell.remove());
}
