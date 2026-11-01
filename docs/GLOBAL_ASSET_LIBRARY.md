# Global Asset Library

`/control/assets` is the GM Hub library. It reuses the existing `assets` table,
private campaigns disk, image validation, audio probe and authenticated delivery.
There is no second portrait/icon store. Existing uploads retain their IDs and paths;
the migration assigns library ownership to their uploader. A campaign is an optional
origin, and deleting that campaign leaves its reusable asset intact.

The library supports portraits, tokens, maps, props, handouts, UI/game art and audio
(music, ambient, SFX), multi-file upload and external file drop, preview, paginated
name/tag search, tags, duplicate and file replacement. Image limits remain 16 MB,
8192 px per side and 32 MP; audio uses the existing 64 MB/probe validation.
Duplicate creates an independent ID and file. Replacement retains the ID, name,
tags and references; open editors/session clients load the replacement after reload.

Character/NPC portrait pickers and Item/Spell illustration pickers open this same
library over the current editor. Picking changes the editor draft; its ordinary
Save persists the assignment. Upload persists immediately in the library.
Bundled icon choices remain available as defaults. Custom item/spell illustrations
use `asset:<id>` in the existing icon field and survive independent runtime copies.
NPC placement retains the original portrait asset ID rather than copying its file.
Campaign asset browsers and placement actions reuse global resources too.

The personal library requires sign-in. Origin-campaign GM collaboration remains
available. Players receive file access through current visible scene use, owned
Character portraits/abilities/inventory, explicit handout reveals, live audio or
existing preload grants. Listing and editing the GM library never grants player
access to its other files. Usage labels from another GM's private context are
redacted. Deletion checks all references, including Character/NPC portraits,
scene maps/tokens/props, templates, handouts, global Item/Spell definitions,
runtime items/abilities, audio playback/grants and cues; used assets return 409.

Validation: `GlobalAssetLibraryTest`, affected Character/Item/Spell/NPC, preparation,
media, Cue and preload suites. Native browser QA reuses campaign/scene 5 and the
permanent accounts: drop upload → four editor assignments → reload → session,
usage/delete protection and narrow layout. Temporary records/files were removed
and the existing Character was restored. Local evidence: `artifacts/asset-library/`.
