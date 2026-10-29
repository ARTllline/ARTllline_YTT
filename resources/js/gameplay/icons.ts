import {
    Swords,
    Crosshair as Bow,
    Flame,
    Sparkles,
    Heart,
    Shield,
    Zap,
    Eye,
    FlaskConical,
    Footprints,
    Focus,
} from 'lucide-react';
export const gameplayIcons = {
    sword: Swords,
    bow: Bow,
    flame: Flame,
    spark: Sparkles,
    heart: Heart,
    shield: Shield,
    bolt: Zap,
    eye: Eye,
    potion: FlaskConical,
    footprints: Footprints,
    focus: Focus,
};
export function gameplayIcon(key: string) {
    return gameplayIcons[key as keyof typeof gameplayIcons] ?? Sparkles;
}

export const iconLabels: Record<string, string> = {
    sword: 'Меч',
    bow: 'Лук',
    flame: 'Пламя',
    spark: 'Искра',
    heart: 'Сердце',
    shield: 'Щит',
    bolt: 'Молния',
    eye: 'Глаз',
    potion: 'Зелье',
    footprints: 'Шаг',
    focus: 'Фокус',
};
