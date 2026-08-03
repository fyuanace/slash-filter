# 重大设计 / 架构演变

记录方向性变化与模块级结论，不是完整 git log。

## 2026-07-08 ~ 2026-07-09 — 文档引用美化（v1.8.0 → v1.8.2）

- **初版**：按目标块类型装饰文档引用（下划线 + 图标）；失效引用删除线；原子单元；设置开关 `docRefStyle.enabled`。
- **按文档分桶缓存**：`docRefByDoc` / `docRefDirtyDocs`；关 Tab 清分桶；切换命中缓存零 SQL；`createdoc` 防抖重建；新引用短重试。
- **编辑韧性**：回车 / 动态锚文本重建节点时，Observer 对已有 `data-id` 只补标、不清缓存；50ms 防抖补回丢失 class。

详见 [design/2026-07-08-doc-ref-style.md](design/2026-07-08-doc-ref-style.md)。

## 2026-07-09 — 子文档索引（自 v1.9.x）

- 仅一层直接子文档；父文档末尾增量追加标准动态块引用 `((id 'title'))`。
- 已有引用按 `refs.def_block_id` 跳过；直接子文档与侧栏一致，用文件树 API，不用 `blocks.parent_id`。
- 入口：设置页全局 / 笔记本批处理；编辑器工具栏与命令处理当前文档。

详见 [design/2026-07-09-child-doc-index.md](design/2026-07-09-child-doc-index.md)。

## 正文导航 vs 索引 — 查子文档路径分流

- 正文子文档导航、DOM 导航植入：**仅 SQL** 查子文档，禁止对可能无文件夹的路径调用 `listDocsByPath`。
- 子文档索引批处理：可用 `listDocsByPath`，调用方接受无子文档时的失败 / 空结果。

详见 [design/2026-08-04-child-nav-body-sql.md](design/2026-08-04-child-nav-body-sql.md)。
