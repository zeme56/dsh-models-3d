# 为什么一个插件出错，整个网页就停在启动页

> 症状：打开 `dsh web` 只看到一张启动图，中间写着
> `Failed to load plugins` / `web boot: 2 entries did not activate` / `dsh-landmarks: failed`，
> 对话界面根本进不去。这个文档说清它为什么这么设计、怎么定位、怎么写才不踩。

## 1. 现象

```
HARNESS
Failed to load plugins
web boot: 2 entries did not activate
dsh-landmarks: failed
dsh-style-studio: failed
```

控制台里还能看到真正的异常，例如：

```
Error: slot "sidebar.panellist" is not declared (a parent entry's children table must declare it)
```

注意两点：**启动页只告诉你是哪个条目 failed，不说是哪行错**；**两个插件一起挂，往往是因为它们犯了同一个错，而不是互相影响**。

## 2. 启动门：要么全起来，要么停在门口

`dsh web` 的前端在启动时遍历所有客户端条目，等它们全部进入 `active` 才挂载应用。只要有一个 `failed`，就抛 `web boot: N entries did not activate`，整个页面停在启动页。

设计意图很明确：

- **半残的界面更难查。** 插件没起来，它占的槽位空着，用户点到的入口都是坏的，错误还埋在正常界面里。
- **启动页把失败清单摊开**，配合控制台第一条异常，定位路径最短。
- 代价是要求插件作者自律：**`apply()` 不许抛异常**。插件是可选的附加物，不该有能力拖垮主程序。

所以这不是 bug，是取舍。插件作者的责任是：不管启动顺序如何，`apply()` 都不抛。

## 3. 本插件踩过的坑：注册槽位注册早了

`dsh-landmarks` 早期版本的 `lib/client.js` 长这样：

```js
export function apply(ctx) {
  ctx.slots.register({ name: "sidebar.panellist", id: "landmarks-3d", /* … */ })  // ← 危险
  ctx.slots.register({ name: "main", key: "landmarks-3d", /* … */ })
}
```

`sidebar.panellist` 和 `main` 这两个槽位是**侧栏/布局包在自己的条目激活时声明的**。条目激活顺序由依赖图决定，插件完全可能跑在它前面。冷启动时：

1. 插件条目先激活，`apply()` 里 `register` 找不到槽位 → 抛 `slot "…" is not declared`；
2. 条目状态变 `failed`；
3. 启动门看见 failed → 整页停在启动页，连「卸载插件」的界面都点不到。

**为什么开发时看着没问题？** 只有冷启动才复现。热启用、热重载、在已打开的页面里点安装时，槽位早就声明好了，`register` 一切正常。所以这类 bug 特别阴：开发时怎么点都绿，用户重启一次就全白。

同一个会话里，`dsh-style-studio` 也犯了完全一样的错——两个插件同时 failed，看起来像「互相影响」，其实是同源。

## 4. 正确写法

```js
ctx.slots.inject("sidebar.panellist", () =>
  ctx.slots.register({ name: "sidebar.panellist", id: "landmarks-3d", /* … */ }),
)
ctx.slots.inject("main", () =>
  ctx.slots.register({ name: "main", key: "landmarks-3d", /* … */ }),
)
```

`inject(slot, fn)` = 「这个槽位出现时再执行 fn」：已存在就立刻执行，不存在就排队等声明。注册函数只跑一次，随插件生命周期回收。

这个插件还有两处同类风险，也用同样的思路处理：

- **宿主侧路由**：`webServer` 服务由别的条目提供，所以写 `export const inject = ["webServer"]`，让 cordis 先等它，而不是在 `apply()` 里假设它存在。
- **three.js 运行时**：`ensureThree()` 先检查 `window.THREE?.GLTFLoader`，缺什么补什么，不假设加载顺序。
- **manifest 拉取**：失败就渲染空态，不把异常抛到 `apply()` 外面。

## 5. 定位步骤

1. **启动页**上列出 failed 的包名 → 锁定嫌疑。
2. **控制台第一条红栈** → 真正的异常文本（常常就是 `slot "…" is not declared`）。
3. **确认包在 profile 里**：`~/.dsh/profiles/<profile>/package.json` → `dsh.bundles`；`node_modules/<包名>` 是实体目录还是 `link:`。
4. **判断是不是冷启动独有**：完全退出宿主，或用另一个端口起一份临时实例（`dsh web --port 3099`）。
5. **二分**：`dsh plugin --profile web remove <包名>` 逐个去掉，确认哪个是元凶，再加回来。
6. 修完**必须冷启动验证一次**，热更新通过不算过。

## 6. 自查清单

- [ ] 所有 `ctx.slots.register` 都包在 `ctx.slots.inject` 里
- [ ] 依赖的宿主服务写进 `inject`，不假设已在
- [ ] `apply()` 里没有裸的 DOM / `localStorage` / `fetch` / 文件读取（都要 try 或延迟）
- [ ] 所有副作用都在 `ctx.effect` 里并有 dispose
- [ ] 宿主侧路由做了目录穿越防护，404 不抛
- [ ] 资源缺失时给空态
- [ ] **冷启动**跑过（退出宿主 → 重开）
- [ ] 卸载后无残留（路由、样式、rAF、事件监听）
- [ ] 控制台 0 报错

## 7. 已经卡在启动页怎么救

界面点不动，只能命令行：

```sh
dsh plugin --profile web remove dsh-landmarks     # 或 disable
# 或直接编辑 ~/.dsh/profiles/web/package.json 里的 dsh.bundles
```

然后重启宿主。会话数据不受影响。

## 8. 一句话

**启动门是「一个失败全船停航」；插件是船上的货。所以插件必须假定自己随时可能最先被加载——凡是要等宿主准备好的事，都用 `inject` 排队，不要伸手去拿。**
