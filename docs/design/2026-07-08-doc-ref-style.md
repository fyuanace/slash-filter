---
type: design-change
project: fhelper
module: doc-ref-style
date: 2026-07-08
status: superseded
summary: >
  原「文档引用美化」已改为「子文档引用美化」：不再装饰全部文档块引用，
  只控制自动子文档导航引用的样式。现行说明见 child-nav-body-refs。
related:
  - docs/design/2026-07-09-child-doc-index.md
  - docs/design/2026-09-02-child-nav-body-refs.md
tags:
  - doc-ref
  - protyle
  - cache
---

# 文档引用美化

## 变更记录

| 时间 | 说明 |
|------|------|
| 2026-07-08 | 初版：开关、批量 SQL 分类、CSS 装饰、生命周期与 ws 增量同步 |
| 2026-07-08 | 按文档分桶缓存；关 Tab 清分桶；切换缓存命中零 SQL；createdoc dirty / 防抖重建 |
| 2026-07-09 | 编辑韧性：已有 id 不清缓存；class 变更与 50ms 防抖补标，避免回车丢样式 / 图标倍增 |
| 2026-09-02 | 开关改名为「子文档引用美化」；不再装饰全部文档引用，只控制自动导航引用样式。现行方案见 [2026-09-02-child-nav-body-refs.md](2026-09-02-child-nav-body-refs.md) |

## 背景信息

希望文档块引用在编辑器中更易辨认：显示下划线与文档图标，目标删除后显示删除线；非文档块引用保持思源原生。样式层不得误用引用标记上的 `subtype === "d"`（动态锚文本）当作「目标是文档」。

## 当前方案

本文记录的「全部文档块引用打标」方案已停止使用。设置项 `docRefStyle.enabled` 仍保留，界面名为「子文档引用美化」，只控制带 `custom-fhelper-child-nav` 的自动引用外观。

现行数据模型、选择器与验收见 [2026-09-02-child-nav-body-refs.md](2026-09-02-child-nav-body-refs.md)。

## 其他模块引用约束

- 不要再假定本开关会给任意文档块引用加上 `fhelper-doc-ref*` class。
- 自动导航引用的识别仍只看 `custom-fhelper-child-nav`。

## 工程师测试验收方法

验收改走 [2026-09-02-child-nav-body-refs.md](2026-09-02-child-nav-body-refs.md)。

## 其他说明

本文 `status: superseded`。重大版本演变见 [docs/CHANGELOG.md](../CHANGELOG.md)。
