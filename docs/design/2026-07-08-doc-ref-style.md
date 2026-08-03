---
type: design-change
project: fhelper
module: doc-ref-style
date: 2026-07-08
status: implemented
summary: >
  仅对引用目标为文档块的块引用做样式增强（下划线、文档图标、失效删除线），
  按文档分桶缓存 + Observer / 窄范围事件增量刷新；关闭开关不改写引用内容。
related:
  - docs/design/2026-07-09-child-doc-index.md
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

## 背景信息

希望文档块引用在编辑器中更易辨认：显示下划线与文档图标，目标删除后显示删除线；非文档块引用保持思源原生。样式层不得误用引用标记上的 `subtype === "d"`（动态锚文本）当作「目标是文档」。

## 当前方案

### 关键澄清：两处「d」

| 位置 | 字段 | 含义 |
|------|------|------|
| 引用标记 | `TextMarkBlockRefSubtype` / DOM `data-subtype` | `d` = 动态锚文本；`s` = 静态 |
| 被引用目标 | `blocks.type`（按引用目标 ID 查询） | `d` = 文档块；其它 = 非文档 |

**禁止**用 `subtype === "d"` 判断是否为文档；**必须**查目标块类型。本功能不负责标题同步（思源动态引用已处理），只负责样式。

### 用户可见规则

对每个 `span[data-type~="block-ref"]`：读 `data-id` → 查存在性 / 类型 / 图标 →

| 查询结果 | 样式 |
|----------|------|
| 存在且 `type = 'd'` | 下划线 + 文档图标（无自定义 → 默认 📄） |
| 存在且非文档 | 不处理 |
| 不存在 / 已删除 | 删除线（无下划线、无文档图标） |

原子交互：已装饰引用倾向 `contenteditable="false"`，整条删除。图标用 CSS `::before` + `data-fhelper-icon` / `data-fhelper-icon-img`，不插入独立图标 DOM 节点。

### 架构

编辑器加载批量查询 + DOM 打标；MutationObserver 补新节点；窄范围事件增量同步。

```
开关开启 → 注入 CSS → 加载扫 ref 批量查询打标
         → Observer 增量；icon / 删除 / 恢复 / createdoc 按 ID 更新
开关关闭 → 卸 CSS、摘标记、关监听、清缓存
```

缓存（按文档分桶）：

```
docRefByDoc: Map<docRootId, Map<targetId, { exists, isDoc, icon }>>
docRefDirtyDocs: Set<rootId>
```

| 时机 | 行为 |
|------|------|
| `destroy-protyle` | 清该文档分桶 + 卸 observer |
| `loaded-protyle-static` | 新建分桶 → 全量 SQL → 装饰 |
| `loaded-protyle-dynamic` | 仅查缓存缺失 id |
| `switch-protyle` | 缓存命中且非 dirty → 只读补 class；否则重建 |
| `createdoc` | 父文档已开则 dirty + 150ms 防抖重建；未开则 dirty |

新引用短重试：`[100, 300, 800, 1500]` ms。编辑后 `scheduleRestoreDocRefDecorations`（50ms）补回丢失 class；Observer **禁止**对已有引用误清分桶。

### 配置

- 设置 → 通用 →「输入 / 引用」：`文档引用美化`
- 字段：`docRefStyle.enabled`（默认 `false`）

### 非目标

不为非文档引用加本套样式；不用 subtype 判文档；首版无自定义下划线主题编辑器；关闭时不删除笔记中的引用数据。

## 其他模块引用约束

- 写入标准文档块引用后（如子文档索引），只要本开关开启，由现有 `loaded-protyle-*` / Observer / `createdoc` 链路自动装饰，写入方无需单独通知。
- 其它模块不得依赖引用 DOM 上的 `fhelper-doc-ref*` class 作为业务数据；开关关闭后这些标记会消失。

## 工程师测试验收方法

1. 文档引用：下划线 + 图标；删文档图标后为 📄  
2. 段落 / 标题引用：与原生一致  
3. 目标删除 → 删除线；回收站恢复 → 文档样式恢复  
4. 改图标：已开文档内引用同步；改标题：锚文字由思源更新，样式仍在  
5. Backspace / Delete：整条引用删除  
6. 关开关：样式与监听消失，引用内容完好  
7. 引用附近回车：样式不丢、图标不倍增  
8. Tab 切换 / 关开：样式正确、无明显闪烁；`/新建子文档并引用` 写入后可刷新

## 其他说明

重大版本演变见 [docs/CHANGELOG.md](../CHANGELOG.md)。
