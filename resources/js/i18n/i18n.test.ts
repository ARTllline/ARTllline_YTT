import { expect, it } from 'vitest';
import { conditionLabel, errorMessage, t, translate } from './index';

it('defaults to Russian and falls back to Russian for future locales', () => {
    expect(t('Scenes')).toBe('Сцены');
    expect(translate('Scenes', {}, 'uk')).toBe('Сцены');
    expect(t('unit.ft')).toBe('фт');
    expect(t('activeScene', { name: 'The Red Moon' })).toBe('Активна: The Red Moon');
});
it('localizes preset labels without changing stable keys or custom content', () => {
    const preset = { key: 'poisoned', label: 'Poisoned' };
    expect(conditionLabel(preset)).toBe('Отравлен');
    expect(preset.key).toBe('poisoned');
    expect(conditionLabel({ key: null, label: 'Moon curse / Проклятие' })).toBe(
        'Moon curse / Проклятие',
    );
});
it('keeps known errors actionable and provides Russian fallbacks', () => {
    expect(errorMessage('Choose a campaign member.', 422)).toBe('Выберите участника кампании.');
    expect(errorMessage('Internal framework exception', 403)).toBe(
        t('You do not have permission to do that.'),
    );
    expect(errorMessage('Материал используется в сцене.', 409)).toBe(
        'Материал используется в сцене.',
    );
});
