---
type: design-change
project: fhelper
module: child-nav
date: 2026-08-04
status: implemented
summary: >
  子文档导航植入查子文档必须仅用 SQL；禁止对可能无子文档的路径调用
  listDocsByPath，避免内核因缺少磁盘文件夹报错。
related:
  - docs/design/2026-08-31-child-nav-box-doc.md
  - docs/design/2026-07-09-child-doc-index.md
tags:
  - child-nav
  - sql
  - filetree
---

# 导航植入：子文档查询仅 SQL

## 变更记录

| 时间 | 说明 |
|------|------|
| 2026-08-04 | 固化约束：导航展示仅 SQL，禁止用 listDocsByPath 探活 |
| 2026-08-31 | 子文档索引已移除；顶层笔记本文档改用逻辑父子 |
| 2026-08-31 | 正文子文档导航已废弃，本文只约束现行导航植入 |

## 背景信息

思源里，**没有子文档的文档不会在磁盘上生成对应文件夹**。若对该路径调用 `POST /api/filetree/listDocsByPath`，内核可能弹出「找不到指定文件」类错误并打断体验。导航植入打开任意文档时，是否有子文档事先未知，不能用文件树 API 探活。

曾有过「把子文档列表写进正文」的方案（文首区间 / 带标记的块），已废弃，不再作为模块。

## 当前方案

| 场景 | 查子文档方式 |
|------|----------------|
| 子文档导航植入（`childDocWidget`） | **仅 SQL**；顶层笔记本文档按虚拟父子，不按 `/<boxID>/` 物理前缀 |
| 删除未引用等文档树辅助 | 可用 `listDocsByPath`；笔记本根文档用路径 `/`，并排除笔记本自身 |

工程锚点：`queryChildNavDescendants` / `buildChildNavTree` 为 SQL only；`queryDirectChildDocs` 仅用于删除未引用等文档树辅助，勿在导航热路径调用。

## 其他模块引用约束

- 新增「展示向」子文档列举（编辑器内面板）必须默认 SQL；若确需 `listDocsByPath`，须先保证路径对应文件夹存在或吞掉 / 隔离错误，且不得放在导航热路径。
- 导航模块不得把 `listDocsByPath` 当作「是否有子」判断；无文件夹时该 API 可能报错。
- 已移除的子文档索引、正文子文档导航不得再恢复为导航热路径。

## 工程师测试验收方法

1. 打开无子文档的文档：植入面板不弹 `listDocsByPath` 找不到文件错误
2. 有子文档时：SQL 路径能列出与预期一致的直接子文档
3. 顶层笔记本文档能列出根层子文档（见 box-doc 设计）

## 其他说明

无。
