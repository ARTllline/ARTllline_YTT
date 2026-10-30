import { useEffect, useRef, useState } from 'react';
import {
    ArrowLeft,
    Box,
    BookOpen,
    CircleUserRound,
    Hexagon,
    Package,
    Plus,
    Skull,
    StickyNote,
    Swords,
    X,
} from 'lucide-react';
import { AssetLibrary } from '../assets/LazyAssets';
import { TemplateLibrary } from '../objects/TemplateLibrary';
import { presets, tokenDraft, type Placement, type TokenDraft } from './model';
import { CharacterBrowser } from './CharacterBrowser';
import { CompendiumBrowser } from '../../compendium/CompendiumBrowser';

const categories = [
    ['compendium', 'Компендий', BookOpen],
    ['characters', 'Персонажи', CircleUserRound],
    ['creatures', 'Существа', Skull],
    ['props', 'Объекты', Box],
    ['prefab', 'Заготовки', Package],
    ['encounter', 'Столкновения', Swords],
    ['note', 'Заметка', StickyNote],
    ['region', 'Область', Hexagon],
] as const;
type Category = (typeof categories)[number][0];
export function CreationHub({
    campaignId,
    refresh,
    onPlace,
    onClose,
}: {
    campaignId: string;
    refresh: number;
    onPlace: (item: Placement) => void;
    onClose: () => void;
}) {
    const [category, setCategory] = useState<Category>('characters');
    const [draft, setDraft] = useState<TokenDraft | null>(null);
    const root = useRef<HTMLElement>(null);
    useEffect(() => {
        root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }, []);
    const token = category === 'characters' || category === 'creatures';
    return (
        <section
            ref={root}
            className="creation-hub"
            aria-label="Добавить на сцену"
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    onClose();
                }
            }}
        >
            <header className="creation-heading">
                <div>
                    <span className="eyebrow">НАПОЛНИТЕ СВОЙ МИР</span>
                    <h2>Добавить на сцену</h2>
                </div>
                <button className="icon-button" aria-label="Закрыть добавление" onClick={onClose}>
                    <X size={18} />
                </button>
            </header>
            {draft ? (
                <form
                    className="quick-token"
                    onSubmit={(e) => {
                        e.preventDefault();
                        onPlace({
                            type: 'token',
                            name: draft.name.trim(),
                            draft: { ...draft, name: draft.name.trim() },
                        });
                    }}
                >
                    <button type="button" className="text-button" onClick={() => setDraft(null)}>
                        <ArrowLeft size={14} /> К портретам
                    </button>
                    <div className={`quick-identity disposition-${draft.disposition}`}>
                        <button
                            type="button"
                            className="quick-portrait"
                            title="Выбрать другой портрет"
                            onClick={() => setDraft(null)}
                        >
                            {draft.asset ? (
                                <img src={draft.asset.thumbnailUrl} alt="Портрет токена" />
                            ) : (
                                <CircleUserRound size={42} />
                            )}
                        </button>
                        <div>
                            <span className="eyebrow">БЫСТРЫЙ ТОКЕН</span>
                            <h3>{draft.name || 'Новый персонаж'}</h3>
                            <small>
                                {draft.kind === 'player_character' ? 'Персонаж игрока' : 'NPC'} ·{' '}
                                {draft.disposition === 'hostile'
                                    ? 'Враждебный'
                                    : draft.disposition === 'friendly'
                                      ? 'Дружественный'
                                      : 'Нейтральный'}
                            </small>
                        </div>
                    </div>
                    <label className="field">
                        <span>Имя</span>
                        <input
                            autoFocus
                            required
                            maxLength={80}
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        />
                    </label>
                    <div className="token-presets" aria-label="Пресет токена">
                        {Object.entries(presets).map(([key, preset]) => (
                            <button
                                type="button"
                                key={key}
                                className={`disposition-${preset.disposition}`}
                                aria-pressed={
                                    draft.kind === preset.kind &&
                                    draft.disposition === preset.disposition
                                }
                                onClick={() =>
                                    setDraft({
                                        ...draft,
                                        kind: preset.kind,
                                        disposition: preset.disposition,
                                    })
                                }
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>
                    <label className="field">
                        <span>HP · полное здоровье</span>
                        <input
                            aria-label="HP нового токена"
                            type="number"
                            min={1}
                            max={9999}
                            required
                            value={draft.hp}
                            onChange={(e) => setDraft({ ...draft, hp: Number(e.target.value) })}
                        />
                    </label>
                    <details className="creation-advanced">
                        <summary>Дополнительные настройки</summary>
                        <p>
                            Размер, поворот, владелец и видимость доступны в Inspector после
                            размещения.
                        </p>
                    </details>
                    <button className="primary-button" disabled={!draft.name.trim()}>
                        <Plus size={16} /> Разместить токен
                    </button>
                    <p className="hint">Выберите место на карте. Esc — отменить.</p>
                </form>
            ) : (
                <>
                    <nav className="creation-categories" aria-label="Категории добавления">
                        {categories.map(([key, label, Icon]) => (
                            <button
                                key={key}
                                aria-pressed={category === key}
                                onClick={() => {
                                    if (key === 'note' || key === 'region')
                                        onPlace({ type: key, name: label });
                                    else setCategory(key);
                                }}
                            >
                                <Icon size={20} strokeWidth={1.5} />
                                <span>{label}</span>
                            </button>
                        ))}
                    </nav>
                    <div className="creation-content">
                        {category === 'compendium' ? (
                            <CompendiumBrowser campaignId={campaignId} />
                        ) : (
                            <>
                                {category === 'characters' && (
                                    <CharacterBrowser campaignId={campaignId} onPlace={onPlace} />
                                )}
                                <div className="creation-section-title">
                                    <h3>{categories.find((c) => c[0] === category)?.[1]}</h3>
                                    {token && (
                                        <button
                                            className="text-button"
                                            onClick={() =>
                                                setDraft(
                                                    tokenDraft(
                                                        undefined,
                                                        category === 'characters',
                                                    ),
                                                )
                                            }
                                        >
                                            <Plus size={14} /> Без портрета
                                        </button>
                                    )}
                                </div>
                                <p className="hint">
                                    {category === 'characters'
                                        ? 'Или создайте нового героя из портрета. Он сохранится в кампании.'
                                        : token
                                          ? 'Выберите портрет для быстрого токена или перетащите его на карту.'
                                          : category === 'props'
                                            ? 'Выберите объект. Ставьте копии кликами, пока не нажмёте Esc.'
                                            : 'Выберите группу и укажите её место на карте.'}
                                </p>
                                {(token || category === 'props') && (
                                    <AssetLibrary
                                        key={category}
                                        campaignId={campaignId}
                                        pickerKind={token ? 'token' : 'prop'}
                                        creationKind={
                                            token
                                                ? category === 'characters'
                                                    ? 'hero'
                                                    : 'enemy'
                                                : 'prop'
                                        }
                                        onUse={(asset) =>
                                            token
                                                ? setDraft(
                                                      tokenDraft(asset, category === 'characters'),
                                                  )
                                                : onPlace({ type: 'prop', asset, name: asset.name })
                                        }
                                    />
                                )}
                                {(category === 'prefab' || category === 'encounter') && (
                                    <TemplateLibrary
                                        key={category}
                                        campaignId={campaignId}
                                        kind={category}
                                        refresh={refresh}
                                        placement
                                        onUse={(template) =>
                                            onPlace({
                                                type: 'template',
                                                template,
                                                name: template.name,
                                            })
                                        }
                                    />
                                )}
                            </>
                        )}
                    </div>
                </>
            )}
        </section>
    );
}
