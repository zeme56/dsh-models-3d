# 从零做一个 DeepSeek Harness 插件（服务端 + 浏览器端版）

这份笔记来自 [dsh-landmarks](https://github.com/zeme56/dsh-landmarks) 的实现：一个插件既要在宿主进程里开 HTTP 路由、发静态资源，又要在浏览器里画 3D 展厅。比纯前端插件多一层，但结构其实很朴素。

> 适用版本：`dsh` 0.2.x（`dsh.bundle` 机制）。细节可能随版本变，以求你 checkout 里的源码为准。

## 1. 一个插件是两个进程里的一段代码

| 文件 | 跑在哪 | 能干什么 |
| --- | --- | --- |
| `lib/index.js` | 宿主（Node） | 开 HTTP 路由、读本地文件、注册服务、调度 |
| `lib/client.js` | 浏览器（React） | 渲染界面、注册槽位、碰 DOM/CSS、发 fetch |
| `cordis.patch.yml` | 宿主启动时 | 把自己 insert 进 profile 的条目列表 |

两边**不能互相 import**，只能通过 HTTP（或者宿主注入到页面里的启动数据）通信。本插件就是这么干的：宿主开 `/api/landmarks/*`，浏览器去 fetch。

## 2. 目录

```
dsh-landmarks/
├── package.json
├── cordis.patch.yml
├── icon.svg
├── locale/{zh,en}.json
├── lib/
│   ├── index.js        # 宿主：/health、/manifest、/assets/*
│   └── client.js       # 浏览器：侧栏入口 + 3D 展厅
├── assets/
│   ├── manifest.json   # 展品清单（这个插件的「数据库」）
│   ├── models/*.glb
│   ├── thumbs/*.png
│   └── vendor/         # three.min.js、GLTFLoader、OrbitControls、RoomEnvironment
├── tools/add-model.mjs # 加展品的脚本
└── docs/
```

## 3. package.json 要点

```jsonc
{
  "name": "dsh-landmarks",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-theme", "@deepseek-ai/dsh-client-locale"] }
  }
}
```

- **`dsh.bundle.patch`**：没有它，`dsh plugin add` 装不进 profile，市场也不认。
- **`exports` 要逐项列出**，宿主按这些子路径取文件。
- **`dsh.client.platform: "web"`**：告诉 `dsh web` 这个包有浏览器代码要服务出去。
- **`files`** 记得把 `assets/` 带上，否则发到 npm 时模型全丢。
- `peerDependencies` 里写 `@deepseek-ai/cordis` 和 `react`（宿主提供，不重复安装）。

## 4. 宿主侧：开一条带护栏的静态路由

最小骨架（真实代码在 `lib/index.js`，约 170 行，多了 Range/etag/MIME 白名单）：

```js
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const ASSETS = fileURLToPath(new URL("../assets", import.meta.url))
const PREFIX = "/api/landmarks"

export const name = "landmarks-3d"
export const inject = ["webServer"]

export function apply(ctx) {
  ctx.effect(() => {
    const off = ctx.webServer.route(PREFIX, async (req, res) => {
      const rel = decodeURIComponent(req.url.slice(PREFIX.length)).replace(/^\/+/, "")
      // 目录穿越护栏：解析后必须仍在 ASSETS 里
      const abs = normalize(join(ASSETS, rel))
      if (!abs.startsWith(ASSETS + (process.platform === "win32" ? "\\" : "/"))) {
        res.statusCode = 403; return res.end()
      }
      try {
        const body = await readFile(abs)
        res.setHeader("content-type", mimeOf(extname(abs)))
        res.end(body)
      } catch {
        res.statusCode = 404; res.end()
      }
    })
    return () => off()
  })
}
```

要点：

- **副作用一律进 `ctx.effect(() => { …; return dispose })`**。插件卸载/重载时宿主调 dispose，路由才不会幽灵一样留着。
- **路径必须做穿越检查**（`..%2f` 之类）。用户可控的 URL 拼文件路径，是插件最容易捅出来的洞。
- **别一次读整个目录**：`readFile` 按需读，加 etag（`size + mtime`）和 Range 支持，浏览器才会缓存、视频类资源才能拖动。
- **出错不要抛到 `apply()` 外面**（404 就回 404），宿主侧抛错同样会让条目 failed 并把整个网页挡在启动页。
- 用 `import.meta.url` 定位 `assets/`，不要用 `process.cwd()`——宿主的工作目录不是插件目录。

## 5. 浏览器侧：槽位 + 拉数据

```js
window.__ModuleLoader__.load({
  id: "dsh-landmarks",
  factory: (require) => {
    const React = require("react")   // 只能 require react
    const name = "landmarks-3d"

    function apply(ctx) {
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register({
          name: "sidebar.panellist", id: "landmarks-3d", order: 30,
          label: "地标", component: SidebarRow,
        }),
      )
      ctx.slots.inject("main", () =>
        ctx.slots.register({ name: "main", key: "landmarks-3d", component: GalleryPanel }),
      )
    }

    return { name, inject: ["slots", "locale", "theme"], apply }
  },
})
```

三条纪律：

1. **`ctx.slots.inject(slot, fn)`，不要直接 `register`。** 槽位是 shell 包激活时才声明的，插件可能先跑；直接注册会抛 `slot "…" is not declared` 并拖垮整个网页启动（复盘见 [BOOT-FAILURE.md](BOOT-FAILURE.md)）。
2. **`main` 槽位是 keyed 的**，`key` 必须等于侧栏那行的 `id`，点行才会切面板。
3. **拉数据要有失败态。** 展厅在 manifest 拉不到时显示「展厅资源没有就绪」而不是白屏——fetch 失败、JSON 解析失败、`models` 为空都要处理。

## 6. 第三方库怎么办：vendored UMD

这个插件要在浏览器里用 three.js，但客户端插件**只能 `require("react")`**，不能 require 别的 npm 包，也没有打包步骤。做法是把 three.js 的 UMD 构建放进 `assets/vendor/`，浏览器里按顺序注入 `<script>`：

```js
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script")
    el.src = src; el.async = false
    el.onload = resolve; el.onerror = () => reject(new Error(`failed to load ${src}`))
    document.head.appendChild(el)
  })
}

async function ensureThree() {
  if (window.THREE?.GLTFLoader) return window.THREE
  await loadScript(VENDOR + "three.min.js")
  await loadScript(VENDOR + "GLTFLoader.js")
  await loadScript(VENDOR + "OrbitControls.js")
  await loadScript(VENDOR + "RoomEnvironment.js")
  return window.THREE
}
```

代价是包里多了几 MB；好处是不联网、不受 CDN 可用性影响、也不需要宿主的打包器支持。

## 7. 性能与资源纪律

- 渲染循环用 `requestAnimationFrame`，**面板卸载时要 `cancelAnimationFrame`**，并 dispose geometry/material/texture（`disposeObject()`），否则切几次展品就吃满显存。
- `visibilitychange` 时暂停循环——用户切走标签页还在跑 60fps 是很招骂的。
- 模型加载用 `GLTFLoader` 的进度回调驱动加载条，别让用户对着黑屏猜。
- 大文件（glb）走宿主路由而不是内联到 JS 里，浏览器才能缓存与并行加载。

## 8. 本地开发循环

```sh
dsh plugin --profile web add link:C:\path\to\dsh-landmarks   # 挂本地目录
dsh web --port 3080                                          # 重启宿主
```

- 改 `lib/client.js` → 刷新页面；改 `lib/index.js`（宿主侧）→ **必须重启宿主**，Node 侧不会热更新。
- 改 `assets/` 下的文件 → 刷新页面即可（路由每次读盘）。
- 从 GitHub 装：`dsh plugin --profile web add github:owner/repo`。
- 卡在启动页时的逃生口：`dsh plugin --profile web remove dsh-landmarks`，重启。

## 9. 发布前检查清单

- [ ] `dsh.bundle.patch` 存在，`"private"` 已去掉
- [ ] `exports` 与 `files` 覆盖 `lib/`、`assets/`、`locale/`、`cordis.patch.yml`
- [ ] `cordis.patch.yml` 的 `name` 是裸包名，`id` 不与他人冲突
- [ ] 所有槽位注册走 `slots.inject`
- [ ] 所有路由/定时器/监听器都有 dispose
- [ ] 静态路由做了目录穿越防护
- [ ] **冷启动**验证：完全退出宿主再启动，确认页面能进、插件能用
- [ ] 卸载后路由消失、无残留 DOM/样式
- [ ] 控制台 0 报错
- [ ] 仓库 public + `dsh-plugin` topic + README/LICENSE

## 10. 参考

- 本仓库就是完整例子：宿主路由 + 静态资源 + 客户端 3D。
- 姊妹项目 [dsh-style-studio](https://github.com/zeme56/dsh-style-studio)：纯浏览器侧插件，演示主题令牌与槽位面板。
- 权威定义在 profile 的 `node_modules/@deepseek-ai/` 里（槽位、主题、webServer 服务）。
