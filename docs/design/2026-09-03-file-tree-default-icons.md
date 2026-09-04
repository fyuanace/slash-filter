---
type: design-change
project: fhelper
module: file-tree
date: 2026-09-03
status: implemented
summary: >
  设置里可配置笔记本、有子文档的文档、没有子文档的文档的默认图标，
  走思源图标选择器，可还原为官方默认；写入思源 local-images，不写进文档属性。
related:
  - docs/design/2026-09-02-child-nav-body-refs.md
tags:
  - file-tree
  - icon
---

# 文档树默认图标

## 变更记录

| 时间 | 说明 |
|------|------|
| 2026-09-04 | 未设图标的自动引用：SVG 模式跟 cursorart，用官方 `#iconFile` 描边 mask（`stroke #000`）；设置里三项 emoji 在 SVG 模式下标明不生效。 |
| 2026-09-03 | 设置「默认图标」三项：笔记本 / 有子文档 / 无子文档；点图标打开思源选择器；旁路还原 |

## 背景信息

思源文档树对未单独设图标的项使用 `storage["local-images"]`：`note`、`folder`、`file`。没有设置入口，只能改存储。需要在插件设置里用官方图标选择器改这三项，并能还原。

## 当前方案

设置 → 通用 →「默认图标」三行，分别对应：

- 笔记本 → `note`（官方默认 `1f5c3`）
- 有子文档的文档 → `folder`（官方默认 `1f4d1`）
- 没有子文档的文档 → `file`（官方默认 `1f4c4`）

点左侧图标调用插件 API `openEmoji`（思源选择器）。选中后写入 `/api/storage/setLocalStorageVal`，同时更新 `window.siyuan.storage["local-images"]`。不写笔记本或文档的 `icon` 属性，已自定义图标的项不变。选择器清空时按该项官方默认处理。

思源「文档树 → 默认图标使用 SVG」（`fileTree.useSVGDefaultIcon`）开启时，文档树改用官方 SVG（笔记本 `#iconNotebook`、有子文档 `#iconFileText`、无子文档 `#iconFile`），不再读 `local-images`。插件设置里三项 emoji 此时禁用并说明原因。未设自定义图标的自动文档引用同样改用 `#iconFile`，画法对齐 cursorart（描边 data URI + `currentColor` mask），不必先关掉该选项。

「还原」把该项写回上述官方默认。改完后把文档树里仍显示旧默认图标的节点换成新图标，并刷新自动导航引用的默认文档图标。

不把这三项存进 `fhelper-config.json`，以免和思源存储两套真相。

## 其他模块引用约束

- 未单独设图标时：若思源开启 SVG 默认图标，自动引用用官方 `#iconFile`；否则读 `local-images.file`。
- 不要给文档 IAL 批量写 `icon` 来充当默认图标。

## 工程师测试验收方法

1. 设置里三项显示当前默认图标；点图标弹出思源选择器，选定后文档树中未自定义图标的对应项立即更换。
2. 已单独设过图标的笔记本/文档不受影响。
3. 点还原后该项回到官方默认，文档树同步。
4. 关掉插件设置对话框再打开，三项仍是刚选的值。

## 其他说明

无。
