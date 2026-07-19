# video-shotcraft

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

## 三种使用方式

### 1. 使用完整视频模板

适合需要快速得到一支结构完整、质量稳定的产品宣传片。模板已经包含：

- 品牌开场、功能展示、字卡呼吸位和结尾品牌落版；
- 真实页面截图驱动的 2.5D 运镜；
- 转场、字幕和电影感 SFX；
- 可替换的产品截图、文案、品牌信息与页面坐标。

先阅读 [模板解构与复现指南](template/TEMPLATE.md)，再启动工程：

```bash
cd template
npm install
npm run dev
```

渲染完整成片：

```bash
npm run render
```

输出文件位于 `template/out/promo.mp4`。

### 2. 用镜头卡自由组合

先到 [在线 Gallery](https://vincentwei1021.github.io/video-shotcraft/)
挑选想使用的动效镜头，然后按以下顺序阅读和使用：

1. 打开 `references/shots/<卡名>.md`，了解镜头意图、时长、能量与参数。
2. 打开 `demos/<卡名>/`，阅读对应的 Remotion 实现源码。
3. 将 demo 和需要的共享组件复制到目标 Remotion 项目中。
4. 替换为目标产品的真实素材，并根据实际构图做适配。

镜头卡定义“为什么这样拍”，demo 源码保存“具体怎样实现”。使用镜头卡时，
不要只根据卡名重新编写动画；经过调校的缓动、时值和摘罩时机都在 demo 中。

### 3. 从零制作完整宣传片

需要全新视觉语言时，按照 [六阶段制作流水线](references/pipeline.md) 执行：

1. 阶段 0：确认音乐、模板路线和数据合规口径。
2. 素材采集：获取真实页面截图、元素切片和 `layout.json`。
3. 风格定调：用低成本 styleframe 锁定视觉与动效性格。
4. 分镜设计：根据功能清单和能量曲线选择镜头卡。
5. 逐镜头实现：每个镜头完成后立即输出静帧验收。
6. 声音设计：为运镜、落地、转场和品牌落版配置 SFX。
7. 最终验收：整片渲染、抽帧检查，并按审美准则逐项复核。

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

然后访问 `http://localhost:4178`。

也可以直接使用线上版本：
[vincentwei1021.github.io/video-shotcraft](https://vincentwei1021.github.io/video-shotcraft/)。

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

## 制作原则

- 展示已有产品页面时优先使用真实截图，不用手绘 UI 冒充产品界面。
- 每个镜头只让一种动效手法成为主角，避免全片重复同一种表达。
- 先确认素材、styleframe 和分镜，再进入成本更高的逐镜头实现。
- 关键信息落定后保留呼吸时间；品牌字标落定至少停留 1 秒。
- 强节奏音乐中的镜头边界和关键动作必须锚定拍点。
- 禁止使用 `Math.random()`、`Date.now()` 等非确定性数据驱动动画。
- 每个镜头完成后输出静帧检查，交付前再进行整片抽帧验收。

更多细节见 [SKILL.md](SKILL.md) 与
[视觉验收准则](references/aesthetic-rules.md)。

## 音频与素材说明

`assets/audio/` 中的音效可按各自授权条件使用，来源与许可信息见
[ATTRIBUTION.md](assets/audio/ATTRIBUTION.md)。

模板内的产品截图为演示素材。对外发布成片前，请替换为目标产品自己的截图，
并确认其中的数据、客户信息和个人信息是否需要脱敏。
