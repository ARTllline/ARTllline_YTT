import { useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, BookOpen, Package, Search, Sparkles } from 'lucide-react';
import { RpgIcon, rpgIconKeys } from '../gameplay/RpgIcon';
import type { ContentReferenceData } from './ContentReference';
import './catalog.css';

export function focusCatalogSearch(container: Element | null) {
    const search = container?.querySelector<HTMLInputElement>('.catalog-search input');
    search?.focus({ preventScroll: true });
    search?.scrollIntoView({ block: 'start' });
}

export function focusCatalogInspector(inspector: RefObject<HTMLElement | null>) {
    if (!window.matchMedia('(max-width: 1099px)').matches) return;
    requestAnimationFrame(() => {
        inspector.current?.focus({ preventScroll: true });
        inspector.current?.scrollIntoView({ block: 'start' });
    });
}

export function CatalogBack() {
    return (
        <button
            className="catalog-back"
            onClick={(e) => {
                const layout = e.currentTarget.closest('.item-library-layout');
                const selected = layout?.querySelector<HTMLButtonElement>(
                    '.catalog-entry[aria-pressed="true"]',
                );
                if (selected) {
                    selected.focus({ preventScroll: true });
                    selected.scrollIntoView({ block: 'center' });
                } else focusCatalogSearch(layout);
            }}
        >
            <ArrowLeft size={14} /> К каталогу
        </button>
    );
}

export function CatalogIcon({
    icon,
    kind,
    size = 44,
}: {
    icon?: string;
    kind: 'item' | 'spell';
    size?: number;
}) {
    const [failed, setFailed] = useState<string | undefined>();
    const valid =
        icon && (rpgIconKeys.has(icon) || icon === 'book' || /^asset:[1-9][0-9]*$/.test(icon));
    const Fallback = kind === 'item' ? Package : Sparkles;
    return (
        <span
            className={`catalog-icon catalog-icon-${kind}`}
            style={{ width: size, height: size }}
            onErrorCapture={() => setFailed(icon)}
        >
            {valid && failed !== icon ? (
                <RpgIcon icon={icon} size={size} />
            ) : (
                <Fallback size={size * 0.52} aria-label="Иконка отсутствует" />
            )}
        </span>
    );
}

export function OriginBadge({ custom }: { custom: boolean }) {
    return (
        <span className={`catalog-origin ${custom ? 'is-custom' : ''}`}>
            {custom ? 'Моя коллекция' : 'Системная'}
        </span>
    );
}

export function rulesLabel(content?: ContentReferenceData | null, fallback?: string) {
    return (
        [content?.ruleset, content?.rules_revision].filter(Boolean).join(' · ') ||
        fallback ||
        'Версия правил не указана'
    );
}

export function CoverageBadge({ coverage }: { coverage: string }) {
    return (
        <span
            className={`catalog-coverage status-${coverage}`}
            title="Фактическая поддержка механик YTT"
        >
            {coverage === 'FULL'
                ? 'Поддерживается'
                : coverage === 'PARTIAL'
                  ? 'Частично'
                  : 'Решение ГМ'}
        </span>
    );
}

export function CatalogSearch({
    value,
    onChange,
    label,
    placeholder,
}: {
    value: string;
    onChange: (value: string) => void;
    label: string;
    placeholder: string;
}) {
    return (
        <label className="catalog-search">
            <Search size={18} />
            <input
                aria-label={label}
                placeholder={placeholder}
                maxLength={100}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        </label>
    );
}

export function CatalogOrigins({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className="catalog-origins" aria-label="Коллекция">
            {[
                ['', 'Все записи'],
                ['custom', 'Мои'],
                ['system', 'Системные'],
            ].map(([key, label]) => (
                <button key={key} aria-pressed={value === key} onClick={() => onChange(key)}>
                    {label}
                </button>
            ))}
        </div>
    );
}

export function CatalogLoading() {
    return (
        <div role="status" className="catalog-loading">
            <span>Открываем компендиум…</span>
            <div aria-hidden="true">
                {Array.from({ length: 6 }, (_, i) => (
                    <i key={i} />
                ))}
            </div>
        </div>
    );
}

export function CatalogEmpty({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
    return (
        <div className="control-empty catalog-empty">
            <BookOpen size={32} />
            <h3>{filtered ? 'Ничего не найдено' : 'Коллекция пока пуста'}</h3>
            <p>
                {filtered
                    ? 'Попробуйте другое название или уберите фильтры.'
                    : 'Создайте свою запись или выберите доступную системную запись.'}
            </p>
            {filtered && <button onClick={onReset}>Сбросить фильтры</button>}
        </div>
    );
}

export function CatalogCardHeader({
    name,
    icon,
    kind,
    subtitle,
    tone,
    children,
}: {
    name: string;
    icon: string;
    kind: 'item' | 'spell';
    subtitle: string;
    tone?: string;
    children?: ReactNode;
}) {
    return (
        <header className={`catalog-card-header is-${kind} ${tone ?? ''}`}>
            <CatalogIcon icon={icon} kind={kind} size={64} />
            <div className="catalog-card-title">
                <span className="eyebrow">{kind === 'item' ? 'Предмет' : 'Заклинание'}</span>
                <h3>{name}</h3>
                <p>{subtitle}</p>
            </div>
            <div className="catalog-card-toolbar">{children}</div>
        </header>
    );
}
