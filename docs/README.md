# fhelper 文档入口

思源笔记插件：斜杠菜单过滤、图片 DPI 缩放、中英文空格、文档引用美化、子文档导航植入、文档树辅助。

主入口：`index.js`；配置持久化：`fhelper-config.json`；文案：`i18n/zh_CN.json`、`i18n/en_US.json`。

## 模块地图

| 模块 | 配置键 | 说明 | 设计文档 |
|------|--------|------|----------|
| 斜杠过滤 | `disabled` | 按项禁用斜杠菜单命令 | — |
| 图片缩放 | `imageScale` | 图片 DPI / 居中等显示处理 | — |
| 中英文空格 | `panguSpacing` | 输入与粘贴时 CJK-Latin 自动空格 | — |
| 文档引用美化 | `docRefStyle` | 仅对**文档块**引用加下划线与图标；失效引用删除线 | [design/2026-07-08-doc-ref-style.md](design/2026-07-08-doc-ref-style.md) |
| 子文档导航植入 | `childDocWidget` | 编辑器内子文档树导航面板；顶层笔记本文档按虚拟父子列举；查子文档仅 SQL | [design/2026-08-31-child-nav-box-doc.md](design/2026-08-31-child-nav-box-doc.md) |
| 文档树辅助 | — | 定位、引用归集、删除未引用、一级更多菜单等 | — |

## 整体架构

```
设置 / 工具栏 / 命令
  → 各功能独立开关与生命周期（enable 时挂监听，disable 时卸 CSS/Observer/缓存）
  → 共用思源 API：fetchPost、eventBus、protyle、SQL / filetree

docRefStyle ←── 只读装饰：不改写引用内容
childDocWidget ←── 导航展示（仅 SQL 查子文档）
文档树辅助 ←── 定位 / 归集 / 删除未引用
```

关系约定：

- **引用美化**只负责样式层，与导航无强依赖。
- **导航植入**查子文档必须走 SQL，禁止对可能无子文档的路径调用 `listDocsByPath`（见 [body-sql 设计](design/2026-08-04-child-nav-body-sql.md)）。
- **顶层笔记本文档**的子文档在磁盘上仍位于笔记本根，导航按虚拟父子列举（见 [box-doc 设计](design/2026-08-31-child-nav-box-doc.md)）。
- 已移除的**子文档索引**、**正文子文档导航**不得再作为现行模块。

## 文档目录

```
docs/
├── README.md      # 本文件：模块地图 + 架构
├── CHANGELOG.md   # 重大设计 / 架构演变（非 git log）
├── design/        # 技术方案
├── ui/            # UI 与原型（按需）
├── template/      # 脚手架（按需）
└── share/         # 对外共享材料（按需）
```

查找：技术细节看 `design/`；演变看 `CHANGELOG.md`。
