import { request } from '../../api/client';
import { commandId } from '../../api/workspace';

export const actionLabels = {
    'music.start': 'Запустить музыку',
    'music.stop': 'Остановить музыку',
    'ambient.start': 'Запустить атмосферу',
    'ambient.stop': 'Остановить атмосферу',
    'sfx.play': 'Воспроизвести звук',
    'atmosphere.start': 'Включить атмосферный эффект',
    'atmosphere.stop': 'Выключить атмосферный эффект',
    'screen.flash': 'Цветовая вспышка',
    'screen.vignette': 'Пульс виньетки',
    'objects.reveal': 'Показать объекты',
    'objects.hide': 'Скрыть объекты',
    'object.move': 'Переместить объект',
    'prefab.spawn': 'Создать заготовку',
    'encounter.spawn': 'Создать столкновение',
    'combat.add': 'Добавить в бой',
    'combat.begin': 'Начать бой',
    'combat.end': 'Завершить бой',
    'combat.next': 'Следующий ход',
    'handout.show': 'Показать материал',
    message: 'Сообщение игрокам',
    wait: 'Ожидание',
    'camera.focus': 'Навести камеру',
    'camera.pan': 'Переместить камеру',
    'camera.zoom': 'Масштаб камеры',
    'camera.shake': 'Встряска камеры',
    'camera.fade': 'Затемнение / изображение',
    'camera.release': 'Вернуть управление',
} as const;
export type ActionType = keyof typeof actionLabels;
export interface CueConfig {
    assetId?: string;
    volume?: number;
    fade?: number;
    loop?: boolean;
    effect?: string;
    intensity?: string;
    color?: string;
    tokenIds?: string[];
    propIds?: string[];
    kind?: 'token' | 'prop' | 'point';
    id?: string;
    x?: number;
    y?: number;
    templateId?: string;
    handoutId?: string;
    addToCombat?: boolean;
    startCombat?: boolean;
    title?: string;
    text?: string;
    duration?: number;
    zoom?: number;
    strength?: string;
    blackout?: boolean;
}
export interface CueStep {
    type: ActionType;
    config: CueConfig;
}
export interface Cue {
    id?: number;
    name: string;
    description: string | null;
    sort_order: number;
    steps: CueStep[];
}
export interface CueRun {
    id: string;
    cue_id: number | null;
    name: string;
    position: number;
    displayPosition?: number;
    status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
    error: string | null;
    steps: CueStep[];
    due_at: string | null;
    updated_at: string;
}
export const statusLabels = {
    queued: 'В очереди',
    running: 'Выполняется',
    completed: 'Завершено',
    cancelled: 'Остановлено',
    failed: 'Ошибка',
};
export const cues = {
    list: (scene: string, signal?: AbortSignal) =>
        request<{ cues: Cue[]; runs: CueRun[]; pendingCount: number }>(
            `/scenes/${scene}/cues`,
            'GET',
            undefined,
            signal,
        ),
    runs: (scene: string, signal?: AbortSignal) =>
        request<{ cues?: Cue[]; runs: CueRun[]; pendingCount: number }>(
            `/scenes/${scene}/cues?runsOnly=1`,
            'GET',
            undefined,
            signal,
        ),
    command: (scene: string, action: string, data: object) =>
        request(`/scenes/${scene}/cues/${action}`, 'POST', {
            ...data,
            clientMutationId: commandId(),
        }),
};
export function newStep(type: ActionType): CueStep {
    const config: CueConfig = {};
    if (['music.start', 'ambient.start', 'sfx.play'].includes(type))
        Object.assign(config, {
            volume: 0.8,
            ...(type !== 'sfx.play' ? { fade: 1000, loop: true } : {}),
        });
    if (['music.stop', 'ambient.stop'].includes(type)) config.fade = 1000;
    if (type.startsWith('atmosphere.'))
        Object.assign(config, {
            effect: 'rain',
            ...(type === 'atmosphere.start' ? { intensity: 'medium' } : {}),
        });
    if (type.startsWith('screen.')) Object.assign(config, { color: '#c9d8e5', duration: 600 });
    if (type.startsWith('objects.') || type === 'combat.add') config.tokenIds = [];
    if (type.startsWith('objects.')) config.propIds = [];
    if (['object.move', 'camera.focus'].includes(type))
        Object.assign(config, { kind: 'point', x: 0, y: 0 });
    if (type === 'object.move') config.kind = 'token';
    if (['camera.pan', 'prefab.spawn', 'encounter.spawn'].includes(type))
        Object.assign(config, { x: 0, y: 0 });
    if (
        [
            'wait',
            'message',
            'camera.focus',
            'camera.pan',
            'camera.zoom',
            'camera.shake',
            'camera.fade',
        ].includes(type)
    )
        config.duration = type === 'message' ? 3000 : 500;
    if (type === 'camera.zoom') config.zoom = 1.5;
    if (type === 'camera.shake') config.strength = 'medium';
    if (type === 'camera.fade') config.blackout = true;
    if (type === 'message') Object.assign(config, { title: '', text: '' });
    return { type, config };
}
export function reorder<T>(items: T[], from: number, to: number): T[] {
    const result = [...items];
    const [item] = result.splice(from, 1);
    result.splice(to, 0, item);
    return result;
}
