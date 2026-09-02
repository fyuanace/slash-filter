---
type: design-change
project: fhelper
module: child-nav
date: 2026-09-02
status: superseded
summary: >
  子文档导航在 YAML frontmatter 之后自动挂载；夹缝备注与显示顺序存在文档属性；拖动排序不改侧栏。
related:
  - docs/design/2026-09-02-child-nav-body-refs.md
  - docs/design/2026-08-31-child-nav-box-doc.md
  - docs/design/2026-08-04-child-nav-body-sql.md
tags:
  - child-nav
  - layout
  - yaml
---

# 子文档导航：YAML 后挂载、夹缝备注与显示顺序

## 变更记录

| 时间 | 说明 |
|------|------|
| 2026-09-02 | 打开文档自动挂载；有 YAML 则插在闭合 `---` 之后；备注与显示顺序写入文档自定义属性；拖动只改面板顺序 |
| 2026-09-02 | 仅展示当前层子文档；备注按需插入为可编辑段落；细边框；左侧 gutter 悬浮显示加号与拖动手柄，不撑开行高 |

## 背景信息

导航面板原先固定插在整块 wysiwyg 之前，有 YAML frontmatter 时视觉上会压在 YAML 上面。条目之间也没有可持久化的说明文字。需要在不写入正文块、不影响 MCP `read_note` 的前提下，把面板放到正文起始处（YAML 之后），并支持夹缝备注与显示顺序。

## 当前方案

面板仍是编辑器 DOM 植入（`contentEditable=false`，无 `data-node-id`），不 `appendBlock`、不插 iframe。

挂载锚点取 `.protyle-wysiwyg` 顶层块纯文本：若第一块是 `---`，则找到下一个 `---`，把 host 插在该闭合块之后；否则插在正文第一个块之前。文档重载后重新探测。

显示顺序与夹缝备注存在当前文档属性 `custom-fhelper-child-nav-layout`。默认同步只列出当前层子文档；备注不自动占位，由行左侧 gutter 的「+」或右键菜单插入，编辑面是可编辑段落（仍写入属性，不是正文块）。拖动只改面板顺序，不调用文件树 `changeSort`。

面板有细边框、左对齐。拖动手柄与添加按钮放在条目左侧 gutter（对齐思源正文块），悬浮才显示，不占内容宽度、不改变行高。`childDocWidget.enabled` 默认开启。高度用 `ResizeObserver` 清掉临时 `minHeight`。

## 其他模块引用约束

- 查子文档仍仅 SQL，禁止对可能无文件夹的路径调用 `listDocsByPath`。
- 顶层笔记本文档仍按虚拟父子列举（见 box-doc 设计）。
- 备注与顺序不是正文，MCP / `read_note` 不应读到挂件 HTML 或夹缝备注。
- YAML frontmatter 仍是正文；挂件不改写、不夹进 YAML 中间。

## 工程师测试验收方法

1. 有 YAML 的文档：面板出现在第二个 `---` 下面，不夹在 frontmatter 里。
2. 无 YAML：面板在正文最上。
3. 拖排序后侧栏顺序不变；刷新后面板顺序与备注仍在。
4. 新建/删除子文档后合并正确；顶层笔记本文档仍可列子文档。
5. 备注变高后面板无长期空白占位。

## 其他说明

已被 [2026-09-02-child-nav-body-refs.md](2026-09-02-child-nav-body-refs.md) 替代：改为正文自动引用块，不再使用 DOM 挂件与夹缝备注。
