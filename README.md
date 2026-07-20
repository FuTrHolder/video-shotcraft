# video-shotcraft 🎬

<div align="center">

[![GitHub stars](https://img.shields.io/github/stars/Vincentwei1021/video-shotcraft)](https://github.com/Vincentwei1021/video-shotcraft/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/Vincentwei1021/video-shotcraft)](https://github.com/Vincentwei1021/video-shotcraft/network/members)
[![Gallery](https://img.shields.io/badge/Gallery-在线样片-d3923c)](https://vincentwei1021.github.io/video-shotcraft/)

**让 agent 帮你制作电影感产品视频的 skill：106 张镜头配方卡 · 162 个样式 · 161 条动态样片 · 已验收成片模板**

[中文](README.md) | [English](README_EN.md)

</div>

## 🎬 效果预览

下面这支 38 秒的 Gallery 介绍片，本身就是用这个 skill 制作的——
从分镜、镜头实现到声音设计，全部由 agent 按库内方法论完成：

https://github.com/Vincentwei1021/video-shotcraft/raw/main/docs/media/skill-demo.mp4

> 在线浏览全部镜头卡与动态样片：**[Gallery](https://vincentwei1021.github.io/video-shotcraft/)**
> —— 支持搜索、筛选、切换样式和多选复制镜头卡名称。

## 🚀 快速开始

**最直接的方式：把仓库链接丢给你的 agent。**
在 Claude Code / Codex 等 agent 里说：

```text
帮我安装这个 skill：https://github.com/Vincentwei1021/video-shotcraft
```

agent 会克隆仓库并链接到 skills 目录。也可以手动安装：

```bash
git clone https://github.com/Vincentwei1021/video-shotcraft.git
cd video-shotcraft
ln -s "$(pwd)" ~/.claude/skills/video-shotcraft   # Claude Code
# 或
ln -s "$(pwd)" ~/.codex/skills/video-shotcraft    # Codex
```

装好后直接提需求：

```text
用 video-shotcraft 给我的桌面产品做一支宣传片。
用 deck-deal-flyin 和 row-embed 两张镜头卡展示这个功能。
参考 spotlight-hero-card，为这个页面设计一个产品特写镜头。
```

如果没有指定镜头卡，skill 会先介绍现成成片模板并询问是否采用；
也可以先在 [Gallery](https://vincentwei1021.github.io/video-shotcraft/) 里挑好镜头再开始。

## 📼 成片模板

`template/` 内置一支**已验收的完整宣传片工程**：36.2 秒、1920×1080、30fps、
10 个镜头的纸墨琥珀风产品宣传片，含 2.5D 真实页面运镜、字卡、转场和配好的电影感 SFX：

https://github.com/Vincentwei1021/video-shotcraft/raw/main/template/out/reference-final.mp4

替换目标产品的截图、文案和品牌信息即可复现同等质感——这是最快、质量最有保障的路径。
想自己跑起来：

```bash
cd template
npm install        # 安装 Remotion 及全部依赖
npm run dev        # 打开 Remotion Studio 实时预览
npm run render     # 渲染成片到 template/out/promo.mp4
```

替换素材前请先读 [模板解构与复现指南](template/TEMPLATE.md)。

## 📦 项目包含什么

| 内容 | 说明 |
| --- | --- |
| 106 张镜头配方卡 | 记录用途、能量、建议时长、参数、实现要点与已知坑 |
| 161 条动态样片 | 覆盖 162 个样式，可在在线 Gallery 中直接预览、搜索和筛选 |
| Remotion 参考实现 | 每张卡对应经过调校的 TSX demo，包含实际缓动和时序参数 |
| 完整成片模板 | 36.2 秒、1920×1080、30fps、10 镜头的纸墨琥珀风产品宣传片 |
| 组件与素材 | 2.5D 页面相机、字幕、闪切、数字滚动、音效和素材采集脚本 |
| 制作方法论 | 从素材采集、风格定调和分镜，到声音设计、节奏卡点与最终验收 |

当前主要面向 Web 与桌面产品宣传片，但镜头卡也可以单独用于功能演示、
品牌短片、发布视频或其他动态设计项目。

## 🗂 项目结构

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

## 🔊 音频与素材说明

`assets/audio/` 中的音效可按各自授权条件使用，来源与许可信息见
[ATTRIBUTION.md](assets/audio/ATTRIBUTION.md)。

模板内的产品截图为演示素材。对外发布成片前，请替换为目标产品自己的截图，
并确认其中的数据、客户信息和个人信息是否需要脱敏。
