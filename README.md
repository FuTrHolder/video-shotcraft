# video-shotcraft

电影感产品视频制作 skill：镜头配方卡 + 已验收成片模板 + 代码/音频资产 +
六阶段工作流。自包含，clone 即用。

- 入口：`SKILL.md`（agent 从这里开始）
- 工作流：`references/pipeline.md`（六阶段 + 阶段 0 开工三问）
- 镜头卡：`references/shots/`（106 张，能量/时长/参数表/已知坑）
- 卡的实现：`demos/<卡名>/`（调校过的 Remotion demo 源码）
- 动态样片画廊：`gallery/`（静态站，`cd gallery && python3 -m http.server 4178` 打开）
- 成片模板：`template/`（36.2s 完整工程，`npm install && npx remotion render src/index.ts AiflPromo out/promo.mp4`；解构文档 `template/TEMPLATE.md`）
- 组件/脚本/音频：`assets/`（lib 组件 copy 进项目用；音频授权见 `assets/audio/ATTRIBUTION.md`）
- 卡点方法论：`references/music-beat-sync.md`（BGM 节奏分析 → 拍号时间线 → 渲后回测）

## 用作 Claude Code skill

```bash
ln -s "$(pwd)" ~/.claude/skills/video-shotcraft
```

然后在任意会话说"用 video-shotcraft 给 XX 产品做一支宣传片"。
