/** Visual banks retain canonical slot indices and 1–8 / Shift+1–8 shortcuts. */
export function deckBanks(page: number, expanded: boolean) {
    const pages = expanded ? [0, 1] : [page === 1 ? 1 : 0];
    return pages.flatMap((p) =>
        [0, 1].map((bank) => ({
            key: `${p}:${bank}`,
            label: `${p === 0 ? 'I' : 'II'} · ${bank === 0 ? '1–4' : '5–8'}`,
            indices: [0, 1, 2, 3, 8, 9, 10, 11].map((i) => p * 16 + bank * 4 + i),
        })),
    );
}
