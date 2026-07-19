# video-shotcraft

[简体中文](README.md) | [English](README_EN.md)

一套用于制作电影感产品视频的自包含能力库：镜头配方卡、动态样片、
Remotion 参考实现、已验收成片模板、可复用组件、声音资产与完整制作流程。

> [在线浏览镜头卡与动态样片](https://vincentwei1021.github.io/video-shotcraft/)
> — 支持搜索、筛选、切换样式和多选复制镜头卡名称。

当前主要面向 Web 与桌面产品宣传片，但镜头卡也可以单独用于功能演示、
品牌短片、发布视频或其他动态设计项目。

## 项目包含什么

| 内容 | 说明 |
| --- | --- |
| 106 张镜头配方卡 | 记录用途、能量、建议时长、参数、实现要点与已知坑 |
| 161 条动态样片 | 可在在线 Gallery 中直接预览、搜索和筛选 |
| Remotion 参考实现 | 每张卡对应经过调校的 TSX demo，包含实际缓动和时序参数 |
| 完整成片模板 | 36.2 秒、1920×1080、30fps、10 镜头的纸墨琥珀风产品宣传片 |
| 组件与素材 | 2.5D 页面相机、字幕、闪切、数字滚动、音效和素材采集脚本 |
| 制作方法论 | 从素材采集、风格定调和分镜，到声音设计、节奏卡点与最终验收 |

## 快速开始

克隆仓库：

```bash
git clone https://github.com/Vincentwei1021/video-shotcraft.git
cd video-shotcraft
```

本地打开 Gallery：

```bash
cd gallery
python3 -m http.server 4178
```

然后访问 `http://localhost:4178`。也可以直接使用
[线上 Gallery](https://vincentwei1021.github.io/video-shotcraft/)。

启动完整成片模板：

```bash
cd template
npm install
npm run dev
```

运行 `npm run render` 可将成片输出到 `template/out/promo.mp4`。
替换模板素材前，请先阅读 [模板解构与复现指南](template/TEMPLATE.md)。

## 作为 Agent Skill 使用

将仓库链接到 Codex skills 目录：

```bash
ln -s "$(pwd)" ~/.codex/skills/video-shotcraft
```

或链接到 Claude Code skills 目录：

```bash
ln -s "$(pwd)" ~/.claude/skills/video-shotcraft
```

之后可以直接提出类似请求：

```text
用 video-shotcraft 给我的桌面产品做一支宣传片。
用 deck-deal-flyin 和 row-embed 两张镜头卡展示这个功能。
参考 spotlight-hero-card，为这个页面设计一个产品特写镜头。
```

如果没有指定镜头卡，skill 会先介绍现有成片模板并询问是否采用；也可以先在
[Gallery](https://vincentwei1021.github.io/video-shotcraft/) 中挑好镜头再开始。

## 项目结构

```text
video-shotcraft/
├── SKILL.md                 # Agent 使用入口与核心制作规则
├── references/
│   ├── pipeline.md          # 完整制作流水线
│   ├── shots/               # 106 张镜头配方卡
│   ├── sequences/           # 可复用的全片结构与桥段模板
│   ├── aesthetic-rules.md   # 视觉验收准则
│   ├── music-beat-sync.md   # BGM 节奏分析与卡点方法
│   └── sound-design.md      # 声音设计方法与判例
├── demos/                   # 镜头卡的 Remotion 参考实现
├── gallery/                 # 在线样片画廊的静态站点
├── template/                # 可直接运行的完整成片模板
└── assets/
    ├── lib/                 # 可复制使用的 Remotion 组件
    ├── scripts/             # 页面素材采集脚本
    └── audio/               # SFX 与授权说明
```

完整工作流和实现要求见 [SKILL.md](SKILL.md)、
[制作流水线](references/pipeline.md) 与
[视觉验收准则](references/aesthetic-rules.md)。

## 音频与素材说明

`assets/audio/` 中的音效可按各自授权条件使用，来源与许可信息见
[ATTRIBUTION.md](assets/audio/ATTRIBUTION.md)。

模板内的产品截图为演示素材。对外发布成片前，请替换为目标产品自己的截图，
并确认其中的数据、客户信息和个人信息是否需要脱敏。
