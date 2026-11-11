import { Box, CircleUserRound, Hand, PackageOpen, Skull, X } from 'lucide-react';
import {
    EntityPicker,
    initialCatalogQuery,
    type CatalogQuery,
    type EntityKind,
} from './EntityPicker';
import type { Placement } from './model';
import { CompositionCatalog } from './CompositionCatalog';
import type { LiveEcho } from '../../realtime/useCampaignLive';
import '../../../css/preparation-catalog.css';

const categories = [
    ['characters', 'Characters', CircleUserRound],
    ['npcs', 'NPCs', Skull],
    ['prop', 'Props', Box],
    ['container', 'Containers', PackageOpen],
    ['interaction', 'Interactions', Hand],
    ['compositions', 'Пресеты', PackageOpen],
] as const;
export type PreparationCatalogState = { kind: EntityKind | 'compositions'; query: CatalogQuery };
export const initialPreparationCatalog: PreparationCatalogState = {
    kind: 'npcs',
    query: initialCatalogQuery,
};

export function PreparationCatalog({
    campaignId,
    placedCharacterIds,
    state,
    selectedPlacement,
    onState,
    onPlace,
    onClose,
    onDragStart,
    onDragEnd,
    echo,
    userId,
}: {
    campaignId: string;
    placedCharacterIds: string[];
    state: PreparationCatalogState;
    selectedPlacement?: Placement | null;
    onState: (state: PreparationCatalogState) => void;
    onPlace: (item: Placement) => void;
    onClose: () => void;
    onDragStart: (item: Placement) => void;
    onDragEnd: () => void;
    echo?: LiveEcho | null;
    userId?: string;
}) {
    return (
        <section className="runtime-add preparation-catalog" aria-label="Содержимое сцены">
            <header>
                <div>
                    <small>ПОДГОТОВКА СЦЕНЫ</small>
                    <strong>Добавить на карту</strong>
                </div>
                <button className="icon-button" aria-label="Закрыть каталог" onClick={onClose}>
                    <X size={16} />
                </button>
            </header>
            <nav className="entity-categories" aria-label="Категории содержимого">
                {categories.map(([kind, label, Icon]) => (
                    <button
                        key={kind}
                        aria-pressed={state.kind === kind}
                        onClick={() => {
                            onDragEnd();
                            onState({ kind, query: initialCatalogQuery });
                        }}
                    >
                        <Icon size={16} />
                        <span>{label}</span>
                    </button>
                ))}
            </nav>
            {state.kind === 'compositions' ? (
                <CompositionCatalog
                    echo={echo}
                    userId={userId}
                    query={state.query}
                    onQuery={(query) => {
                        onDragEnd();
                        onState({ ...state, query });
                    }}
                    selectedPlacement={selectedPlacement}
                    onPlace={onPlace}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                />
            ) : (
                <EntityPicker
                    key={state.kind}
                    kind={state.kind}
                    campaignId={campaignId}
                    placedCharacterIds={placedCharacterIds}
                    query={state.query}
                    onQuery={(query) => {
                        onDragEnd();
                        onState({ ...state, query });
                    }}
                    selectedPlacement={selectedPlacement}
                    onPlace={onPlace}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                />
            )}
        </section>
    );
}
