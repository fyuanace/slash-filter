# fhelper 子文档索引 — 设计说明

日期：2026-07-09  
状态：**已实现**（v1.9.2）  
范围：并入现有插件 `fhelper`  
版本：v1.9.2

## 1. 背景与目标

在父子文档层级较深的笔记本中，父文档往往需要快速跳转到**直接子文档**。本功能自动检索文档树中的父子关系，在父文档**正文末尾**插入指向各直接子文档的**标准块引用**，形成「子文档索引」。

核心原则：

- 只处理**一层**父子关系，不嵌套展开
- 插入的是思源**标准块引用**（Kramdown 语法），不包装额外标题或列表结构
- **增量创建**：父文档中已存在对某子文档的引用则跳过，仅补全缺失项
- 与现有「文档引用美化」（`docRefStyle`）自然兼容：引用目标是文档块时会自动下划线 + 图标

## 2. 不嵌套规则

文档树示例：

```
A
└── B
    └── C
        └── D
```

| 父文档 | 索引应包含 | 不应包含 |
|--------|------------|----------|
| A | 对 B 的引用 | C、D |
| B | 对 C 的引用 | D |
| C | 对 D 的引用 | — |
| D | （无子文档，不写入） | — |

判定标准：文档树中的**直接子文档**（与侧栏文档树一致），通过官方文件树 API 获取，**不**使用 SQL `blocks.parent_id`（该字段表示块树父子，不是文档树父子）。

## 3. 索引内容格式

### 3.1 唯一合法形态

每个待补全的子文档，在父文档末尾追加**一个段落**，内容为动态块引用 Kramdown：

```text
((<子文档块ID> '<子文档标题>'))
```

示例：

```text
((20260709111200-rjqots3 '这是一个子目录'))
```

| 部分 | 含义 |
|------|------|
| `20260709111200-rjqots3` | 子文档块 ID（`type='d'` 的 `blocks.id`） |
| `'这是一个子目录'` | 子文档标题；单引号表示**动态锚文本**，与 UI 中 `((` 搜索后回车一致 |
| 落库结构 | 内核生成 `NodeParagraph` + `NodeTextMark(block-ref, subtype=d)`，与用户手工插入的引用块相同 |

### 3.2 明确不做

- 不插入 `## 子文档索引` 等标题块
- 不使用无序列表包裹（除非用户日后另行要求）
- 不向 API 传递 AST JSON（`.sy` 内部结构）；仅使用 `dataType: "markdown"`
- 不修改已存在引用的锚文本（标题变更后由思源动态引用机制自行同步）

### 3.3 写入 API

对每个**缺失**的子文档调用一次：

```http
POST /api/block/appendBlock
```

```json
{
  "dataType": "markdown",
  "data": "((20260709111200-rjqots3 '这是一个子目录'))",
  "parentID": "<父文档块ID>"
}
```

- `parentID`：父文档自身的块 ID（即该文档 `type='d'` 记录的 `id`）
- 多次调用按顺序追加到文档内容末尾
- 全局批处理时亦可合并为 `/api/transactions` 单次事务中的多个 `insert` 操作（可选优化）

## 4. 增量检测：已有则不创建

### 4.1 判定粒度

按**子文档块 ID**判断，而非按 Markdown 字符串全文匹配。

若父文档正文中已存在指向 `childId` 的块引用，则**跳过**该子文档，即使锚文本与当前标题不一致。

### 4.2 推荐实现：查询 `refs` 表

```sql
SELECT def_block_id
FROM refs
WHERE root_id = '<父文档块ID>'
```

得到集合 `existingRefIds`。对每个直接子文档 `child`：

```
if existingRefIds.has(child.id) → 跳过
else → appendBlock((child.id, child.title))
```

### 4.3 备选：扫描段落内容

当 `refs` 不可用或需兜底时，可查询父文档下段落块的 `markdown` / `content`，匹配 `((childId` 或 `data-id="childId"`。精度低于 `refs` 表，仅作备用。

### 4.4 行为汇总

| 场景 | 行为 |
|------|------|
| 引用已存在（同 def_block_id） | 不创建 |
| 引用不存在 | 在末尾追加 |
| 用户曾手动删除某条引用 | 下次执行会检测到缺失并补回 |
| 用户手写相同 ID 的引用 | 视为已存在，不重复 |
| 子文档标题已改 | 已有引用不更新（存在即跳过） |

## 5. 数据查询

### 5.1 查直接子文档（官方文档树 API）

1. `/api/filetree/getPathByID`：由文档 ID 得到 `{ notebook, path }`
2. `/api/filetree/listDocsByPath`：列出该路径下**一层**子文档

```json
{
  "notebook": "<笔记本ID>",
  "path": "/<父文档ID>",
  "sort": 15,
  "maxListCount": 0
}
```

- `path`：存储路径去掉 `.sy` 后的文件夹路径（如 `/20260709xxxx-abcdefg`）
- 返回 `data.files[]`：每项含 `id`、`name`/`name1`（标题）、`path`、`subFileCount`
- 与侧栏文档树一致，只返回直接子文档

### 5.2 全局 / 笔记本建立索引

1. 枚举目标笔记本（全部已打开，或下拉选中的一个）
2. 自笔记本根 `/` 起 BFS：对每个文档调用 `listDocsByPath` 取直接子文档
3. 仅对「有直接子文档」的父文档执行 §4 + §3
4. `subFileCount === 0` 时不再下探

### 5.3 标题转义

子文档标题若含单引号 `'`，须按 Kramdown 规则转义后再拼入字符串，避免解析失败。

## 6. 功能入口

### 6.1 全局建立索引（设置页）

- 位置：`fhelper` 设置 → **通用** Tab → 新区块「子文档索引」
- 控件：按钮「全局建立子文档索引」
- 交互：
  1. 点击后弹出二次确认（说明将扫描文档树并在各父文档末尾补全缺失引用）
  2. 执行过程中显示进度（已处理父文档数 / 总数、本次新增引用数）
  3. 支持取消（停止后续父文档，已写入保留）
  4. 结束展示汇总：处理父文档数、跳过已有引用数、新建引用数、失败数

### 6.2 当前文档索引（编辑器内）

- 位置：编辑器**工具栏**自定义按钮（`updateProtyleToolbar` / `protyleOptions.toolbar`）
- 图标建议：`iconList` 或 `iconFiles`
- 行为：对当前 protyle 的文档 `root_id`（文档块 ID）执行 §5.1 + §4 + §3
- 反馈：`showMessage` 提示「无子文档」/「已全部存在」/「已新增 N 条引用」

**首版不做面包屑注入**（DOM 易与思源重绘冲突）；若后续需要再单独立项。

### 6.3 命令（可选）

- `addCommand`：「为当前文档建立子文档索引」，与工具栏按钮共用同一处理函数

## 7. 配置

并入 `fhelper-config.json`：

```json
{
  "childDocIndex": {
    "sortBy": "tree",
    "scope": "all",
    "notebookIds": [],
    "batchConcurrency": 3
  }
}
```

| 字段 | 说明 | 默认 |
|------|------|------|
| `sortBy` | 子文档引用追加顺序：`tree`（文档树顺序，默认）/ `hpath` / `title` / `created` | `tree` |
| `scope` | 全局扫描范围：`all` / `selectedNotebooks` | `all` |
| `notebookIds` | `scope=selectedNotebooks` 时生效 | `[]` |
| `batchConcurrency` | 全局批处理并发写入上限 | `3` |

首版可固定 `sortBy=hpath`、`scope=all`，设置页仅暴露全局按钮。

## 8. 架构

```
用户触发（设置页 / 工具栏）
  → 解析父文档 ID（单文档）或分组 Map（全局）
  → SQL：直接子文档列表
  → SQL：refs 表已有 def_block_id
  → 差集 → 逐个 appendBlock(markdown)
  → showMessage / 进度 Dialog 汇总
```

与 `docRefStyle` 关系：

- 本功能只负责**写入**标准块引用
- 若 `docRefStyle.enabled`，写入后由现有 `loaded-protyle-*` / Observer / `createdoc` 链路自动装饰
- 全局批量写入时，未打开的文档下次打开时由 `loaded-protyle-static` 正常建缓存

## 9. 性能与风险

| 场景 | 说明 |
|------|------|
| 全局 1 万文档、500 个有子文档的父节点 | 1 次关系 SQL + 每父文档 1 次 refs 查询 + 按缺失数 append；写入分批、限并发 |
| 大文档正文很大 | 只 `appendBlock` 末尾，不扫描全文 DOM |
| 引用很少 | `refs` 查询轻量 |
| 笔记本只读 / 无权限 | 跳过并记入失败列表 |
| undo | 依赖思源事务，用户可撤销单次 append |

## 10. 非目标

- 不递归写入孙文档及更深层级
- 不删除、不排序用户已有的索引引用
- 不自动同步已存在引用的标题（存在即跳过）
- 不为无子文档的父文档写入空占位
- 不替代思源文档树本身的导航

## 11. 验收标准

1. `A→B→C` 结构下，对 A 执行后末尾仅有对 B 的 `((B的id 'B标题'))`，不含 C  
2. 对 B 执行后仅有对 C 的引用  
3. 父文档中已存在对某子文档的引用时，再次执行不重复追加  
4. 手动删除某条引用后，再次执行仅补回被删的那条  
5. 无子文档时提示「无子文档」，不写入任何内容  
6. 全局按钮：所有「有直接子文档」的父文档均被处理，汇总数字正确  
7. 写入的引用在编辑器中显示为标准动态块引用，与手工 `((` 创建一致  
8. 开启 `docRefStyle` 时，新建引用自动呈现下划线 + 文档图标  

## 12. 实现落点

| 文件 | 改动 |
|------|------|
| `index.js` | 查询、差集、append、设置按钮、工具栏按钮 |
| `i18n/zh_CN.json` / `en_US.json` | 文案 |
| `plugin.json` | 版本号、描述 |
| `docs/superpowers/plans/2026-07-09-child-doc-index.md` | 实现计划（设计确认后编写） |

### 核心函数（预告）

| 函数 | 职责 |
|------|------|
| `queryDirectChildDocs(parentId)` | `getPathByID` + `listDocsByPath` 查一层子文档 |
| `queryExistingRefTargets(rootId)` | SQL 查 refs.def_block_id |
| `escapeKramdownSingleQuoted(text)` | 标题单引号转义 |
| `buildChildDocRefMarkdown(childId, title)` | 生成 `((id 'title'))` |
| `syncChildDocIndexForDoc(parentId)` | 单父文档增量同步 |
| `runGlobalChildDocIndex(plugin)` | 全局批处理 + 进度 |
| `registerChildDocIndexToolbar(plugin)` | 工具栏按钮 |

---

**关联文档：** `docs/superpowers/specs/2026-07-08-doc-ref-style-design.md`（引用样式）
