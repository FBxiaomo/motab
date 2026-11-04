# Motab · 末页

一个面向 Chrome / Edge 的新标签页扩展，以 iOS / iPadOS 桌面的使用体验为设计参考，支持文件夹、Dock、桌面整理和个性化外观。

## 功能

- 时钟、日期和可切换引擎的搜索框。
- 快捷方式与文件夹；文件夹支持展开/收起动画、分页、内部排序和拖入/拖出。
- 空白处右键进入自定义布局；支持拖动与撤销拖动，避免拖拽松手后误打开网站。
- Dock 固定与排序，关联捷径的名称、网址和自定义图标同步。
- 图标大小、圆角、名称显示、原色/浅色/深色/主题色外观。
- 单个捷径上传图标、裁切图片和恢复网站默认图标。
- 内置静态/动态壁纸、本地图片壁纸、位置/缩放/模糊/暗度调整。
- 外观实时预览、应用与取消；跨标签页同步设置。
- JSON 备份导出、导入预览、校验及撤销导入；v2 备份包含自定义图片，并兼容 v1 导入。
- 扩展弹窗可将当前网页直接添加到桌面或指定文件夹。

## 安装

1. 下载本仓库 ZIP 并解压，或执行 `git clone https://github.com/FBxiaomo/motab.git`。
2. Chrome 打开 `chrome://extensions/`，Edge 打开 `edge://extensions/`。
3. 开启「开发者模式」，点击「加载已解压的扩展程序」。
4. 选择包含 `manifest.json` 的项目目录。
5. 打开新标签页。

无需安装依赖或运行构建命令。更新文件后，在扩展管理页面重新加载扩展，再打开新标签页。

## 使用

- 在桌面空白处右键，选择「开始自定义布局」「图标外观」或「更换壁纸」。
- 整理状态下拖动图标、文件夹或 Dock 项目，点击「完成」恢复普通打开操作。
- 右键点击捷径可编辑、替换图标、移动、固定到 Dock 或删除。
- 点击右上角设置进入数据管理，导出备份或导入旧数据。

## 开发与验证

当前实际入口是 `startpage.html`，逻辑使用原生 JavaScript，符合 Manifest V3 的外部脚本要求。

| 文件 | 用途 |
| --- | --- |
| `manifest.json` | 扩展入口与权限 |
| `startpage.html` / `scripts/startpage.js` | 实际新标签页与桌面交互 |
| `scripts/appearance.js` / `styles/appearance.css` | 外观编辑面板 |
| `styles/desktop-appearance.css` | 桌面、文件夹与 Dock 的统一外观 |
| `scripts/data-backup.js` | 默认数据、校验、备份与数据操作 |
| `scripts/media-store.js` | IndexedDB 图片存储、处理与导入导出 |
| `popup-ext.html` / `scripts/popup-ext.js` | 扩展弹窗 |
| `background.js` | Manifest V3 Service Worker |

历史 `newtab.html` / `newtab.js` / `assets/` 是保留的 React 构建产物，清单当前不指向它们。无需修改或重新构建这部分资源。

数据测试需要 Node.js：

```powershell
node --test tests/data-backup.test.js
```

浏览器交互测试需要 Node.js 24+ 和 Microsoft Edge，使用独立临时配置，不访问个人浏览器配置：

```powershell
node tests/folder-animation.browser.cjs
```

可通过环境变量 `MOTAB_EDGE_PATH` 指定 Edge 可执行文件路径，也可向测试命令传入截图和结果的输出目录。浏览器测试使用本地 HTTP 加载实际页面；发布前仍应在浏览器扩展环境中检查使用体验。

## 数据说明

快捷方式和设置保存在扩展本地的 localStorage；上传图片保存在 IndexedDB。图片上传与裁切在本地完成。网站默认图标会向 favicon.im、api.iowen.cn 或目标网站请求，并保留超时与字母头像回退。

版本号以 `manifest.json` 为准。更详细的维护说明见 [AGENTS.md](AGENTS.md) 和 [PROJECT_REPORT.md](PROJECT_REPORT.md)。
