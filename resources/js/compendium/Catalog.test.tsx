import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CatalogEmpty, CatalogIcon, CoverageBadge, OriginBadge, rulesLabel } from './Catalog';

describe('Compendium presentation contracts', () => {
    it('uses a neutral fallback for absent or untrusted artwork paths', () => {
        for (const icon of [
            undefined,
            '',
            'B:/BG3/icons/fire.png',
            'https://example.test/art.png',
        ]) {
            const html = renderToStaticMarkup(<CatalogIcon kind="spell" icon={icon} />);
            expect(html).toContain('Иконка отсутствует');
            expect(html).not.toContain('<img');
        }
        expect(renderToStaticMarkup(<CatalogIcon kind="item" icon="asset:12" />)).toContain(
            '/api/assets/12',
        );
    });

    it('keeps origin distinct from automation coverage', () => {
        expect(renderToStaticMarkup(<OriginBadge custom />)).toContain('Моя коллекция');
        expect(renderToStaticMarkup(<OriginBadge custom={false} />)).toContain('Системная');
        for (const coverage of ['FULL', 'PARTIAL', 'MANUAL']) {
            expect(renderToStaticMarkup(<CoverageBadge coverage={coverage} />)).toContain(coverage);
        }
        expect(renderToStaticMarkup(<CoverageBadge coverage="MANUAL" />)).toContain('Решение ГМ');
    });

    it('preserves the declared rules revision and never invents one for private content', () => {
        expect(
            rulesLabel({
                ruleset: 'dnd-2024',
                rules_revision: 'Unverified SRD claim',
                gates: { browse: true, copy: true, execute: false },
            }),
        ).toBe('dnd-2024 · Unverified SRD claim');
        expect(rulesLabel(undefined, 'Legacy source 5.1')).toBe('Legacy source 5.1');
        expect(rulesLabel()).toBe('Версия правил не указана');
    });

    it('distinguishes an empty collection from an empty query and offers filter reset', () => {
        const filtered = renderToStaticMarkup(<CatalogEmpty filtered onReset={() => {}} />);
        expect(filtered).toContain('Ничего не найдено');
        expect(filtered).toContain('Сбросить фильтры');
        const empty = renderToStaticMarkup(<CatalogEmpty filtered={false} onReset={() => {}} />);
        expect(empty).toContain('Коллекция пока пуста');
        expect(empty).not.toContain('Сбросить фильтры');
    });
});
