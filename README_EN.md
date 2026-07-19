# video-shotcraft

[简体中文](README.md) | [English](README_EN.md)

A self-contained toolkit for crafting cinematic product videos with shot recipe cards,
motion previews, tuned Remotion implementations, a production-ready video template,
reusable components, sound assets, and an end-to-end production workflow.

> [Explore the shot gallery and motion previews](https://vincentwei1021.github.io/video-shotcraft/)
> — search, filter, switch between variants, and copy selected shot-card names.

The toolkit primarily targets web and desktop product promos, while individual shot cards
can also be used in feature demos, brand films, launch videos, and other motion projects.

## What's included

| Content | Description |
| --- | --- |
| 106 shot recipe cards | Purpose, energy, suggested duration, parameters, implementation notes, and known pitfalls |
| 161 motion previews | Searchable and filterable in the online Gallery |
| Remotion implementations | Tuned TSX demos containing the actual easing and timing parameters for each card |
| Complete video template | A validated 36.2-second, 1920×1080, 30fps product promo with 10 shots |
| Components and assets | 2.5D page camera, captions, flash cuts, digit rolls, SFX, and capture scripts |
| Production methodology | Capture, visual direction, storyboarding, sound design, beat sync, and final QA |

## Quick start

Clone the repository:

```bash
git clone https://github.com/Vincentwei1021/video-shotcraft.git
cd video-shotcraft
```

Run the Gallery locally:

```bash
cd gallery
python3 -m http.server 4178
```

Then open `http://localhost:4178`, or use the
[hosted Gallery](https://vincentwei1021.github.io/video-shotcraft/).

Start the complete video template:

```bash
cd template
npm install
npm run dev
```

Run `npm run render` to export the video to `template/out/promo.mp4`.
Before replacing its assets, read the [template breakdown and adaptation guide](template/TEMPLATE.md).

## Use as an agent skill

Link the repository into the Codex skills directory:

```bash
ln -s "$(pwd)" ~/.codex/skills/video-shotcraft
```

Or link it into the Claude Code skills directory:

```bash
ln -s "$(pwd)" ~/.claude/skills/video-shotcraft
```

You can then make requests such as:

```text
Use video-shotcraft to create a promo for my desktop product.
Use the deck-deal-flyin and row-embed shot cards to present this feature.
Design a product close-up inspired by spotlight-hero-card.
```

If no shot card is specified, the skill introduces the existing full-video template and asks
whether to use it. You can also select shots in the
[Gallery](https://vincentwei1021.github.io/video-shotcraft/) before starting.

## Repository structure

```text
video-shotcraft/
├── SKILL.md                 # Agent entry point and core production rules
├── references/
│   ├── pipeline.md          # End-to-end production workflow
│   ├── shots/               # 106 shot recipe cards
│   ├── sequences/           # Reusable full-video structures and sequence patterns
│   ├── aesthetic-rules.md   # Visual QA criteria
│   ├── music-beat-sync.md   # BGM analysis and beat-sync methodology
│   └── sound-design.md      # Sound-design guidance and examples
├── demos/                   # Remotion reference implementations for shot cards
├── gallery/                 # Static motion-preview Gallery
├── template/                # Runnable complete video template
└── assets/
    ├── lib/                 # Reusable Remotion components
    ├── scripts/             # Page-asset capture scripts
    └── audio/               # SFX and attribution details
```

For the complete workflow and implementation requirements, see [SKILL.md](SKILL.md),
the [production pipeline](references/pipeline.md), and the
[visual QA criteria](references/aesthetic-rules.md).

## Audio and asset notes

Audio files under `assets/audio/` may be used according to their respective license terms.
See [ATTRIBUTION.md](assets/audio/ATTRIBUTION.md) for sources and license details.

Product screenshots bundled with the template are demonstration assets. Replace them with
screenshots from the target product before publishing, and verify whether any product,
customer, or personal data needs to be anonymized.
