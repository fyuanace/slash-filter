# fhelper 文档入口

思源笔记插件：斜杠菜单过滤、图片 DPI 缩放、中英文空格、文档引用美化、子文档索引、子文档导航（植入 / 正文同步）、文档树辅助。

主入口：`index.js`；配置持久化：`fhelper-config.json`；文案：`i18n/zh_CN.json`、`i18n/en_US.json`。

## 模块地图

| 模块 | 配置键 | 说明 | 设计文档 |
|------|--------|------|----------|
| 斜杠过滤 | `disabled` | 按项禁用斜杠菜单命令 | — |
| 图片缩放 | `imageScale` | 图片 DPI / 居中等显示处理 | — |
| 中英文空格 | `panguSpacing` | 输入与粘贴时 CJK-Latin 自动空格 | — |
| 文档引用美化 | `docRefStyle` | 仅对**文档块**引用加下划线与图标；失效引用删除线 | [design/2026-07-08-doc-ref-style.md](design/2026-07-08-doc-ref-style.md) |
| 子文档索引 | `childDocIndex` | 在父文档末尾增量补全直接子文档的标准块引用 | [design/2026-07-09-child-doc-index.md](design/2026-07-09-child-doc-index.md) |
| 子文档导航植入 | `childDocWidget` | 编辑器内子文档树导航面板 | — |
| 正文子文档导航 | `childDocBodyNav` | 正文内同步子文档导航区间；查子文档**仅 SQL** | [design/2026-08-04-child-nav-body-sql.md](design/2026-08-04-child-nav-body-sql.md) |
| 文档树辅助 | — | 定位、引用归集、一级更多菜单等 | — |

## 整体架构

```
设置 / 工具栏 / 命令
  → 各功能独立开关与生命周期（enable 时挂监听，disable 时卸 CSS/Observer/缓存）
  → 共用思源 API：fetchPost、eventBus、protyle、SQL / filetree

docRefStyle ←── 只读装饰：不改写引用内容
childDocIndex ←── 写入标准块引用 ((id 'title'))
childDocWidget / childDocBodyNav ←── 导航展示；与索引写入解耦
```

关系约定：

- **索引**负责写入标准动态块引用；**引用美化**负责样式层，二者兼容、无强依赖。
- **正文导航 / 导航植入**查子文档必须走 SQL，禁止对可能无子文档的路径调用 `listDocsByPath`（见 body-sql 设计）。
- **子文档索引**批处理可用 `listDocsByPath`（需与文档树排序一致），与正文导航热路径分离。

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
