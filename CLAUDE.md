# video-shotcraft

镜头配方卡 + Remotion demo 的电影感产品视频 skill 仓库。

## Git push 流程（重要）

本机（Mac）被 Code Defender 拦截，**不能直接 `git push` 到 origin**
（github.com/Vincentwei1021/video-shotcraft 未在审批名单）。

推送走 synapse 机器（`~/.ssh/config` 里的 `synapse` host，
repo 在 `~/video-shotcraft`）：

```bash
# 本机打 bundle 传过去，synapse 上 fast-forward 后 push
git bundle create /tmp/fix.bundle origin/main..main
scp /tmp/fix.bundle synapse:/tmp/
ssh synapse "cd ~/video-shotcraft && git fetch /tmp/fix.bundle main:refs/tmp/fix \
  && git merge --ff-only refs/tmp/fix && git update-ref -d refs/tmp/fix \
  && git push origin main && rm /tmp/fix.bundle"
rm /tmp/fix.bundle
```

本机 commit 照常做，只有 push 需要绕道。

## Gallery 维护

- 改过 `references/shots/*.md` 后跑 `python3 gallery/sync-from-cards.py`
  （同步 gallery/source 副本、library.json 文本字段、index.html 预渲染、
  sitemap、llms.txt）。
- demo 视频规格：1920×1080、30fps、h264，放 `gallery/media/<style-key>.mp4`；
  library.json 里 media url 带 `?v=<毫秒时间戳>` 做缓存穿透。
- 多式卡（`*-moves`）每式一个 style + 一个视频；新 style key 要在
  `gallery/translations.js` 的 `stylesZh` 加中文标签。
- 渲染 demo：把 `demos/<卡名>/` 组件临时拷进 `template/src/` 注册
  Composition，用 `npx remotion render` 渲染，完事删掉临时文件。
