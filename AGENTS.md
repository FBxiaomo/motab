# AGENTS.md — Motab (末页)

## 这是什么

Chrome/Edge 浏览器扩展（Manifest V3），用自定义起始页替换新标签页。**这是分发仓库，不是上游源码仓库** — `assets/` 目录下是预构建的 Vite 打包 JS（带内容哈希）。原生版可直接维护，有 Node 数据测试和独立 Edge 交互测试；没有 `package.json`、构建系统或 CI。

2026-09-29：MV3 迁移 + 弹窗修复 + **`startpage.html` 已接线为实际新标签页**（原生 JS 实现，可直接编辑）。修复记录见 `PROJECT_REPORT.md`。

## 加载测试

1. Chrome/Edge → `chrome://extensions/`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本文件夹
4. 打开新标签页即可看到起始页

无需安装步骤，无需 `npm install`，无需构建命令。

## 文件结构 — 实际重要的文件

| 路径 | 作用 |
|------|------|
| `manifest.json` | 扩展清单（**MV3**：`action` + `background.service_worker`；`newtab` 指向 `startpage.html`）。**权限和入口的唯一真相来源。** |
| `startpage.html` + `scripts/startpage.js` | **实际生效的新标签页（原生 JS，可直接编辑）**：时钟/搜索/快捷方式网格/文件夹（拖拽入夹、iOS 式弹层动画，WAAPI 从图标位置展开并缩回原图标处）/底栏（拖拽排序、与原捷径按 ID 关联、悬停磁吸放大）/设置面板（含图标圆角 4 档个性化）/数据管理。右键菜单可移动到文件夹、批量打开文件夹，删除有短时撤销。图标链：favicon.im → iowen → 源站 favicon.ico → 字母头像（**每源 3.5s 超时** + 会话级失败缓存）。`startpage.js` 是外部脚本（MV3 禁止扩展页内联 `<script>`） |
| `scripts/data-backup.js` / `tests/data-backup.test.js` | 原生版共享默认数据、备份 v2（兼容 v1 导入）、导入校验、写入回滚与撤销、旧存储数据校验、弹窗直接添加、固定/移动/删除/底栏排序数据操作；可用 `node --test tests/data-backup.test.js` 验证，无需安装依赖 |
| `popup-ext.html` / `scripts/popup-ext.js` / `styles/popup-ext.css` | 实际弹窗（原生 JS；`action.default_popup` 指向这里）。"打开起始页"→`startpage.html`；"添加捷径"=直接写入网格或文件夹（重复网址先提示）；"清除数据"=localStorage+IndexedDB 双清 |
| `background.js`（根目录） | MV3 Service Worker — `fetchbaidu`（禁用→`[]`）、`getWebsiteInfo`（保留 fetch）、`uploadIcon`（禁用→`null`） |
| `newtab.html` / `newtab.js` + `assets/`（127 个哈希文件） | React 打包版（上游 Gotab 遗产）。**manifest 已不指向它，处于闲置状态**。`popup.html`/`popup.js` 同为闲置 React 弹窗 |
| `index.html` / `index.js` | 网页版（Go 模板占位符 `{{ .Title }}`），扩展内不可用 |
| `scripts/lime.js`、`styles/lime*.css`、`soft.css` | 孤立文件（无引用）。`lime.js` 曾是"核心逻辑"，现被 startpage 取代 |
| `scripts/background.js` | 死代码（引用 manifest 未声明的 commands） |
| `siteConfig.js` / `hm.js` / `changeFavicon.js` | 空壳占位 / 已禁用统计 / favicon 切换 |
| `hash-manifest.json` | assets 内容哈希（缓存失效用） |
| `install/`、`robots.txt`、`sitemap.xml` | 网站遗留物（清理候选） |
| `_locales/` | i18n（zh_CN、en） |
| `wallpapers/` | 动态壁纸 MP4（约 27 MB） |
| `.mimocode/`、`.workbuddy/` | 本地 AI 工具目录，已在 `.gitignore` 排除 |

## 并存的实现（重要）

1. **原生版（现在实际生效）** — `startpage.html` + `scripts/startpage.js`。自包含、可手改、MV3 兼容。**改起始页功能就改这里。**
2. **React 打包版（闲置）** — `newtab.html`/`newtab.js`/`assets/`。改不了（构建产物）。
3. **孤立文件** — `lime.js`、lime/soft 样式、`scripts/background.js`。

**能直接安全编辑的生效代码**：`scripts/startpage.js`、`scripts/popup-ext.js`、根目录 `background.js`、`manifest.json`、`_locales/`、两个 ext HTML/CSS。

## 数据存储

2026-11-05 外观更新：`scripts/appearance.js` + `styles/appearance.css` 提供图标/壁纸实时预览、应用/取消、单捷径图标上传裁切；`styles/desktop-appearance.css` 统一桌面、文件夹与 Dock 外观。空白处右键可进入自定义布局、图标外观或更换壁纸；普通模式仅打开，编辑模式才允许拖拽，且屏蔽网站链接跳转。拖拽后的点击必须拦截，即使拖回原位也不能打开网站。

- 新元数据键：`motab_appearance`（大小、名称显示、原色/浅色/深色/主题色）、`motab_wallpaperSettings`（图片引用、位置、缩放、模糊、暗度）；捷径可带 `iconAsset`，固定到 Dock 后按 ID 同步。
- `scripts/media-store.js` 是本地图片唯一入口，IndexedDB 数据库 `motab-media` / store `assets` 保存 Blob，localStorage 只存引用。图片上传不联网；每次生成不可变资源 ID。暂保留旧图片供撤销使用，不能在导入后立即清空素材库。
- 新导出为备份 v2，JSON 内携带所引用图片，兼容导入 v1；先校验/解码并存好资源，再提交元数据；同 ID 不同图片必须拒绝覆盖，防止破坏导入撤销。导入撤销快照只存元数据，旧图片仍在 IndexedDB。导出必须使用 `createPortableBackup`，不能仅调用 `makeBackup(State)`。
- 上传支持 PNG/JPEG/WebP，输入最多 20 MiB，图标输出 256px 方图、壁纸长边最多 2560px；便携备份资源最多 256 个、24 MiB，JSON 导入最大 40 MiB。
- 验证：`node --test tests/data-backup.test.js`；`node tests/folder-animation.browser.cjs <输出目录>` 使用独立无界面 Edge 和临时数据，不接触用户浏览器配置。该浏览器测试通过本地 HTTP 加载实际原生文件，扩展加载与真实设备手感仍需实测。

- **startpage（现役新标签页）**：localStorage，键名 `motab_shortcuts`（含 `type:"folder"`+`children`）、`motab_dock`、`motab_wallpaper(+Type)`、`motab_searchEngine`、`motab_showSeconds/showDate`、`motab_openInNewTab`、`motab_iconShape`（图标圆角档位 1-4、默认 2；经 `html[data-icon-shape]` 驱动 `--icon-radius` 超椭圆变量，设置面板"个性化→图标圆角"4 档可调，纳入备份格式 v1）。弹窗与起始页同源，直接写入此键；默认值统一来自 `MotabData.DEFAULTS`。
- **React 版（闲置）**：localStorage（`localSearchHistory`、`initOver`、`userInit` 等）+ localforage(IndexedDB)
- 弹窗"清除数据"两者都清（localStorage + 枚举删 IndexedDB）
- 设置菜单“数据管理”可导出/预览/覆盖导入 JSON 备份；导入前状态存于 `motab_undo_import`，损坏字段原文可保存在 `motab_corrupt_backup`。普通数据键的跨标签页改动会触发页面刷新显示。
- 从网格/文件夹固定到 Dock 的项目沿用原 ID，名称和网址会同步；旧默认 Dock 中的 `d*` 项目仍是独立项。删除原捷径会移除同 ID 固定项；“从底栏移除”只取消固定。

## 常见坑

- **图标必须带超时**：挂起的图片请求不会触发 `error` 事件（无超时 = 图标区永远空白、字母头像兜底永远不出现）。图标链每源 3.5s 超时强制推进 + 会话级失败缓存；改图标来源时必须保留这一机制
- **MV3 扩展页禁止内联 `<script>` 和内联事件处理器（`onerror=""` 属性不执行）** — startpage 的 JS 必须保持外部文件，图标回退必须用 JS 属性挂载（`img.onerror = fn`）
- **init 链式脆弱**：`startpage.js` 的 `init()` 按顺序绑定；任何一步 `getElementById` 拿到 null（如缺标记）会中断后续所有绑定（× / ESC / 拖拽 / 分页全部失效且无报错可见）。改 HTML 结构时务必核对 JS 引用的全部 id
- **文件夹弹层动画必须走 WAAPI**（`showFolderPopup`/`hideFolderPopup` 内 `element.animate()`）：不要退回 CSS transition + 强制重排方案，会因样式提交时序直接跳帧；`.folder-popup` 必须保持 flex 居中（`display:flex; align-items:center; justify-content:center`），丢了它面板会漂到左上角
- **Dock 磁吸放大只准写行内 transform**：距离必须用 `offsetLeft`/`offsetWidth`（布局坐标）计算——`getBoundingClientRect` 会随放大结果反馈抖动；改 margin 会推动水平居中的 Dock 整体漂移；磁吸监听器只能在 `init()` 绑定一次（`renderDock` 会被反复调用，跟着绑会堆叠监听器越用越卡）。**放大必须伴随横向让位**：相邻对按"宽度增量各半"累计位移（`initDockMagnify` 内 segs/acc 推导），否则放大图标与 8px 间距的邻居必然重叠。**目标值与显示值必须分离**（mousemove 只写目标，rAF 每帧插值逼近显示值）：直接在 mousemove 里写最终 transform 会让进入 Dock 的第一个事件把边缘图标瞬间跳到放大值（"突然变大"）；插值方案同时覆盖进入/移动/离开三个阶段，全程禁用 CSS transition（`transition:'none'`，避免与逐帧写入叠加粘滞）
- `index.html` 是 Go 模板网页版，扩展里打开会显示字面 `{{ .Title }}`
- 上游残留：React bundle 内有 `web.gotab.cn` 等常量（未发现活跃外呼）；`chrome.commands`/`?add=` 添加捷径链路已死
- 版本号唯一来源是 `manifest.json` 的 `version`；弹窗动态读取
- 无 lint/CI/构建系统；原生数据与浏览器交互测试见上文。已纳入 Git，公开仓库为 `FBxiaomo/motab`；`.gitignore` 排除本地工具与临时产物。
