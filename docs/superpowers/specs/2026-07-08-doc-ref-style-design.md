# fhelper 文档引用美化 — 设计说明

日期：2026-07-08  
状态：**已实现**（v1.8.2）  
范围：并入现有插件 `fhelper`，通用 Tab 增加开关

## 1. 背景与目标

启用后，仅对「引用目标为**文档块**」的块引用做样式增强：

- 下划线
- 显示该文档自身图标（删除自定义图标后回落默认 📄）
- 图标变更后，已打开编辑器内对应引用同步更新
- 目标文档被删除时改为删除线样式；文档恢复后恢复文档引用样式
- 已样式化的引用作为原子单元：不可半截编辑，删除即删整条引用

关闭开关：去掉样式与监听，不改写引用内容本身。

## 2. 关键澄清：两处「d」

| 位置 | 字段 | 含义 |
|------|------|------|
| 引用标记 | `TextMarkBlockRefSubtype` / DOM `data-subtype` | `d` = **动态**锚文本；`s` = **静态** |
| 被引用目标 | `blocks.type`（按 `TextMarkBlockRefID` / `data-id` 查询） | `d` = **文档块**；`p`/`h`/… = 其它块类型 |

**禁止**用引用上的 `subtype === "d"`（或「引用多半是 d」）判断是否为文档。  
**必须**用引用目标 ID 查询结果判断。

思源动态引用会在文档改名时自动同步锚文字；本功能**不**负责标题同步，只负责样式层（下划线 / 图标 / 删除线）。

## 3. 用户可见规则

对每个 `span[data-type~="block-ref"]`：

1. 读取 `data-id`
2. 查询目标块是否存在及其类型 / 文档图标
3. 分类渲染：

| 查询结果 | 样式 | 说明 |
|----------|------|------|
| 存在且 `type = 'd'` | 下划线 + 文档图标 | 无自定义 icon → 默认 📄 |
| 存在且 **不是** 文档 | **不处理** | 保持思源原生 |
| ID 不存在 / 已删除 | **删除线**（无下划线、无文档图标） | 失效引用 |

### 原子交互

- 对象是**整条块引用**（该 `block-ref` 节点），不是整段段落
- 倾向：`contenteditable="false"`（或等价）包裹已处理引用
- 选中 / Backspace / Delete：整条引用一起删除，不可编辑半截锚文本

### 图标回落

- 文档删除自定义图标 → 引用处显示默认 📄（仍保留下划线）

### 图标实现

- 使用 CSS `::before` + `data-fhelper-icon` / `data-fhelper-icon-img` 属性
- **不**向 DOM 插入独立图标子节点，避免回车 / 删除时图标倍增

## 4. 架构（方案 A）

采用「编辑器加载批量查询 + DOM 打标」为主，「轻量 MutationObserver」补新节点，「窄范围事件」做增量同步。

```
开关开启
  → 注入 CSS（文档引用 / 失效引用）
  → 编辑器加载：扫描可见 ref → 批量查 ID → 打标 + 图标
  → MutationObserver：新 ref 增量查库；已有 ref 从缓存补标
  → 事件：icon 变 / 文档删除 / 文档恢复 / createdoc → 按 ID 增量更新
开关关闭
  → 卸 CSS、摘标记、关监听、清缓存占用
```

### 缓存（v1.8.0 → v1.8.2，按文档分桶）

```
docRefByDoc: Map<docRootId, Map<targetId, { exists, isDoc, icon }>>
docRefDirtyDocs: Set<rootId>   // 后台变更、关 Tab 后待重建
```

| 元数据 | 含义 |
|--------|------|
| `exists=false` | 失效引用 → 删除线 + 默认 📄 |
| `exists=true && isDoc=true` | 文档引用样式 |
| 其它 | 不装饰，保持思源原生 |

**生命周期：**

| 时机 | 缓存行为 |
|------|----------|
| `destroy-protyle`（关 Tab） | **清除**该文档分桶 + 卸 observer |
| `loaded-protyle-static` | 新建分桶 → 全量 SQL → 装饰 |
| `loaded-protyle-dynamic` | 仅查缓存缺失 id → 装饰懒加载区 |
| `switch-protyle` | 有缓存且非 dirty → **只读缓存**补 class；否则重建 |
| `createdoc`（父文档已开） | 标 dirty / 防抖 150ms 重建父文档 |
| `createdoc`（父文档未开） | 标 dirty，下次打开再重建 |

新建引用短重试：`[100, 300, 800, 1500]` ms（应对 SQL 尚未写入的窗口期）。

### 事件与刷新范围（窄）

| 事件 | 行为 |
|------|------|
| `loaded-protyle-static` | 扫 DOM → 批量 SQL → 装饰当前文档 |
| `loaded-protyle-dynamic` | 仅对缓存缺失 id 批量 SQL；装饰懒加载区 |
| `switch-protyle` | 缓存命中：零 SQL，补 class；无缓存 / dirty：重建 |
| `destroy-protyle` | 卸 observer + **清除该文档分桶** |
| `removedoc` | 即时标 broken，刷新所有已开文档匹配 ref |
| `createdoc` | 解析父文档 → 开则防抖重建，未开则标 dirty |
| `setblockattrs` / undo-redo | 更新相关 id 元数据并刷新匹配 ref |
| `ws-main` transactions | 防抖 150ms；仅处理与已开引用目标 id 交集 |

**不做**：任意属性变更即重扫所有打开文档全文。

### DOM 刷新韧性（v1.8.2）

思源在回车拆段、动态锚文本更新时可能重建引用节点或剥离 class。

| 机制 | 作用 |
|------|------|
| Observer 检测 `class` 变更 | 对已有 `data-id` 从缓存即时补标 |
| `handleNewBlockRefs` | **仅**对缓存中不存在的 id 查 SQL；已有 id 直接 `applyDocRefDecoration` |
| `scheduleRestoreDocRefDecorations`（50ms 防抖） | 编辑后全文档扫描，补回丢失的 class |
| **禁止**在 Observer 里对已有引用误触发 `clearDocRefCacheForDoc` | 避免回车导致样式短暂或永久丢失 |

## 5. 设置与配置

- 位置：`fhelper` 设置 → **通用** Tab → 「输入 / 引用」分区
- 开关：`文档引用美化` / `Document ref styling`
- 配置字段：`docRefStyle.enabled`（布尔，默认 `false`）
- 持久化：`fhelper-config.json`，加载时兼容缺省字段

## 6. 性能说明

开销与**引用数量**和**当前 DOM 已加载节点数**相关，与文档块总数（数据库）无直接关系。

| 场景 | 预期 |
|------|------|
| Tab 切换（缓存命中） | DOM 扫描 + 补 class，无 SQL，通常 &lt; 5ms |
| 首次打开 / 关 Tab 后再开 | 按引用 id 数批量 SQL（每批 ≤200） |
| 大文档 + 少量引用（如 6 个） | SQL 极轻；DOM 扫描随思源懒加载规模，未滚完全文时几乎无感 |
| 编辑（回车 / 输入） | 50ms 防抖补标，不触发全量重建 |

## 7. 非目标

- 不为段落 / 标题等非文档引用加本套样式
- 不用 `subtype=d` 作为文档判断
- 不实现自定义下划线色系主题编辑器（首版固定主题变量即可）
- 不在关闭时删除用户笔记中的引用数据

## 8. 风险与对策

| 风险 | 对策 |
|------|------|
| 大文档大量引用 | 批量查询 + 懒加载区增量；SQL 按 id 数而非块总数 |
| 动态锚文本 / 回车冲掉样式 | Observer 补标 + 防抖全量补回；不误清缓存 |
| 自定义图标格式 | 对齐思源 IAL icon；emoji / 自定义图 / 默认 📄 |
| `contenteditable=false` 与选区 | 整条引用原子删除 |
| `/新建子文档并引用` 过早查库 | createdoc 信号 + 短重试队列 |

## 9. 验收标准

1. 引用文档：有下划线 + 该文档图标；删文档图标后为 📄  
2. 引用段落 / 标题：外观与原生一致（本功能不干预）  
3. 引用目标删除后：该引用为删除线，无下划线 / 文档图标  
4. 文档从回收站恢复后：对应引用恢复文档样式  
5. 改文档图标：已打开文档中的引用图标同步  
6. 改文档标题：锚文字由思源更新；本功能样式仍在  
7. 对已样式化引用 Backspace / Delete：整条引用删除，非半截  
8. 关闭开关：样式与监听消失，引用内容完好  
9. 引用块附近按回车：样式不丢失、图标不倍增  
10. Tab 切换 / 关开文档：样式正确，无明显闪烁  

## 10. 实现落点

- 插件：`fhelper` v1.8.2
- 主要文件：`index.js`、`i18n/zh_CN.json`、`i18n/en_US.json`、`plugin.json`
- 实现计划：`docs/superpowers/plans/2026-07-08-doc-ref-style.md`
- 变更汇总：`docs/superpowers/specs/2026-07-08-doc-ref-style-changelog.md`
