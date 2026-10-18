# 发布清单（照着做，一条一条来）

> 目标：把 `release\` 变成一个可以 `npm publish` 的包。
> 你需要一个 npm 账号；GitHub 仓库可选但强烈建议。

## 0. 先填两个占位

- `LICENSE` 里的 `<YOUR NAME HERE>` → 你的名字或网名
- `package.json` 里如果以后建了仓库，补上：
  `"repository": { "type": "git", "url": "git+https://github.com/<你>/dsh-ui-background.git" }`

## 1. 确认包名没被占用（本机已验证：`dsh-ui-background` 在官方源 404 = 可用）

```powershell
npm view dsh-ui-background version
```

- 报 404 / not found → 名字可用，继续
- 打印出版本号 → 换个名字（例如 `dsh-ui-background-local`），并同步改 `package.json` 的 `name`、`cordis.patch.yml` 的 `name`、`client.js` 顶部的 `id: '…'` 与 `SOURCE_ID`

## 2. 预演打包（不产生文件）

```powershell
cd F:\蓝色大肥鱼\dsh-bg-plugin\release
npm pack --dry-run
```

看清单一栏：应当只有 `index.js` `client.js` `cordis.patch.yml` `README*.md` `CHANGELOG.md` `LICENSE`。有杂项就改 `package.json` 的 `files`。

## 3. 真打包

```powershell
npm pack
```

得到 `dsh-ui-background-0.8.0.tgz`。

## 4. 验收（最重要的一步，别跳过）

**坑一：`dsh plugin add` 建出的新 profile 只有 `dsh-base`，没有 Web 前端。**
直接启动会连不上端口，插件日志显示 `pending (waiting for service: webServer)`。
必须手动补一行 bundle（随安装解析，不用联网）：

```jsonc
// ~/.dsh/profiles/scratch/package.json
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",     // ← 手动加这一行
  "dsh-ui-background"
] } }
```

**坑二：CLI 语法。** `web` 本身就是"启动 web profile"的简写，**不要再写一次**：

```powershell
dsh plugin --profile scratch add .\dsh-ui-background-0.8.0.tgz
# 然后（注意没有 "web" 这个词）
dsh --profile scratch --port 3090
```

**坑三：用 PowerShell 改 profile 的 `package.json` 会把中文路径读成乱码**（Windows PowerShell 5.1 按系统 ANSI 解码）。改完用 `node -e` 或 `Get-Content -Encoding UTF8` 复核一遍。

### 验收清单（在 http://127.0.0.1:3090 里点）

- [ ] 设置 → 出现「背景与玻璃」
- [ ] 上传一张图 → 界面变半透明、看得出背景
- [ ] 关掉开关 → 界面完全恢复原样
- [ ] 拖「缩放 / 位置」→ 预览与实际一致

四项全过才算"别人机器上也能用"。测完删掉临时 profile：
`Remove-Item ~\.dsh\profiles\scratch -Recurse -Force`
## 5. 发布到 npm

```powershell
npm login          # 一次性，浏览器里登录
npm publish --access public
```

发布后别人就能：`dsh plugin --profile web add dsh-ui-background`

## 6. GitHub 仓库（建议）

本机目前没装 `git`。要建仓库：

1. 装 Git for Windows（或 GitHub Desktop）
2. 在 `release\` 里 `git init` + 提交
3. GitHub 建空仓库 → `git remote add origin …` → `git push -u origin main`
4. 把仓库地址补回 `package.json`（`repository` / `homepage`）

## 7. 收录到插件市场（可选）

- dshmarket（自动采集）
- awesome-dsh-plugin（人工精选，一般走 PR）

提交前确认 README 里有：安装命令、截图、已知限制。