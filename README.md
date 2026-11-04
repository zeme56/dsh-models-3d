# 模型 3D · Models 3D

> DeepSeek Harness 侧栏里的 3D 模型展厅：埃菲尔铁塔、长城、紫禁城、泰姬陵。

## 展厅

| 展品 | id |
| --- | --- |
| 埃菲尔铁塔 | `eiffel-tower` |
| 长城 | `great-wall` |
| 紫禁城 | `forbidden-city` |
| 泰姬陵 | `taj-mahal` |

左侧卡片切换，右侧用 three.js 实时渲染；拖拽环视、滚轮缩放、双击复位，右上角可自动旋转 / 复位 / 全屏，底部信息卡给年代、尺度与文件大小。

## 为什么没有「导入模型」了

这个功能做过，也跑通过：上传 GLB、填 `.blend` 路径、宿主探测 Blender 并转成 GLB，都验证过。但它后来被**整个移除**了，原因需要写清楚：

1. **我（维护这个插件的一方）能力不够。** 本机模型千奇百怪——LOD 叠加、几百万面、几 GB 贴图、外部链接库、几何节点、修改器栈。我写的导出器只能靠「同名 LOD 只留最轻一档 + 面数压到 35 万 + 贴图缩到 1K」这种粗暴规则兜底，遇到复杂场景仍然会导出错误、贴图丢失或直接失败。一个真实例子：一棵 180 MB 的树，场景里两套 LOD 叠在一起，导出成了 781 MB，浏览器根本打不开。
2. **想法本身可能就有错。** 把「任意 Blender 工程导入成一个网页展厅条目」当成一个按钮，是把 Blender 的资产管线想简单了：单位、朝向、相机、材质、贴图打包、性能预算，每一项都需要人判断，不该由插件替用户猜。更合理的做法是用户在 Blender 里按目标平台的规范导出 GLB，再把文件放进 `assets/models/`、在 `assets/manifest.json` 里登记——这需要手动一步，但结果是可预期的。
3. **风险由用户承担，收益却不确定。** 导入会往插件目录写几十 MB 到几百 MB 的文件，转换要占用几分钟 CPU，失败时的错误信息也未必能说清是哪一步坏了。对一个「看看模型」的侧栏来说，这个代价不划算。

所以现在只保留四个预先做好、验证过的模型。想加自己的模型，按下面「手动添加」做，比按钮可靠。

### 手动添加一个模型

1. 在 Blender 里导出 GLB（`export_yup=True`，相机可选；建议先减面、贴图不超过 2K）。
2. 把 `.glb` 放进 `assets/models/`，缩略图（640×640、透明底）放进 `assets/thumbs/`。
3. 在 `assets/manifest.json` 的 `models` 数组里加一条，字段照抄现有条目：
   `id`、`name`（`{zh,en}`）、`place`、`year`、`scale`、`blurb`、`accent`、`model`、`thumb`、`bytes`、`triangles`、`materials`、`nodes`。
4. 刷新页面。`manifest.json` 的 mtime 会作为缓存版本，客户端会自动重新取 GLB。

## 宿主接口

前缀 `/api/models`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 存活 |
| GET | `/manifest` | 内置模型清单（含三角面/材质/节点统计） |
| GET | `/assets/*` | 模型/缩略图静态文件（支持 Range/ETag） |

## 目录

```
dsh-models-3d/
├── lib/index.js           宿主路由（静态资源 + manifest）
├── lib/client.js          侧栏入口 + 展厅
├── assets/models/*.glb    四座模型
├── assets/thumbs/*.png    缩略图
├── assets/manifest.json   展品清单
└── locale/{zh,en}.json    插件元信息
```

## License

MIT
