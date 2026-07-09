# 文档引用美化 — 功能与变更汇总

**插件：** fhelper  
**版本：** 1.8.0 → 1.8.2  
**日期：** 2026-07-08 ~ 2026-07-09

---

## 新增功能

### 文档引用美化（`docRefStyle.enabled`）

在 **设置 → 通用 → 输入 / 引用** 中新增开关「文档引用美化」。

启用后：

| 引用目标 | 视觉效果 |
|----------|----------|
| 文档块（`blocks.type = 'd'`） | 下划线 + 文档图标（无图标时 📄） |
| 段落 / 标题等其它块 | 不处理，保持思源原生 |
| 目标已删除 / 不存在 | 删除线 + 默认 📄 |

其它行为：

- 引用作为**原子单元**（`contenteditable="false"`），不可半截编辑
- 修改文档图标 → 已打开编辑器内引用同步
- 删除 / 恢复文档 → 引用样式自动切换
- `/新建子文档并引用` → 父文档引用在写入后自动刷新

---

## 版本迭代

### v1.8.0 — 初版

- 配置项 `docRefStyle.enabled`、中英文 i18n
- 批量 SQL 查询目标块类型与 IAL 图标
- CSS 类：`fhelper-doc-ref` / `fhelper-doc-ref-broken`
- 图标通过 `::before` + `data-fhelper-icon` 渲染（无 DOM 子节点）
- 生命周期：`loaded-protyle-static` / `dynamic` / `switch-protyle` / `destroy-protyle`
- MutationObserver 监听新引用
- `ws-main` 窄范围增量同步（`removedoc`、`setblockattrs`、undo/redo 等）

### v1.8.1 — 按文档分桶缓存

**问题：** 全局缓存 + 每次切换强制刷新导致闪烁；关文档后缓存陈旧；`/新建子文档并引用` 易显示删除线。

**改动：**

- `docRefByDoc`：按文档 `rootId` 分桶缓存目标元数据
- `destroy-protyle`：关闭 Tab 时清除该文档缓存
- `switch-protyle`：缓存命中时零 SQL，只补 class
- `docRefDirtyDocs`：后台 `createdoc` 等变更标记待重建
- `createdoc` WebSocket：解析父文档，已开则防抖 150ms 重建
- 取消乐观 `pending` 渲染；查不到即 broken，新引用短重试 `[100, 300, 800, 1500]` ms

### v1.8.2 — 编辑韧性修复

**问题：** 在引用块附近按回车，Observer 将已有引用误判为「新引用」，触发 `clearDocRefCacheForDoc` + 全量重建，样式丢失；早期版本还存在图标倍增。

**改动：**

- `handleNewBlockRefs`：缓存已有 `data-id` 时直接补样式，**不再清空缓存**
- 仅对缓存中不存在的新 `data-id` 调用 `populateDocRefCache`
- `scheduleRestoreDocRefDecorations`：编辑后 50ms 防抖扫描，补回丢失的 class
- 引用块内部 `class` 属性变更也触发 `reapplyDocRefIfClassLost`

---

## 涉及文件

| 文件 | 变更 |
|------|------|
| `index.js` | 查询 / 装饰 / 缓存 / Observer / ws 全链路 |
| `plugin.json` | 版本 1.8.2，描述与 keywords |
| `i18n/zh_CN.json` | 开关标题与说明 |
| `i18n/en_US.json` | 同上英文 |
| `docs/superpowers/specs/2026-07-08-doc-ref-style-design.md` | 设计说明 |
| `docs/superpowers/plans/2026-07-08-doc-ref-style.md` | 实现计划 |
| `docs/superpowers/specs/2026-07-08-doc-ref-style-changelog.md` | 本文档 |

---

## 核心数据结构

```javascript
// 按文档分桶
docRefByDoc: Map<rootId, Map<targetId, { exists, isDoc, icon }>>
docRefDirtyDocs: Set<rootId>
docRefObservers: Map<wysiwygElement, MutationObserver>
docRefRebuildTimers: Map<rootId, timer>      // 重建防抖 150ms
docRefRestoreTimer: Map<rootId, timer>       // 补标防抖 50ms
docRefRetryTimers: Map<"rootId:targetId", timers[]>
```

---

## 关键 API / 常量

| 名称 | 说明 |
|------|------|
| `DOC_REF_CLASS` | `fhelper-doc-ref` 文档引用 |
| `DOC_REF_BROKEN_CLASS` | `fhelper-doc-ref-broken` 失效引用 |
| `queryBlockMetaByIds` | `SELECT id, type, ial FROM blocks WHERE id IN (...)` |
| `rebuildDocRefCacheAndDecorate` | 清空分桶 → 扫 DOM → SQL → 装饰 |
| `reapplyFromDocCache` | 切换 Tab 快路径，零 SQL |
| `decorateDynamicRefs` | 懒加载区增量装饰 |
| `handleCreatedocSignal` | 新建子文档后刷新父文档缓存 |

---

## 使用说明

1. 设置 → 集市 → 重载 fhelper（或重启思源）
2. 打开 fhelper 设置 → 通用 → 开启「文档引用美化」
3. 文档中的块引用将按目标类型自动渲染；关闭开关后样式与监听全部移除，笔记内容不变

---

## 已知限制

- 样式层不干预非文档块引用
- 不替代思源动态锚文本的标题同步
- 超大文档若已懒加载大量 DOM，编辑后补标扫描成本随**已加载 DOM 规模**上升，与引用个数关系不大（通常引用很少时仍可忽略）
