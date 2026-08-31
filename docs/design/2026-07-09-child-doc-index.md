---
type: design-change
project: fhelper
module: child-doc-index
date: 2026-07-09
status: superseded
summary: >
  在父文档正文末尾增量追加直接子文档的标准动态块引用；只处理一层父子；
  已有引用按 refs 表跳过；与文档引用美化兼容。
related:
  - docs/design/2026-07-08-doc-ref-style.md
  - docs/design/2026-08-04-child-nav-body-sql.md
tags:
  - child-index
  - filetree
  - refs
---

# 子文档索引

## 变更记录

| 时间 | 说明 |
|------|------|
| 2026-07-09 | 定稿：一层直接子、标准 `((id 'title'))`、refs 增量、文件树 API、全局 / 当前文档入口 |
| 2026-08-31 | 功能已移除，由子文档导航植入承担列举；见 [2026-08-31-child-nav-box-doc.md](2026-08-31-child-nav-box-doc.md) |

## 背景信息

父子文档层级较深时，父文档需要快速跳到直接子文档。自动在父文档末尾补全缺失的子文档块引用，形成「子文档索引」，且不嵌套展开、不重复写入已有引用。

## 当前方案

### 不嵌套规则

只写入**直接子文档**（与侧栏文档树一致）。通过官方文件树 API（`getPathByID` + `listDocsByPath`）获取，**不**用 SQL `blocks.parent_id`（那是块树父子）。

示例 `A → B → C → D`：A 只索引 B；B 只索引 C；无子文档则不写入。

### 索引内容格式

每个缺失子文档在父文档末尾追加一个段落，Kramdown：

```text
((<子文档块ID> '<子文档标题>'))
```

写入：`POST /api/block/appendBlock`，`dataType: "markdown"`，`parentID` 为父文档块 ID。

明确不做：不插「子文档索引」标题；不默认用列表包裹；不传 AST JSON；不修改已存在引用的锚文本。

### 增量检测

按子文档块 ID，查 `refs`：

```sql
SELECT def_block_id FROM refs WHERE root_id = '<父文档块ID>'
```

已存在则跳过；缺失则 append。用户删掉某条后下次会补回；标题已改但引用仍在时不更新。

### 入口与配置

- 设置 → 通用 →「子文档索引」：全局 / 按笔记本批处理（确认、进度、可取消、汇总）
- 编辑器工具栏按钮 + 命令：对当前文档增量同步
- 配置：`childDocIndex`（如 `sortBy`、`scope`、`notebookIds`、`batchConcurrency` 等；实现以当前 `fhelper-config.json` 为准）

### 与引用美化

本功能只负责写入标准块引用；若 `docRefStyle.enabled`，由引用美化链路自动装饰。

### 非目标

不递归孙文档；不删除 / 重排用户已有索引引用；不为无子文档写空占位；不替代文档树导航。

## 其他模块引用约束

- **导航植入**不得复用本模块的 `listDocsByPath` 热路径；无子文档时该 API 可能因磁盘无文件夹报错。分流见 [2026-08-04-child-nav-body-sql.md](2026-08-04-child-nav-body-sql.md)。
- 索引写入的是普通动态块引用，其它模块应按普通 `block-ref` 处理，勿假设存在特殊 IAL。

## 工程师测试验收方法

1. `A→B→C`：对 A 仅得 B 的引用；对 B 仅得 C  
2. 已有引用再执行不重复；手动删除后再执行只补被删项  
3. 无子文档：提示且不写入  
4. 全局批处理：有直接子文档的父均被处理，汇总数字正确  
5. 写入引用与手工 `((` 一致；开启 docRefStyle 时自动下划线 + 图标

## 其他说明

功能已于 2026-08-31 移除。现行列举方案见 [2026-08-31-child-nav-box-doc.md](2026-08-31-child-nav-box-doc.md)。
