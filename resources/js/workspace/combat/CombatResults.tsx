import type { Scene } from '../../tabletop/types/scene';
import type { SessionResult, SessionRoll } from './sessionModel';
export function RollDetail({
    roll,
    breakdown,
}: {
    roll?: SessionRoll | null;
    breakdown?: { label: string; value: number }[];
}) {
    return (
        <div className="roll-provenance">
            {roll && (
                <p>
                    {roll.rawDice?.join(' / ') || 'Авто'}{' '}
                    {roll.modifier !== undefined ? `+ (${roll.modifier})` : ''} ={' '}
                    <b>{roll.total}</b>
                    {roll.dc !== undefined ? ` / Сл ${roll.dc}` : ''} · {roll.rollMode}
                </p>
            )}
            {breakdown?.map((p, i) => (
                <div key={i}>
                    <span>{p.label}</span>
                    <b>
                        {p.value >= 0 ? '+' : ''}
                        {p.value}
                    </b>
                </div>
            ))}
            {roll?.bonusRolls?.map((b, i) => (
                <p key={i}>
                    {b.label}: {b.roll.expression} = {b.roll.total}
                </p>
            ))}
            {roll?.context?.advantage?.map((r, i) => (
                <p key={'a' + i}>Преимущество · {r.label}</p>
            ))}
            {roll?.context?.disadvantage?.map((r, i) => (
                <p key={'d' + i}>Помеха · {r.label}</p>
            ))}
        </div>
    );
}
export function CombatResults({ result, scene }: { result: SessionResult; scene: Scene }) {
    return (
        <>
            <p>
                {result.actorName} · {result.abilityName}
                {result.castLevel ? ` · круг ${result.castLevel}` : ''}
                {result.roll
                    ? ` — ${result.roll.total}${result.roll.dc !== undefined ? ` vs ${result.category === 'attack' ? 'AC' : 'Сл'} ` + result.roll.dc : ''} · ${result.success ? (result.category === 'attack' ? 'попадание' : 'успех') : result.category === 'attack' ? 'промах' : 'провал'}`
                    : ''}
                {result.healing ? ` · Лечение +${result.healing}` : ''}
            </p>
            {!!result.outcomes?.length && (
                <div className="combat-result-scroll">
                    <table className="combat-result-table">
                        <thead>
                            <tr>
                                <th>Цель</th>
                                <th>Спасбросок</th>
                                <th>Урон</th>
                                <th>HP</th>
                            </tr>
                        </thead>
                        <tbody>
                            {result.outcomes.map((o) => (
                                <tr key={o.tokenId}>
                                    <th>
                                        {scene.tokens.find((t) => t.id === o.tokenId)?.name ??
                                            'Удалённая цель'}
                                    </th>
                                    <td>
                                        {o.save
                                            ? `${o.save.total}${o.save.dc !== undefined ? ' / ' + o.save.dc : ''} · ${o.save.success ? '✓' : '✗'}`
                                            : '—'}
                                    </td>
                                    <td>
                                        {o.damage}
                                        {o.damageDetail?.components
                                            ?.map((c) => c.type)
                                            .filter(Boolean)
                                            .join(', ')
                                            ? ' · ' +
                                              o.damageDetail?.components
                                                  ?.map((c) => c.type)
                                                  .join(', ')
                                            : ''}
                                    </td>
                                    <td>
                                        {o.hpBefore !== undefined
                                            ? `${o.hpBefore} → ${o.hpAfter}`
                                            : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <details>
                <summary>Броски и модификаторы</summary>
                <RollDetail roll={result.roll} breakdown={result.provenance?.breakdown} />
                {result.damageRolls?.map((d, i) => (
                    <p key={i}>
                        {d.type} · {d.roll.expression}: {d.roll.rawDice.join(' + ')} ={' '}
                        {d.roll.total}
                    </p>
                ))}
                {result.outcomes?.map((o) => (
                    <div key={o.tokenId}>
                        <strong>{scene.tokens.find((t) => t.id === o.tokenId)?.name}</strong>
                        <RollDetail roll={o.save} breakdown={o.save?.provenance?.breakdown} />
                        {!!o.save?.dcProvenance?.length && (
                            <>
                                <small>Источник Сл</small>
                                <RollDetail breakdown={o.save.dcProvenance} />
                            </>
                        )}
                        {o.damageDetail?.components?.map((d, i) => (
                            <p key={i}>
                                {d.type}: {d.rolled} → {d.amount} ·{' '}
                                {[
                                    d.saveEffect === 'half' ? 'половина при спасброске' : '',
                                    ...(d.adjustments ?? []).map(
                                        (a) =>
                                            (
                                                ({
                                                    resistance: 'сопротивление',
                                                    vulnerability: 'уязвимость',
                                                    immunity: 'иммунитет',
                                                }) as Record<string, string>
                                            )[a] ?? a,
                                    ),
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </p>
                        ))}
                    </div>
                ))}
            </details>
        </>
    );
}
