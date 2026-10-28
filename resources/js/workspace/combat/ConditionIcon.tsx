import {
    EyeOff,
    Heart,
    EarOff,
    Ghost,
    Link,
    Pause,
    Shield,
    Skull,
    Droplet,
    ArrowDown,
    Lock,
    Zap,
    Moon,
    Focus,
    Diamond,
} from 'lucide-react';
export const conditionKeys = [
    'blinded',
    'charmed',
    'deafened',
    'frightened',
    'grappled',
    'incapacitated',
    'invisible',
    'paralyzed',
    'petrified',
    'poisoned',
    'prone',
    'restrained',
    'stunned',
    'unconscious',
    'concentrating',
];
export function ConditionIcon({ name }: { name: string | null }) {
    const Icon =
        (
            {
                blinded: EyeOff,
                charmed: Heart,
                deafened: EarOff,
                frightened: Ghost,
                grappled: Link,
                incapacitated: Pause,
                invisible: EyeOff,
                paralyzed: Lock,
                petrified: Shield,
                poisoned: Droplet,
                prone: ArrowDown,
                restrained: Link,
                stunned: Zap,
                unconscious: Moon,
                concentrating: Focus,
            } as Record<string, typeof Skull>
        )[name ?? ''] ?? Diamond;
    return <Icon size={13} aria-hidden="true" />;
}
