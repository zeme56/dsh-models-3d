# 扩展指南 · Extending dsh-landmarks

这个插件刻意做成「模型与代码分离」：展品全在 `assets/` 里，界面和渲染逻辑不认具体是哪个地标。所以加一件展品不用碰代码。

## 一、加一件展品（推荐路径）

### 1. 准备 glb

- **glTF 2.0 二进制（.glb）**，不是 .gltf + 外部贴图——贴图必须打进 glb 里（Blender 导出时选「glTF Binary (.glb)」并确保贴图已打包）。
- 尺寸随意：客户端会把整件模型归一化到 4.2 单位的包围盒，再按同样距离取景。**但原点要在模型中心**，否则它会绕着偏心的轴自转。
- 面数建议 < 15 万三角面。四件现有展品在 3.2 万 – 9.8 万之间，桌面端很轻；手机端上 30 万会明显掉帧。
- 材质建议用 Principled BSDF 的导出结果（metallic/roughness 工作流），展厅里有环境光照（RoomEnvironment），金属感能出来。

### 2. 跑一条命令

```sh
node tools/add-model.mjs --glb D:\models\colosseum.glb --id colosseum \
  --zh 罗马斗兽场 --en Colosseum \
  --place-zh "罗马 · 意大利" --place-en "Rome · Italy" \
  --year 80 --scale-zh "高 48 m" --scale-en "48 m tall" \
  --blurb-zh "公元 80 年落成，五万人的看台围出一圈拱廊。" \
  --blurb-en "Completed in AD 80, its arcades ringed seating for fifty thousand." \
  --accent "#c9a227" --thumb D:\models\colosseum.png
```

想先看看会写成什么，加 `--dry-run`：只打印条目，不复制文件、不写 manifest。

脚本会做四件事：

1. 校验 glb（magic、版本 2.0、JSON chunk 可解析、三角面 > 0）；
2. 复制到 `assets/models/<id>.glb`（有缩略图则复制到 `assets/thumbs/<id>.<ext>`）；
3. 从 glb 里数出三角面 / 材质 / 节点数；
4. 往 `assets/manifest.json` 追加条目并刷新 `version`（客户端用 `cache: "no-store"` 拉清单，刷新页面就能看到）。

`id` 重复会直接报错退出，不会覆盖已有展品。

### 3. 验证

刷新页面 → 侧栏点「地标 3D」→ 新展品出现在列表里 → 点开看构图是否正确。如果模型很小或跑出画面，通常是**原点不在中心**，回 Blender 里 `Origin → Center of Mass`/`Geometry to Origin` 再导。

## 二、manifest 字段速查

`assets/manifest.json` 只有一个文件，结构固定：

```jsonc
{
  "schema": 1,                       // 结构版本，暂为 1
  "version": "a50c24ea77",           // 内容指纹，客户端用来判断要不要重载
  "generatedAt": "2026-11-03T06:19:20.679Z",
  "credit": { "zh": "…", "en": "…" }, // 展厅底部那行来源说明
  "models": [ /* 展品数组，顺序即列表顺序 */ ]
}
```

每件展品：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 唯一标识，也是文件名；kebab-case |
| `accent` | string | 这件展品的强调色（展签圆点、进度条） |
| `name` | `{zh,en}` 或字符串 | 展签标题 |
| `place` | 同上 | 地点 |
| `year` | string | 年代，可以是「1889」「明 · 1368–1644」这种自由文本 |
| `scale` | 同上 | 尺度描述 |
| `blurb` | 同上 | 两三句介绍 |
| `model` | string | 相对 `assets/` 的路径，如 `models/x.glb` |
| `thumb` | string \| null | 缩略图路径；**可以为 null**，界面会退回用图标 |
| `bytes` / `triangles` / `materials` / `nodes` | number | 展示用的统计，脚本自动填 |

文本字段都支持「一个字符串」或「`{zh, en}` 两种语言」：客户端 `pick(value, lang)` 会在语言缺失时自动回落。所以只写中文完全没问题。

## 三、删掉 / 替换一件展品

- **删**：从 `manifest.json` 的 `models` 数组里删掉那条，再删掉 `assets/models/<id>.glb`（和 `thumbs/<id>.png`）。不用改代码。
- **换模型但保留展签**：直接覆盖 `assets/models/<id>.glb`，然后更新 `bytes` / `triangles`（或者干脆跑一遍 `add-model.mjs --dry-run` 拿到新数字手填）。
- **调整顺序**：`models` 数组的顺序就是列表顺序。

## 四、改展厅本身

都在 `lib/client.js` 里，几个常量最常改：

| 想改什么 | 位置 | 现值 |
| --- | --- | --- |
| 模型归一化后的尺寸 | `NORMALIZED_SIZE` | `4.2` |
| 相机到模型的距离 | `CAMERA_DISTANCE` | `8.8` |
| 视场角 | `new THREE.PerspectiveCamera(40, 1, 0.1, 120)` | `40°` |
| 自动旋转速度 | `pivot.rotation.y += dt * 0.24` | 0.24 rad/s |
| 展签/列表样式 | `const CSS = \`…\`` | — |
| 灯光与环境 | `createViewer()` 里的 `RoomEnvironment` + 灯组 | — |

改完刷新页面即可，没有构建步骤。

## 五、给展品加交互（进阶）

现在的交互只有「换展品 + 轨道相机」。想做「点模型弹出资料卡」，思路是：

1. `viewer` 里已经有 `raycaster` 的位置可以加（`createViewer` 的指针事件区）；
2. glb 里的子对象名来自 Blender 的对象名，用 `root.getObjectByName("tower-base")` 定位；
3. 点击后把信息通过回调抛给 React 面板（`show(url, cb)` 已经有 `cb` 这个口子）。

记得在 `disposeObject()` 里释放你新建的监听器，否则切换展品会叠事件。

## 六、加完自检清单

- [ ] `add-model.mjs --dry-run` 输出的三角面数与 Blender 里差不多
- [ ] 刷新后新展品在列表里，点开构图正常、不自转偏心
- [ ] 中英切换时文案都对（没写的语言会回落到另一门语言，这是预期行为）
- [ ] 切到别的标签页再回来，渲染恢复、没有多份 rAF 在跑
- [ ] 卸载插件后 `/api/landmarks` 路由消失（宿主侧 `ctx.effect` 的 dispose 生效）
