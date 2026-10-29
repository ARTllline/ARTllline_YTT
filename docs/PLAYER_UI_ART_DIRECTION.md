# Player UI art direction

## Reference and anatomy

BG3 `hotbar.png` supplies the visual hierarchy: portrait at the left, actions at
the center, small resources above the action rail, thin warm edges against the
world. `Ability_Scores.jpg` supplies quiet charcoal surfaces, ivory hierarchy and
restrained brass separators. `Damage_dice_reference_image.png` supplies physical
polyhedra and clear modifier ordering. The supplied BG3 folder has no targeting,
radial or full check screenshots; those treatments adapt the same material language.
No BG3 images ship with YTT.

- One bottom composition: circular portrait, identity/HP, resource rail and twelve
  persistent square action slots. One shared chassis, no stacked cards.
- Multiple heroes: portrait opens a compact portrait roster; one hero has no
  switch affordance. Character details have their own labelled button.
- Hotbar: painted icons dominate; small key labels, lower-right costs, inset empty
  slots, amber targeting edge, clear disabled and lifted states. Browser attaches
  to this chassis with category tabs and draggable icon actions.
- Resources: named icons, pips for small pools, segmented medium pools, compact
  counters for large pools. HP alone gets a restrained burgundy track.
- Targeting: compact icon/distance cursor, bronze normal range, amber long range,
  muted red rejection, ivory affected rings and distinct friendly warnings.
- Radial: dark circular plate, bounded contextual actions, painted gameplay icons,
  warm selected sectors and a quiet identity center; retain keyboard navigation.
- Checks: quieter world/HUD, check title and DC, physical 3D dice, then modifiers,
  total and outcome. Both advantage dice remain visible. Natural 1/20 get restrained
  accents. Reduced motion/WebGL failure use explicit static server values.

## Materials, type and local production assets

Warm black #151310, smoked brown #28231d, aged brass #8e7145, ivory #eee1c6,
amber #d4ae67, burgundy #853d3c and desaturated sage for healing/validity.
Depth comes from inset shadows and narrow highlights, without luminous outlines.
Readable existing UI sans for controls; Georgia only for names/check headings.
Motion is short press/settle feedback, with reduced-motion support.

Copy selected PNGs from Fantasy RPG Icons Pack (Swordsman, Archer, Pyromancer,
Priest, Buff, illusionist, Liquid and Monk categories) into `public/assets/player`.
Use one fantasy-ui-borders divider for important panels. Inspect simple_icons as
the generic fallback; existing Lucide controls already serve utility functions.
Runtime never reads the external reference folder.

## Dice evaluation

`@3d-dice/dice-box-threejs` 0.0.12 supports predetermined notation
(`2d20@17,6`), Three.js meshes and Cannon physics. Use a lazy-loaded adapter,
local/no-texture materials, no sound downloads, owned resize/lifecycle cleanup,
and a bounded visual timeout. Server dice are the only result source; visual
completion may advance presentation but must never execute another command.
See https://github.com/3d-dice/dice-box-threejs for the upstream contract (MIT).

Upstream pre-simulation can drift during physical replay, and d4 may retain an old
sample. The adapter samples the actual final orientation, remaps physical face
labels to the supplied values before the next paint, and verifies the resulting
faces. It never changes the authoritative roll, total, resource spend or damage.
The adapter owns resize handling and disposes meshes/materials/WebGL on unmount.
The library is a separate ~145 KB gzip chunk; the twelve 128px gameplay icons total
~507 KiB. Utility book/search SVGs come from simple_icons.
