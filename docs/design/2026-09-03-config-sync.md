---
type: design-change
project: fhelper
module: config-sync
date: 2026-09-03
status: implemented
summary: >
  配置与主题经 petal 缓存随思源同步；拉取前必须先等云端同步成功。桌面与移动端都可用。
related: []
tags: [config-sync, theme-sync]
---

# 配置同步（petal 缓存）

## 变更记录

| 时间 | 说明 |
|------|------|
| 2026-09-03 | 移动端开放推送/拉取；拉取前先触发并等待思源云端同步成功；设置说明改为同步内容 / 原理 / 使用方法。 |
| 2026-09-03 | 设置「关于」展示缓存保存路径；配置文件路径与缓存路径均可打开系统文件夹。 |

## 背景信息

思源不会把 `/conf` 下的软件设置和自定义主题当作工作空间数据同步。要把桌面配置带到另一台设备（含手机），需要先落到 `data` 里，再走思源自己的同步。

原先移动端按钮被禁用，且「缓存写入配置」直接读本地 petal，可能用到尚未同步下来的旧缓存。

## 当前方案

缓存根目录：`/data/storage/petal/fhelper/config-sync`。

- **配置写入缓存**：调用 `/api/system/exportConf`（与「设置 / 关于 / 导出设置」相同），把 zip 与 JSON 放到 petal 的 `conf/`；再把 `/conf/appearance/themes/` 下非内置主题（排除 daylight / midnight）拷到 petal 的 `themes/`。
- **缓存写入配置**：先 `POST /api/sync/performSync`（完全手动模式则 `upload: false` 以下载），监听 `sync-end` / `sync-fail` 与 `ws-main` 的 `syncing`。成功后再读 manifest，调用 `/api/system/importConf`，并把主题拷回 `/conf/appearance/themes/`。未开云端同步、同步失败或超时则中止，不写 conf。
- **生效**：桌面用 Electron `relaunch` + `exitSiYuan()`；移动端没有宿主重启，改为 `/api/ui/reloadUI`。主题选择不会随 importConf 自动切过去，需在设置里手动选。

插件系统本身走思源 petal 同步，不经本缓存。

## 其他模块引用约束

- 不要在未等待同步成功时读取 petal 缓存当「对端最新」。
- 不要在移动端对配置导入走 `exitSiYuan()`：会退出且不会自动重开。
- 不要把内置主题 daylight / midnight 写入缓存。

## 工程师测试验收方法

- 桌面 A：改设置或主题后点「配置写入缓存」，确认 `data/storage/petal/fhelper/config-sync` 有 zip / 主题目录。
- 桌面 B：点「缓存写入配置」，应先出现同步提示；同步成功后才导入并弹出重启确认。未开同步时应提示并停止。
- 移动端：两个按钮可点；拉取同样先同步；确认后刷新界面，再在设置中手动选主题。若部分 conf 未生效，完全退出后重开。
- 回归：同步失败或超时不得改本地 conf / 主题。

## 其他说明

无。
