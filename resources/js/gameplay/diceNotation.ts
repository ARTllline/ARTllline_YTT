/** Only validated authoritative faces can enter the presentation engine. */
export function diceNotation(dice: readonly number[], sides = 20) {
    if (
        ![4, 6, 8, 10, 12, 20].includes(sides) ||
        !dice.length ||
        dice.length > 20 ||
        dice.some((value) => !Number.isInteger(value) || value < 1 || value > sides)
    )
        throw new Error('Invalid authoritative dice');
    return `${dice.length}d${sides}@${dice.join(',')}`;
}
