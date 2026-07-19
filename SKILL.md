---
name: video-shotcraft
description: 用镜头配方卡 + 已验收模板 + 代码/音频资产制作电影感产品视频（Remotion + 真实页面截图 + 2.5D 运镜 + 节奏卡点 + 声音设计）。当用户要求"用 video-shotcraft 做视频/宣传片"、要求复刻模板片效果，或要用镜头卡做单个动效镜头时使用。
---

# video-shotcraft：电影感产品视频制作

一个自包含的制作能力库：106 张镜头配方卡（附 demo 实现源码与动态样片
画廊）、一支已验收的完整宣传片模板、可复用组件与音频资产、六阶段工作流。
当前 focus 是 web/桌面产品宣传片，但镜头卡本身是通用动效词汇——
也可以单独抽卡做任意视频里的单个镜头。

## 三种用法

1. **完整宣传片（模板路线）**：想要和模板片高度相似的效果 →
   读 `template/TEMPLATE.md`，按"换产品复现指南"替换素材逐镜头适配。
   最快且质量有底。
2. **完整宣传片（自由创作）**：新风格 → 按 `references/pipeline.md`
   六阶段走（阶段 0 开工三问起步）。
3. **单镜头/单动效**：从 `references/shots/` 选卡（或让用户在
   `gallery/` 画廊里挑），读卡全文 + `demos/<卡名>/` 实现源码，
   适配到目标素材。

## 核心理念

1. **复刻既有页面必须用真实截图；手搓 UI 限非复刻场景，且质量与表达
   明确性是硬门槛。** 表现产品真实页面时第一步就起本地 dev server，
   用无头浏览器截全页 2x 纹理 + 元素级抠图 + layout.json 坐标表。
   非复刻场景（抽象开场/品牌段/独立展示组件）允许手搓 UI，但达不到
   出版级质感或观众看不懂它表达什么，就回截图路线。页面数据默认
   可用现成数据；是否脱敏在素材确认时问用户。

2. **电影感来自运镜、光影、节奏与声音的配合，不来自炫技动画。**
   被反复认可的是：单主角完整动作弧（聚光→推近→悬浮→归位）、
   物理隐喻驱动的加速度（发牌）、侧斜机位 orbit 环绕特写、
   riser→impact→sparkle 的声音句式。批量元素入场靠运动本身，
   不靠逐个发光——装饰性 glint/泛光群发即廉价，单点高质量光效可做。

3. **每个镜头只讲一个动效；关键信息落定后必须呼吸。**
   一种动画手法（飞入/堆叠/翻页）全片只当一次主角，重复镜头、重复
   tagline 一律删。节奏偏好是单向的：历史反馈全部指向"放慢/停留"，
   从未有一次"太慢了"——品牌字标落定 hold ≥1s、批量动效收尾留 0.5s
   静止、开场主体动作给足 3s。排时间线时预先给 hold/rest 留帧预算。

4. **强节奏 BGM 的片子，所有转场和动效必须卡在拍上。**
   用户已选好音乐 → 开工前先做节奏分析（librosa 网格拟合求真实
   BPM/相位 + 带通找鼓点重音），时间线用拍号 `beatF(n)` 写，渲后从
   成片抽音轨回测切点误差 ≤3f。方法论见 `references/music-beat-sync.md`。

5. **用镜头卡动效必须先读它的 demo 实现代码。** 配方卡给的是语义和
   参数表，`demos/<卡名>/` 里的源码才是调校过的参数真相（缓动、时值
   配比、摘罩时机、已知坑的规避写法）。允许适配性改动，但卡上
   "已知坑/命门"标注的参数不得降档——质量标准只升不降。凭卡名和
   理解新写＝放弃全部调校积累。

6. **廉价确认物前置：素材→styleframe→分镜逐级确认，方向问题不进
   逐镜头阶段。** 一个纯 HTML/CSS 对比页 + 一张截图就能锁定全片
   色板/字体/光感；分镜表与设计 spec 同文档一次确认。确认物越廉价、
   越早，返工越便宜。

7. **验收贯穿全程 + 交付前独立审查。** 阶段 4 起每个镜头用
   `npx remotion still` 出静帧自检、每轮修改后整片渲染 + ffmpeg
   抽帧回看；交付前必须派一个干净上下文的 subagent 做独立视觉审查
   （只给成片/关键帧/审美准则/分镜表，逐条出带帧号证据的报告）——
   制作者对自己的产出有确认偏差，首检永远不能交给用户。

8. **确定性渲染**：禁 `Date.now()`/`Math.random()`，一切伪随机固定
   种子（mulberry32/哈希，seed 从 index 派生），逐帧可复现。

## 工作流

按 `references/pipeline.md` 六阶段执行（阶段 0 开工三问：音乐选好了吗 /
用模板还是自由创作 / 数据合规口径）。阶段 3（分镜）时扫
`references/shots/` 各卡 frontmatter 按能量曲线选镜头；阶段 4–6 持续
对照 `references/aesthetic-rules.md` 自检；阶段 5 读
`references/sound-design.md`；卡点片全程贴 `references/music-beat-sync.md`。

## 何时读哪个文件

| 时机 | 读 |
|------|----|
| 项目启动 | pipeline.md（阶段 0 三问） |
| 用户已选 BGM | music-beat-sync.md（先分析再分镜） |
| 走模板路线 | template/TEMPLATE.md 全文 |
| 分镜设计 | sequences/ 桥段模板（全片骨架先填空）；shots/ 全部 frontmatter；选中的卡读全文 |
| 逐镜头实现 | 该镜头卡全文 + demos/<卡名>/ 实现源码全文 + assets/lib/ 对应组件 |
| 声音设计 | sound-design.md + assets/audio/ |
| 验收 | aesthetic-rules.md 全文过 checklist（独立 subagent 执行） |

## 资产使用方式

- `assets/lib/` 组件 **copy 进新项目**后自由修改（不 import 本库）。
  清单：PageCam（2.5D 页面相机——一切"真实页面"镜头的地基）、DigitRoll、
  FlashCut、Caption、FlatPanel、VerticalTicker（3D 无限滚动墙）、
  helpers(rand/shake/camera/motion)。FlatPanel 与 helpers/camera 需要
  `three` + `@react-three/fiber` + `@remotion/three` 依赖，其余仅需 remotion。
- `assets/scripts/capture-template.mjs` 复制后改顶部 CONFIG（BASE/路由/选择器）。
- `assets/audio/` 音效直接复制使用（免费商用授权，见 audio/ATTRIBUTION.md）；
  `assets/audio/bgm/` 是节奏感强的 BGM 备选。
- `demos/` 各卡实现源码：多数为自包含灰阶 demo（部分 import
  `demos/_fixtures/Fixtures.tsx` 的假 UI 场景件，个别 import
  `demos/_textures/` 的真实页面纹理），copy 进 Remotion 项目即可跑。
- `template/` 完整可渲染工程：`npm install && npx remotion render
  src/index.ts AiflPromo out/promo.mp4`。
- `gallery/` 静态画廊：`cd gallery && python3 -m http.server 4178`
  后浏览器打开，106 卡 161 条动态样片可浏览/搜索/多选复制卡名——
  适合让用户看着样片挑镜头。
