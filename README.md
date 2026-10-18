# dsh-ui-background

[![npm version](https://img.shields.io/npm/v/dsh-ui-background.svg)](https://www.npmjs.com/package/dsh-ui-background)
[![license](https://img.shields.io/npm/l/dsh-ui-background.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522.19-339933)](https://nodejs.org)

给 **DeepSeek Harness Web 客户端**加一层本地背景（图片 / 视频）+ 全界面毛玻璃。

```bash
dsh plugin --profile web add dsh-ui-background
```

> 装完**必须重启一次 Host**（DSH 的模块解析表在启动时构建）。
> 状态：`0.8.2`，在 **DSH 0.2.0-rc.2** 上开发与验证。RC 阶段内部契约会变，升级 DSH 后请重新验收。

## 它是什么（以及为什么不卡）

毛玻璃**不靠扫描 DOM**，而是改官方主题令牌：

```js
ctx.theme.overrideTokens('dsh-ui-background', {
  '--dsw-alias-bg-base':         { light: 'rgba(255,255,255,.62)', dark: '…' },
  '--dsw-specific-sidebar-fill': { light: '…', dark: '…' },
  // 另外 3 个抬升面 / 弹层令牌
})
```

DSH 的 `body`、主框架、侧栏本来就用这些令牌画背景，所以：

- 零 DOM 扫描、零 `MutationObserver`、零逐面板 `backdrop-filter`
- 关掉 = 撤销令牌层，界面**立刻回到出厂样式**，无残留
- 背景层是**一个** `position:fixed; z-index:-1` 的图层（图片走纯 CSS，视频走一个 `<video>`）

## 功能

- 背景来源：上传文件 / 本机路径（只读，不复制不移动）
- 视频背景：`mp4` / `webm` 循环播放，切到后台自动暂停
- 构图：`铺满(cover)` / `完整(contain)`、缩放 50–300%、水平/垂直位置，**预览里可直接拖动**
- 壁纸引擎：自动扫 Steam 工坊 `431960`，**只列出可直接播放的**（视频/图片）
- 最近使用：最多 12 条，带缩略图与**构图参数**，一键切回，可单条删除
- 上传文件可单个删除；删到正在用的那张会自动关掉背景
- 全部本地：不联网、不收集数据

## 安装

```bash
dsh plugin --profile web add dsh-ui-background
```

**装完必须重启一次 Host**（DSH 的模块解析表在启动时构建，新装的包当次不可导入）。

重启后：设置 → **背景与玻璃**。

## 适合什么场景

- 只想要「本地图片 / 视频当背景 + 界面半透明」，不想为此再装一个渲染引擎
- 换图之后不想重新调构图：每条历史记录里存着缩放与位置

不做的事：Wallpaper Engine 的 Scene 渲染。`scene.pkg` 需要它自己的引擎，本插件只认图片和视频文件。
## 已知限制

| 限制 | 原因 |
|---|---|
| Scene 壁纸不能当背景 | `scene.pkg` 是 Wallpaper Engine 私有格式，需要它的引擎渲染；包里没有现成图片 |
| 别拿 WE 预览图凑数 | 实测预览图只有 **144–254 px**，铺满 1920 宽会糊 7–13 倍 |
| 想要 WE 画面 → 截图 | 开着 WE，`Win+Shift+S` 截屏后点「粘贴截图」（1920×1080，清晰） |
| `mkv` / `mov` 可能不播 | Edge 不支持这些容器，用 `mp4` / `webm` |
| 半透明会影响所有用基础背景令牌的地方 | 代码块顶栏、图片占位、弹层遮罩都会跟着透明，这是同一套令牌的代价 |

## 安全

- Host 端只读**你在设置里显式填写的**那一个本机文件，以及 Steam 工坊目录里的 `project.json` / 媒体 / 预览图
- HTTP 路由仅回环；写操作拒绝 `sec-fetch-site: cross-site`
- 上传目录内的文件名已净化，不接受路径穿越
- 状态存在 `$DSH_HOME/storages/dsh-ui-background/`（`state.json` + `backgrounds/`），卸载插件**不会**自动删除，请自行清理

## 开发

```bash
node selftest.mjs   # 用假 Cordis 上下文挂载 host 半身，直接打自己的 HTTP 处理器
```

`lib` 端只依赖 `node:fs` / `node:path` / `node:os`，没有 npm 运行时依赖。

## License

MIT
