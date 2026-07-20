# video-shotcraft 🎬

<div align="center">

[![GitHub stars](https://img.shields.io/github/stars/Vincentwei1021/video-shotcraft)](https://github.com/Vincentwei1021/video-shotcraft/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/Vincentwei1021/video-shotcraft)](https://github.com/Vincentwei1021/video-shotcraft/network/members)
[![Gallery](https://img.shields.io/badge/Gallery-live%20previews-d3923c)](https://vincentwei1021.github.io/video-shotcraft/)

**An agent skill for crafting cinematic product videos: 106 shot recipe cards · 162 styles · 161 motion previews · a production-ready template**

[English](README.md) | [中文](README_CN.md)

</div>

## 🎬 Showcase

The 38-second Gallery intro below was itself produced with this skill —
storyboard, shot implementation, and sound design were all done by an agent
following the toolkit's methodology:

https://github.com/user-attachments/assets/cba2df8a-4b2e-4247-bace-d0b1dea9c2bd

▶️ [Watch in HD on YouTube](https://youtu.be/gcVvRM_P3SM)

> Browse every shot card and motion preview online: **[Gallery](https://vincentwei1021.github.io/video-shotcraft/)**
> — search, filter, switch between variants, and copy selected shot-card names.

## 🚀 Quick start

**The most direct way: hand the repo link to your agent.**
In Claude Code / Codex or a similar agent, just say:

```text
Install this skill for me: https://github.com/Vincentwei1021/video-shotcraft
```

The agent will clone the repo and link it into your skills directory. Manual install:

```bash
git clone https://github.com/Vincentwei1021/video-shotcraft.git
cd video-shotcraft
ln -s "$(pwd)" ~/.claude/skills/video-shotcraft   # Claude Code
# or
ln -s "$(pwd)" ~/.codex/skills/video-shotcraft    # Codex
```

Then make requests like:

```text
Use video-shotcraft to create a promo for my desktop product.
Use the deck-deal-flyin and row-embed shot cards to present this feature.
Design a product close-up inspired by spotlight-hero-card.
```

If no shot card is specified, the skill introduces the built-in video template
first and asks whether to use it; you can also pick shots in the
[Gallery](https://vincentwei1021.github.io/video-shotcraft/) before starting.

## 📼 Video template: Ink Press

The skill ships with **Ink Press** — a validated, complete promo template:
36.2 seconds, 1920×1080, 30fps, 10 shots in a paper-ink-amber style, with 2.5D
real-page camera moves, title cards, transitions, and a fully pinned cinematic
SFX pass:

https://github.com/user-attachments/assets/4cf5af51-98f3-4af2-8ab2-7267f470513d

▶️ [Watch in HD on YouTube](https://youtu.be/iShab28B_ak)

To use it, just tell your agent:

```text
Use video-shotcraft to make a promo for my product with the Ink Press template.
```

The agent swaps in your product's screenshots, copy, and branding to reproduce
the same quality — the fastest, most reliable path to a finished film.

> More templates are on the way.

## 📦 What's included

| Content | Description |
| --- | --- |
| 106 shot recipe cards | Purpose, energy, suggested duration, parameters, implementation notes, and known pitfalls |
| 161 motion previews | Covering 162 styles; searchable and filterable in the online Gallery |
| Remotion implementations | Tuned TSX demos containing the actual easing and timing parameters for each card |
| Complete video template | A validated 36.2-second, 1920×1080, 30fps product promo with 10 shots |
| Components and assets | 2.5D page camera, captions, flash cuts, digit rolls, SFX, and capture scripts |
| Production methodology | Capture, visual direction, storyboarding, sound design, beat sync, and final QA |

The toolkit primarily targets web and desktop product promos, while individual
shot cards can also be used in feature demos, brand films, launch videos, and
other motion projects.

## 🗂 Repository structure

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

## 🔊 Audio and asset notes

Audio files under `assets/audio/` may be used according to their respective license terms.
See [ATTRIBUTION.md](assets/audio/ATTRIBUTION.md) for sources and license details.

Product screenshots bundled with the template are demonstration assets. Replace them with
screenshots from the target product before publishing, and verify whether any product,
customer, or personal data needs to be anonymized.
