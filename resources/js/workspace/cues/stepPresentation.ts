import { effectNames, intensityNames } from '../../media/model';
import type { CueStep } from './model';
export function stepSubtitle({ type, config }: CueStep) {
    if (config.title || config.text) return config.title || config.text;
    if (config.tokenIds?.length || config.propIds?.length)
        return `${(config.tokenIds?.length ?? 0) + (config.propIds?.length ?? 0)} объектов`;
    if (type.startsWith('camera.')) return 'Взгляд игроков';
    if (type.startsWith('atmosphere.'))
        return `${effectNames[config.effect as keyof typeof effectNames] ?? 'Атмосфера'} · ${intensityNames[config.intensity as keyof typeof intensityNames] ?? 'Настроенный эффект'}`;
    if (type === 'wait') return 'Пауза перед следующим действием';
    if (/^(music|ambient|sfx)\./.test(type)) return 'Звуковая сцена';
    return 'Подготовленное действие';
}
