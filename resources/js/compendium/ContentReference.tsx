export interface ContentReferenceData {
    facts?: string[];
    catalog_type?: string;
    rarity_text?: string | null;
    range_text?: string | null;
    localized?: { name?: string | null; description?: string | string[] | null } | null;
    ruleset?: string | null;
    rules_revision?: string | null;
    checksum?: string;
    reference?: string;
    attribution?: string;
    execution_profile?: { id: string; checksum: string };
    gates: { browse: boolean; copy: boolean; execute: boolean };
    gm_required?: string[];
}

export function ContentReference({
    content,
    showText = true,
}: {
    content?: ContentReferenceData | null;
    showText?: boolean;
}) {
    if (!content) return null;
    return (
        <div className="compendium-copy-reference">
            {content.localized?.name && <p>{content.localized.name}</p>}
            {content.facts?.map((fact) => (
                <p key={fact}>{fact}</p>
            ))}
            {!content.gates.execute && (
                <p className="hint" role="note">
                    Требует решения GM · справочная копия, автоматические эффекты не одобрены.
                </p>
            )}
            {content.gm_required?.map((note) => (
                <p className="hint" key={note}>
                    {note}
                </p>
            ))}
            <details>
                <summary>
                    Источник и версия правил · {content.ruleset} · {content.rules_revision}
                </summary>
                {showText && <p className="spell-reference">{content.reference}</p>}
                {content.localized?.description && (
                    <p className="spell-reference">
                        {Array.isArray(content.localized.description)
                            ? content.localized.description.join('\n\n')
                            : content.localized.description}
                    </p>
                )}
                <p>{content.attribution}</p>
            </details>
        </div>
    );
}
