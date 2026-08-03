---
type: design-change
project: fhelper
module: child-nav
date: 2026-08-04
status: implemented
summary: >
  正文子文档导航与 DOM 导航植入查子文档必须仅用 SQL；禁止对可能无子文档的
  路径调用 listDocsByPath，避免内核因缺少磁盘文件夹报错。
related:
  - docs/design/2026-07-09-child-doc-index.md
tags:
  - body-nav
  - child-nav
  - sql
  - filetree
---

# 正文 / 植入导航：子文档查询仅 SQL

## 变更记录

| 时间 | 说明 |
|------|------|
| 2026-08-04 | 固化约束：body nav / child nav widget 仅 SQL；索引批处理可继续用 listDocsByPath |

## 背景信息

思源里，**没有子文档的文档不会在磁盘上生成对应文件夹**。若对该路径调用 `POST /api/filetree/listDocsByPath`，内核可能弹出「找不到指定文件」类错误并打断体验。正文导航常对「当前文档是否有子文档」未知，不能用文件树 API 探活。

## 当前方案

| 场景 | 查子文档方式 |
|------|----------------|
| 正文子文档导航（body nav） | **仅 SQL**（`blocks` + `path`） |
| DOM 子文档导航植入（child nav widget） | **仅 SQL** |
| 子文档索引批量建立（child doc index） | 可用 `listDocsByPath`（需与文档树排序一致；调用方接受无文件夹时的失败 / 空结果） |

正文导航无子文档时：仍可保留文首 `---` 起止分割线；区间内不插入引用即可，**不得**为探活调用 `listDocsByPath`。

工程锚点：`queryDirectChildDocsForBodyNav` / `queryChildNavDescendants` / `buildChildNavTree` 为 SQL only；`queryDirectChildDocs` 留给索引等场景，勿在 body nav 热路径调用。

## 其他模块引用约束

- 新增「展示向」子文档列举（编辑器内面板、正文同步）必须默认 SQL；若确需 `listDocsByPath`，须先保证路径对应文件夹存在或吞掉 / 隔离错误，且不得放在 body nav 热路径。
- 子文档索引可继续用文件树 API，但不得被导航模块直接复用为「是否有子」判断。

## 工程师测试验收方法

1. 打开无子文档的文档：正文导航 / 植入不弹 `listDocsByPath` 找不到文件错误  
2. 有子文档时：SQL 路径能列出与预期一致的直接子文档  
3. 子文档索引全局批处理仍可按文档树顺序工作（与本约束分流）

## 其他说明

原 `docs/dev-notes.md` 已并入本文并删除散落笔记文件。
