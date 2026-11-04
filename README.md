# 模型 3D · Models 3D

> DeepSeek Harness 侧栏里的 3D 模型展厅：四座地标，外加你从本机导入的模型。

## 展厅

| 展品 | id |
| --- | --- |
| 埃菲尔铁塔 | `eiffel-tower` |
| 长城 | `great-wall` |
| 紫禁城 | `forbidden-city` |
| 泰姬陵 | `taj-mahal` |

左侧卡片切换，右侧用 three.js 实时渲染；拖拽环视、滚轮缩放、双击复位，右上角可自动旋转 / 复位 / 全屏，底部信息卡给年代、尺度与文件大小。

## 导入本机模型

点右上角「＋ 导入模型」，两种方式：

1. **本机文件**：选一个 `.glb` / `.gltf`（≤ 60 MB）上传，落到 `assets/imported/`，立刻进入展厅。
2. **Blender 工程**：填 `.blend` 的完整路径。宿主会探测本机 Blender（`DSH_BLENDER` / `BLENDER_PATH` 环境变量、`Blender Foundation` 安装目录、`PATH`），用 `lib/blender_export.py` 无头导出 GLB（删灯光、保留相机、应用修改器），再入库。转换通常 30–90 秒。

导入的模型在列表里带「本机导入」标记，信息卡上有「✕ 删除这个模型」。清单写在 `assets/imported/index.json`。

## 宿主接口

前缀 `/api/models`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 存活与版本 |
| GET | `/manifest` | 内置 + 导入模型清单（含三角面/材质/节点统计） |
| GET | `/blender` | 本机 Blender 探测结果 `{found, path}` |
| POST | `/import?name=` | 原始 GLB 字节，校验 `glTF` magic |
| POST | `/import-blend` | JSON `{path}`，调 Blender 转 GLB |
| DELETE | `/import?id=` | 删除导入模型 |
| GET | `/assets/*` | 模型/缩略图静态文件（支持 Range/ETag） |

## 目录

```
dsh-models-3d/
├── lib/index.js           宿主路由、导入、Blender 调用
├── lib/client.js          侧栏入口 + 展厅 + 导入弹窗
├── lib/blender_export.py  无头导出脚本
├── assets/models/*.glb    四座内置模型
├── assets/thumbs/*.png    缩略图
├── assets/imported/       导入的模型与 index.json
└── locale/{zh,en}.json    插件元信息
```

## License

MIT
