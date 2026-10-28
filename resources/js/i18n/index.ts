import { ru } from './ru';
export type TranslationKey = keyof typeof ru;
export const locale = 'ru';
const catalogs: Record<string, Partial<Record<TranslationKey, string>>> = { ru };
/** Missing locale/key falls back to Russian; user content never passes through this helper. */
export function translate(
    key: TranslationKey,
    values: Record<string, string | number> = {},
    language = locale,
): string {
    const text = catalogs[language]?.[key] ?? ru[key] ?? String(key);
    return text.replace(/\{(\w+)\}/g, (match, name) =>
        values[name] === undefined ? match : String(values[name]),
    );
}
export const t = translate;
export function conditionLabel(condition: { key: string | null; label: string }): string {
    const key = `condition.${condition.key}`;
    return key in ru ? t(key as TranslationKey) : condition.label;
}
export function errorMessage(message: string | undefined, status = 0): string {
    if (message && /[А-Яа-яЁё]/.test(message)) return message;
    if (message && message in ru) return t(message as TranslationKey);
    const key =
        status === 401
            ? 'Please sign in again.'
            : status === 403
              ? 'You do not have permission to do that.'
              : status === 404
                ? 'requestMissing'
                : status === 409
                  ? 'requestConflict'
                  : status === 422
                    ? 'requestInvalid'
                    : status === 429
                      ? 'requestThrottled'
                      : 'The request could not be completed.';
    return t(key);
}
