import type { ObjectSelection, Point, Scene, SceneProp, Token } from '../types/scene';

export function propFootprint(p: SceneProp): Point[] {
    const w = p.image.width * p.scaleX,
        h = p.image.height * p.scaleY;
    const left = -w * (p.pivotX ?? 0.5),
        top = -h * (p.pivotY ?? 0.5);
    const r = (p.rotation * Math.PI) / 180,
        c = Math.cos(r),
        s = Math.sin(r);
    return [
        [left, top],
        [left + w, top],
        [left + w, top + h],
        [left, top + h],
    ].map(([x, y]) => ({ x: p.x + x * c - y * s, y: p.y + x * s + y * c }));
}
export function selectionMembers(scene: Scene, selection: ObjectSelection) {
    return [
        ...scene.tokens.filter((t) => selection.tokenIds.includes(t.id)),
        ...(scene.props ?? []).filter((p) => selection.propIds.includes(p.id)),
    ];
}
export function translationIssue(members: readonly (Token | SceneProp)[], dx = 0, dy = 0): string {
    if (members.length > 200) return 'За один раз можно переместить до 200 объектов.';
    if (members.some((o) => o.isLocked)) return 'Сначала разблокируйте все выбранные объекты.';
    if (
        members.some(
            (o) =>
                !Number.isFinite(o.x + dx) ||
                !Number.isFinite(o.y + dy) ||
                Math.abs(o.x + dx) > 1000000 ||
                Math.abs(o.y + dy) > 1000000,
        )
    )
        return 'Группа выходит за допустимые границы координат.';
    return '';
}
export function duplicateIssue(members: readonly (Token | SceneProp)[]): string {
    return (
        translationIssue(members) ||
        (members.some((o) => 'size' in o && (o.kind === 'player_character' || o.ownerUserId))
            ? 'Player Characters нельзя дублировать. Уберите их из выделения.'
            : '')
    );
}
export function selectionBounds(
    members: readonly (Token | SceneProp)[],
    delta: Point = { x: 0, y: 0 },
) {
    const points = members.flatMap((o) =>
        'size' in o
            ? [
                  { x: o.x - (o.size * o.scale) / 2, y: o.y - (o.size * o.scale) / 2 },
                  { x: o.x + (o.size * o.scale) / 2, y: o.y + (o.size * o.scale) / 2 },
              ]
            : propFootprint(o),
    );
    return {
        x: Math.min(...points.map((p) => p.x)) + delta.x,
        y: Math.min(...points.map((p) => p.y)) + delta.y,
        width: Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
        height: Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
    };
}
