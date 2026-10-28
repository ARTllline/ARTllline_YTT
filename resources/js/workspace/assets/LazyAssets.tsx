import { lazy, Suspense, type ComponentProps } from 'react';
const Library = lazy(() => import('./AssetLibrary').then((m) => ({ default: m.AssetLibrary })));
const Details = lazy(() => import('./AssetDetails').then((m) => ({ default: m.AssetDetails })));
export function AssetLibrary(props: ComponentProps<typeof Library>) {
    return (
        <Suspense fallback={<p className="hint">Загрузка библиотеки…</p>}>
            <Library {...props} />
        </Suspense>
    );
}
export function AssetDetails(props: ComponentProps<typeof Details>) {
    return (
        <Suspense fallback={<p className="hint">Загрузка материала…</p>}>
            <Details {...props} />
        </Suspense>
    );
}
