# MoTab（末页）项目体检报告

> **2026-11-05 原生桌面更新**：文件夹改为可中断的图标位置平移缩放动画；空白处右键进入自定义布局，拖动可撤销并拦截误点击。新增图标大小/名称/配色、单捷径本地图标裁切、壁纸上传与画面调整；外观可实时预览并应用或取消。图片由 IndexedDB 独立保存，备份升级 v2 携带图片并兼容 v1 导入。当前实现与测试入口详见 `AGENTS.md`。

> **本批验证**：17 项 Node 数据测试、39 项独立 Edge 本地页面交互检查通过；包括真实文件上传/裁切、样式尺寸、刷新持久化、真实双标签页同步、清空素材库后的便携备份恢复、资源 ID 冲突拒绝、导入撤销、文件夹动画/拖拽误点击回归。桌面及窄窗口面板截图已目视检查。浏览器检查通过本地 HTTP 加载原生文件，未操控用户正在使用的扩展配置。

> **阅读提示（2026-10-13）**：第一至第九节记录的是 2026-09-29 修复前的历史状态，其中“MV2”“React 版是现役新标签页”等结论现已过时。当前入口以 `manifest.json` 为准：MV3；新标签页为 `startpage.html` + `scripts/startpage.js`；弹窗为 `popup-ext.html` + `scripts/popup-ext.js`；后台为根目录 `background.js`。当前架构和数据键名请先看 `AGENTS.md`，以下旧章节仅供追溯。

> **2026-10-13 数据管理更新**：现役起始页加入 JSON 备份导出、导入预览与校验、导入前状态恢复、跨标签页刷新。格式与存储操作位于 `scripts/data-backup.js`，针对性测试位于 `tests/data-backup.test.js`。

> **2026-10-13 弹窗更新**：弹窗可直接将当前 HTTP(S) 页面加入网格或指定文件夹，重复网址先提示；默认数据统一从 `scripts/data-backup.js` 读取。剪贴板流程已移除，manifest 不再请求 `clipboardWrite` 权限。

> **2026-10-13 整理功能更新**：现役原生版可通过右键菜单把捷径移动到文件夹或网格、批量打开文件夹；Dock 支持鼠标拖拽排序，固定项按原 ID 同步编辑，删除后 7 秒内可撤销。

> 生成日期：2026-09-29
> 核查方式：逐文件人工核查 + 引用链追踪（grep）+ 打包产物抽样分析
> 本报告以 **manifest.json 和实际代码** 为准，修正了 AGENTS.md 与 CODE_WIKI.md 中的多处失实描述。

---

## 一、结论摘要（TL;DR）

项目是一个可正常加载的 Chrome/Edge 起始页扩展，但处于**"三套实现并存 + 文档严重漂移 + 清单仍是 MV2"** 的状态。后期开发前必须先知道这 6 件事：

1. **manifest.json 实际是 Manifest V2**（`manifest_version: 2`、`browser_action`、`background.scripts`），不是 AGENTS.md 说的 MV3。MV2 已被 Chrome 商店拒收新提交，且 Chrome 正在逐步禁用 — **MV3 迁移是后期工作的第一优先级**。
2. **`scripts/lime.js` 是孤立文件**：没有任何 HTML 引用它，`styles/lime.css`、`lime-improved.css`、`soft.css` 同样无人引用。AGENTS.md 让人"直接改 lime.js"的指引是错的。真正生效的新标签页是 `newtab.html → newtab.js → assets/ 里的 React 打包应用`。
3. **实际弹窗是轻量版 `popup-ext.html`**（manifest 实测指向），React 版 `popup.html` 处于闲置状态。
4. **弹窗的"添加当前网站到捷径"功能是断的**：调用了不存在的 API `chrome.commands.executeCommand`，manifest 也没有声明 `commands`，且缺少读取 `tab.url` 所需的 `tabs`/`activeTab` 权限 — 三处叠加导致该功能完全不可用。
5. **`startpage.html`（918 行、仓库中最新修改的文件）是一个未接线的单文件原型**：lime.js + lime.css 的合并演进版，额外实现了拖拽排序和文件夹弹层。它是三套实现里功能最新的，但没有任何入口引用它。
6. **AGENTS.md 记录的 `motab_*` localStorage 键名只存在于孤立文件中**。实际生效的 React 应用使用的是另一组键名（`localSearchHistory`、`initOver`、`userInit` 等），后期开发切勿按 AGENTS.md 的键名去读写。

---

## 二、项目基本信息

| 属性 | 实测值 |
|------|--------|
| 名称 / 版本 | MoTab 末页 / 1.0.0（版本号在 manifest、popup-ext.html、popup-ext.js 三处硬编码） |
| 类型 | Chrome/Edge 新标签页扩展 |
| 清单版本 | **Manifest V2**（`manifest.json:5`）— 已过时，商店不可提交 |
| 入口 | 新标签页覆盖、browser_action 弹窗、MV2 后台页 |
| 权限 | `bookmarks`、`search`、`history`（无 `tabs`、无 `storage`、无 `favicon`） |
| 数据存储 | localStorage（扩展自身 origin） |
| 构建体系 | 无 — `assets/` 是预构建的 Vite 产物（127 个带哈希文件），本仓库仅做分发/手工修改 |
| 仓库规模 | 92 MB，其中 `.mimocode/node_modules` 占 56 MB（AI 工具，与扩展无关）、壁纸 27 MB、assets 6.2 MB、install/ 1.6 MB |
| 工程设施 | **无 git、无测试、无 lint、无 CI、无 .gitignore** |
| 上游痕迹 | 打包产物中残留 `web.gotab.cn`、`hm.baidu.com`、`go.mtab.cc` 等原版云服务引用（主 bundle 中未发现活跃调用，3 处 `fetch(` 均为 React Router / 预加载 polyfill 内部逻辑） |

### 加载测试（本仓库无需任何安装步骤）

1. Chrome/Edge → `chrome://extensions/`
2. 开启「开发者模式」→「加载已解压的扩展程序」→ 选择本文件夹
3. 打开新标签页验证

---

## 三、真实架构与数据流

### manifest.json 实际接线（与文档差异很大）

```
manifest.json (MV2)
├─ chrome_url_overrides.newtab ──→ newtab.html
│                                    └─→ newtab.js (module)
│                                          └─→ assets/requestIdleCallbackPolyfill-*.js
│                                                + assets/sortable.esm-*.js
│                                                → React 应用 render(<Main type="ext">)   ← 实际新标签页
├─ browser_action.default_popup ──→ popup-ext.html   ← 实际弹窗（不是 popup.html）
│                                     └─→ scripts/popup-ext.js + styles/popup-ext.css（原生 JS）
├─ background.scripts ──→ background.js（根目录，36 行，MV2 后台页）
│                          · fetchbaidu → 返回 []（联网已禁用）
│                          · getWebsiteInfo → 仍会 fetch 目标网址（保留）
│                          · uploadIcon → 返回 null（联网已禁用）
└─ permissions: bookmarks, search, history
```

注意：`scripts/background.js`（31 行，监听 `chrome.commands.onCommand`）**不在 manifest 接线中**，且 manifest 没有声明任何 `commands`，所以其中的 `add-shortcut` 逻辑目前是死代码。

### 三代前端实现并存

| 代际 | 文件 | 状态 | 特点 |
|------|------|------|------|
| ① React 打包版 | `newtab.html` + `newtab.js` + `assets/`（同时有 web 版 `index.html` + `index.js`、闲置的 `popup.html` + `popup.js`） | **唯一接线生效** | 从上游 Gotab 分支来的完整功能（含设置、文件夹、云同步残留），无法直接手改（构建产物） |
| ② 原生拆分版 | `scripts/lime.js` + `styles/lime.css` / `lime-improved.css` / `soft.css` | **孤立，无引用** | localStorage 状态管理，文件夹点击提示"开发中" |
| ③ 单文件原型 | `startpage.html`（918 行，内联 CSS+JS） | **孤立，无引用，最新修改（07-13）** | ② 的合并演进版，新增拖拽排序、文件夹分页弹层、openInNewTab 偏好；使用与 ② 相同的 `motab_*` 键名 |

②③ 共用一套数据模型与键名，① 完全独立。后期如果做功能迭代，本质上是"在 ① 的构建产物上动不了"与"在 ②③ 上改了不生效"的二选一困局 — 这是本项目最大的结构性问题。

### 弹窗"打开起始页"按钮的真实行为

`scripts/popup-ext.js:38-41` 打开的是 `index.html` — 这是**带 Go 模板占位符的网页版**（标题会字面显示 `{{ .Title }}`），且 `index.js` 以 web 模式（不传 `type:"ext"`）渲染。在扩展环境里打开它，行为不等同于新标签页的 ext 模式，可能触发错误页（bundle 内含 `myErrorPage`）。ext 模式入口应是 `newtab.html`。

---

## 四、文件状态清单

**活跃（接线生效）**

| 文件 | 说明 |
|------|------|
| `manifest.json` | 唯一真相来源；MV2，见第七节迁移清单 |
| `newtab.html` / `newtab.js` | 新标签页入口 → React ext 模式 |
| `popup-ext.html` / `scripts/popup-ext.js` / `styles/popup-ext.css` | 实际弹窗（原生 JS） |
| `background.js`（根目录） | MV2 后台页；网络逻辑大部分已禁用 |
| `changeFavicon.js` | 按 Edge/深色模式切换 favicon |
| `siteConfig.js` / `hm.js` | 均为空壳/禁用占位（原百度统计已移除，但 `index.html` 仍引用 `hm.js`） |
| `assets/`（127 个文件）+ `hash-manifest.json` | React 构建产物及其内容哈希清单（缓存失效用） |
| `_locales/zh_CN` / `_locales/en` | i18n 资源（弹窗仅部分使用，见缺陷 8） |
| `icons/` `images/` `fonts/` `wallpapers/` | 静态资源；壁纸 4 个 MP4 共 27 MB |
| `index.html` / `index.js` / `popup.html` / `popup.js` | 网页版入口 / 闲置 React 弹窗（带 CSP `connect-src 'none'`） |

**孤立/残留（决策点：收编或删除）**

| 文件 | 说明 |
|------|------|
| `startpage.html` | 单文件原型，功能最全，未接线 |
| `scripts/lime.js` | 无引用（AGENTS.md 误标为"核心逻辑"） |
| `styles/lime.css`、`styles/lime-improved.css`、`styles/soft.css` | 无引用 |
| `scripts/background.js` | 引用了不存在的 `commands` 声明，等于死代码 |
| `install/`（Next.js 静态导出安装指南，1.6 MB）、`robots.txt`、`sitemap.xml` | 网站遗留物，扩展内不可达，白白增加包体积 |
| `.mimocode/`（56 MB node_modules）、`.workbuddy/` | 本地工具目录，不应随扩展分发 |

---

## 五、数据存储实况

**React 应用（实际生效）使用的 localStorage 键名（实测自 assets 打包产物）：**

`updateTimestamp`、`initOver`、`localSearchHistory`、`defaultDataVersion`、`folderAdd`、`focusPulling`、`userInit`、`hotEvents`、`calendarWeekStart`（另外存在 localforage 痕迹，可能使用 IndexedDB 兜底）

**`motab_*` 键名（`motab_shortcuts`、`motab_dock`、`motab_wallpaper`、`motab_wallpaperType`、`motab_searchEngine`、`motab_showSeconds`、`motab_showDate`）** 仅被孤立的 `scripts/lime.js` 和 `startpage.html` 使用 — 与 AGENTS.md 的说法相反，**它们不是实际生效的键名**。

弹窗"清除本地数据"（`scripts/popup-ext.js:48-50`）调用 `localStorage.clear()`：弹窗与新标签页同属 `chrome-extension://<id>` origin，**确实能清掉 React 版数据**，此功能有效。

---

## 六、文档漂移对照表

以本次实测为准，后期开发请优先相信本表与代码：

| 事项 | AGENTS.md 说 | 实测 |
|------|--------------|------|
| 清单版本 | MV3 | **MV2**（`manifest_version:2`、`browser_action`、`background.scripts`） |
| manifest 指向的弹窗 | `popup.html` | **`popup-ext.html`** |
| 权限列表 | bookmarks、favicon、search、history | bookmarks、search、history（**无 favicon**） |
| 起始页核心逻辑 | `scripts/lime.js`，"修改这里" | lime.js **孤立无引用**；实际是 React 打包版 |
| 数据键名 | `motab_*`（并称 CODE_WIKI 的 `motab_settings` 过时） | `motab_*` 同样过时；实际键名见第五节 |
| 根目录 background.js | "禁用了网络处理" | 大体正确；但 `getWebsiteInfo` 仍会真实 fetch |
| `startpage.html` | 未提及 | 存在，918 行，最新修改，孤立原型 |
| CODE_WIKI.md | 大致参考 | 已知大面积失实（MV3、activeTab/storage、motab_settings、文件结构均错），建议直接归档或重写 |

---

## 七、缺陷与风险清单

### P0 — 阻断性

**1. MV2 清单已被 Chrome 生态淘汰**
- 位置：`manifest.json:5,13,20-22`
- 影响：Chrome Web Store 早已拒收 MV2 新提交；Chrome 持续收紧对 MV2 的支持，扩展随时可能失效。
- 修复：见第八节迁移清单。

### P1 — 功能性缺陷

**2. 弹窗"添加当前网站到捷径"三重断链**
- `scripts/popup-ext.js:24` 调用 `chrome.commands.executeCommand('add-shortcut')` — **该 API 不存在**（chrome.commands 只有 getAll/update/reset + onCommand 事件），点击即抛 TypeError。
- `manifest.json` 没有 `commands` 字段 — 即使 API 存在，`add-shortcut` 命令也未被声明，`scripts/background.js:22-26` 的监听永远不触发。
- `scripts/popup-ext.js:19-22` 读取 `tab.url`，但清单无 `tabs` / `activeTab` 权限 — `url` 为 `undefined`，永远走"不支持添加此类型的页面"分支。
- 修复方向：放弃 commands 方案，在弹窗内直接读 tab 并写存储，或改用 contextMenus；同时补权限。

**3. 弹窗"打开起始页"打开的是网页版**
- `scripts/popup-ext.js:39` 打开 `index.html`（Go 模板占位符 + web 模式渲染），而非 ext 模式的 `newtab.html`。扩展内呈现会异常。

**4. 文档漂移本身是缺陷**
- AGENTS.md 的加载指引、键名、"改 lime.js"的修改路径都会把后期开发者直接带偏。CODE_WIKI.md 建议重写或标注废弃。

### P2 — 技术债 / 风险

**5. 三代实现并存、无构建链** — 功能迭代没有落点（详见第三节）。这是路线决策问题，不是单点 bug。

**6. 仓库卫生** — 无 git、无 .gitignore；`.mimocode/` 56 MB 工具目录混在扩展根目录；`install/`、`robots.txt`、`sitemap.xml` 打进扩展包；`favicon.ico` 24 KB + 大量未用 SVG。分发体积被无谓放大（>90 MB，其中扩展本体约 35 MB，壁纸占 27 MB）。

**7. 外联依赖（仅孤立文件内）** — `scripts/lime.js:136-143` 与 `startpage.html` 的图标走 `api.iowen.cn` + Google s2 favicons 双兜底。若收编 startpage.html，需注意：离线时图标退化为首字母、且存在隐私外泄面。

**8. i18n 半成品** — `popup-ext.js:57-60` 的 i18n 循环是空操作，弹窗文案硬编码中文；`default_locale: zh_CN` 使英文用户也看到中文。`_locales` 中大量键未被使用。

**9. 版本号三处硬编码** — `manifest.json:4`、`popup-ext.html:12`、`popup-ext.js:11` 各写一份 `1.0.0`，升级易漏改。可改为从 `chrome.runtime.getManifest().version` 读取。

**10. 云服务残留** — React bundle 内含 `web.gotab.cn` 等上游服务常量。主 bundle 未见活跃外呼，但 MV3 迁移审计时需逐一确认。

---

## 八、后期工作路线图（建议）

**Phase 0 — 建立基线（半天）**
- `git init` + `.gitignore`（排除 `.mimocode/`、`.workbuddy/`）
- 把本报告第六节的结论回写进 AGENTS.md（修正 MV2、弹窗指向、键名、lime.js 状态）；CODE_WIKI.md 标注"已废弃，见 PROJECT_REPORT.md"

**Phase 1 — MV3 迁移（核心，约 1 天）**
- `manifest_version: 3`
- `browser_action` → `action`
- `background.scripts` → `background.service_worker`；根目录 background.js 只用了 `runtime.onMessage`，兼容 MV3，但需决定是否把 `scripts/background.js` 的命令监听合并进来（若走 contextMenus 方案则直接删除）
- 新增权限按实际需求最小化：如要读当前页 URL，加 `activeTab`（弹窗点击即授予）或 `tabs`
- MV3 禁止扩展页内联 `<script>` — 若将来收编 `startpage.html`，需先把内联脚本拆成外部文件；当前接线中的页面（newtab/popup-ext）均已用外部脚本，不受影响
- 逐项审计 `web_accessible_resources`（当前未声明，无此负担）与远程代码（bundle 全本地，风险低）

**Phase 2 — 修复弹窗（半天）**
- 按缺陷 2/3 修复"添加捷径"与"打开起始页"；版本号改为动态读取

**Phase 3 — 实现路线决策（需要项目负责人拍板）**
- 方案 A：维持 React 打包版为唯一真身，孤立的 lime.js/lime*.css/soft.css/startpage.html 归档删除 — 最省事，但改任何 UI 都需要找回上游构建链
- 方案 B：以 `startpage.html` 原型为新真身接线到 manifest，脱离构建链、全自包含可控 — 需补 MV3 内联脚本拆分、图标外联问题，且放弃 React 版已有功能
- 建议：短期选 A（先让现状可用、可发布），把 startpage.html 作为方案 B 的储备原型保留

**Phase 4 — 清理与瘦身（半天）**
- 删除/移出 `install/`、`robots.txt`、`sitemap.xml`、`hm.js`、闲置的 `popup.html`/`popup.js`（若确认方案 A）
- 评估壁纸 MP4 压缩或按需下载
- 把 `_locales` 的使用补全或删减

---

## 附录 A — 本次核查证据（可复现）

```bash
# manifest 指向（MV2）
cat manifest.json
# lime.js / 样式是否被引用
grep -rl "lime\.js" --include="*.html" .        # → 空
grep -o 'href="[^"]*\.css"' *.html | sort -u    # 仅 popup-ext.css 来自 styles/
# React 应用的实际 localStorage 键名
grep -rho "localStorage[.a-zA-Z]*([\"'][a-zA-Z_-]*" assets/*.js
# 缺陷 2 的证据
sed -n '17,32p' scripts/popup-ext.js            # chrome.commands.executeCommand
# startpage.html 是否被任何入口引用
grep -rl "startpage" --include="*.html" --include="*.js" . | grep -v node_modules
```

## 附录 B — localStorage 键名速查（后期开发直接查这里）

| 键名 | 归属 | 状态 |
|------|------|------|
| `localSearchHistory`、`initOver`、`userInit`、`updateTimestamp`、`defaultDataVersion`、`folderAdd`、`focusPulling`、`hotEvents`、`calendarWeekStart` | React 打包版（newtab 实际生效） | ✅ 活跃 |
| `motab_shortcuts`、`motab_dock`、`motab_wallpaper`、`motab_wallpaperType`、`motab_searchEngine`、`motab_showSeconds`、`motab_showDate` | lime.js / startpage.html | ⚠️ 仅孤立文件使用 |
| `motab_settings` | CODE_WIKI.md 所述 | ❌ 从未存在过 |

---

## 附录 C — 修复记录（2026-09-29）

对应第七节缺陷编号，本轮已修复：

| 缺陷 | 状态 | 处理 |
|------|------|------|
| 1. MV2 清单（P0） | ✅ 已修复 | `manifest.json`：`manifest_version: 3`；`browser_action`→`action`；`background.scripts`→`background.service_worker`；版本号 1.0.0→1.0.1；权限新增 `activeTab`、`clipboardWrite`（均为 MV3 合法权限，其余不变） |
| 2. 弹窗"添加捷径"三重断链（P1） | ✅ 已修复（方案降级） | 删除对不存在的 `chrome.commands.executeCommand` 的调用；新流程：读当前网址（activeTab）→ 复制到剪贴板（clipboardWrite，含 execCommand 兜底）→ 打开 `newtab.html`，用户在起始页粘贴添加。**降级原因**：打包产物考古确认应用不解析 `?add=` 参数，且捷径主数据在 localforage(IndexedDB) 中、schema 不宜从弹窗盲写 |
| 3. 弹窗"打开起始页"指向网页版（P1） | ✅ 已修复 | `chrome.tabs.create({ url: 'newtab.html' })`（ext 模式入口），不再打开带 Go 模板占位符的 `index.html` |
| 4. 文档漂移（P1） | ✅ 已修复 | `AGENTS.md` 按实测重写（MV3、弹窗指向、键名、三代实现、孤立文件）；`CODE_WIKI.md` 顶部加废弃声明 |
| 9. 版本号三处硬编码（P2） | ✅ 已修复 | 弹窗改为 `chrome.runtime.getManifest().version` 动态读取，唯一来源是 manifest |
| 8. i18n 空操作（P2） | ✅ 部分修复 | `data-i18n` 循环已接通 `chrome.i18n.getMessage`；`_locales` 新增 `open_startpage`、`clear_local_data`（zh_CN/en）。alert/confirm 文案仍硬编码中文（后续可再补键） |
| 6*. "清除数据"不彻底（本轮新发现） | ✅ 已修复 | 打包产物证实应用主数据在 localforage(IndexedDB)。弹窗清除逻辑补齐：`localStorage.clear()` + 枚举并删除本 origin 全部 IndexedDB 库 |

其他变更：
- `background.js`（根目录）：仅更新头注释说明 MV3 Service Worker 身份；消息处理逻辑不变（本身兼容 SW）。
- 新增 `.gitignore`（排除 `.mimocode/`、`.workbuddy/`）。
- `scripts/popup-ext.js`、`background.js` 通过 `node --check`；三个 JSON 通过解析校验。

**有意不做 / 遗留决策**（详见第八节路线图）：
- 未声明 `commands` 键盘快捷键 — SW 无法读写剪贴板且应用侧无接收端，键盘链路无法完成"添加"，保留会再次制造假功能；`add_shortcut_desc` locale 键暂留。
- 未删除任何文件（`install/`、`popup.html`、`hm.js`、`robots.txt`、孤立的 lime.js/样式、死代码 `scripts/background.js`）— 属 Phase 4 清理，等实现路线拍板。
- 未执行 `git init` — 留给使用者决定；`.gitignore` 已就位。
- 实现路线选择（React 打包版 vs startpage.html 原型）仍待拍板。

**建议的手动验证步骤**（无法在本环境自动化）：
1. `chrome://extensions/` 重新加载扩展 — 应无 MV3 报错
2. 新标签页正常打开、设置/壁纸/搜索正常
3. 弹窗：版本号显示 v1.0.1；"打开起始页"打开的是新标签页同款；"清除本地数据"后刷新起始页恢复默认
4. 弹窗"添加当前网站到捷径"：在普通网页上点按 → 提示已复制并打开起始页；在 chrome:// 页面上点按 → 提示不支持

---

## 附录 D — 起始页接线与文件夹/视觉优化（2026-09-29 第二轮）

**路线落地**：`manifest.json` 的 `newtab` 改指 `startpage.html` —— 三代实现中唯一可编辑的原生版正式接管新标签页（React 打包版退为闲置；回退只需改回 manifest 一行）。弹窗"打开起始页"同步指向 `startpage.html`。

**MV3 合规改造**：startpage 的 630 行内联脚本抽出为外部 `scripts/startpage.js`（扩展页 CSP 禁止内联 `<script>` 与内联事件属性）；全文件 grep 验证 0 处内联 `onerror`。

**图标系统（自动获取 + 显示效果）**：
- 统一 `buildIconInto` 构建器，四处复用（网格/文件夹迷你图/弹层/底栏）
- 回退链改为 api.iowen.cn → Google s2(sz=64) → 字母头像，替换原"直连站点 /favicon.ico"（易 404/挂起）
- 字母头像按域名哈希从 8 色板取色（同站恒色），修复原实现回退后空白的问题
- `referrerPolicy=no-referrer` 防防盗链拦截；图标加载完成淡入（opacity 0→1），消除破图闪跳

**文件夹功能**：
- 图标数量角标（`folder-count`）；悬停时迷你图标波浪式缩放（40ms 递进延迟）
- 右键文件夹 = "重命名"（仅名称，隐藏网址栏）；删除文件夹需确认（提示含子项数）
- 添加弹窗新增"创建为文件夹"勾选；网址失焦自动建议名称（取主机名）
- **拖拽入夹**：拖动快捷方式悬停文件夹时高亮描边，松手移入（文件夹不可嵌套）；普通拖拽排序不受影响

**点开文件夹的动画**：
- 弹层从被点击文件夹的位置展开（JS 计算 `transform-origin`）
- 面板弹性入场（scale .82→1，cubic-bezier(.34,1.56,.64,1)，420ms）+ 背景模糊渐进（blur 0→10px）
- 图标逐项入场（`--i*30ms` stagger），关闭有收起动效（.closing，200ms）
- ESC 关闭、←/→ 翻页、单页自动隐藏分页条、翻页重放入场动画
- 修复：弹层内名称原为白色（浅玻璃上不可读），改深色

**浏览器实测**（localhost:8642 截图验证）：主页时钟/搜索/底栏正常；文件夹角标、字母头像回退、单页隐藏分页、深色名称均确认。实测中发现并修复一个由本轮重写引入的回归：**settings-panel 标记遗漏导致 `init()` 在 `initDropdown` 抛错，其后所有绑定（× / ESC / 拖拽 / 分页）未注册**——已补回标记；收尾建议手动复验一轮。

**验证记录**：`node --check` ×3 通过、manifest/locales JSON 解析通过、内联处理器 0 处、`?add=`/storage 考古结论沿用附录 A/B。

### 图标加载修复（用户实测反馈后）

用户实测反馈"读取图标出现问题"。根因：图标链**没有超时机制**——`api.iowen.cn` 失效/挂起、Google s2 在国内被墙时，挂起的请求永远不触发 `error` 事件，字母头像兜底永不出现，图标区一直空白。修复（`scripts/startpage.js`）：
1. **每源 3.5s 超时**（`ICON_TIMEOUT_MS`）：`load`/`error`/超时三者任一触发即推进来源链
2. **来源链重排**：`favicon.im`（Cloudflare CDN，国内一般可达）→ `api.iowen.cn`（国内快，若存活）→ `${origin}/favicon.ico`（无第三方）；**移除 Google s2**（国内必挂，只会白等）
3. **会话级失败缓存**（`iconFailedHosts`）：全部来源失败的主机记住，拖拽/弹层/重渲染直接用字母头像，不再重复轰炸失效源
4. 非法 URL（如 `javascript:void(0)` 底栏项）直接走字母头像

### 拖拽修复（用户实测反馈后）

1. **"以链接形式拖动图标"**：此前只在 `<a>` 上设 `draggable=false`，但鼠标落在图标 `<img>` 上时，图片默认可被浏览器原生拖拽，自定义拖拽被劫持。修复：全局 `dragstart` preventDefault（页面拖拽全部由自定义逻辑接管）+ `img.draggable=false` 双保险
2. **拖动位置判定乱跳**：旧插入算法把所有项目按 X 排序后找"间隙"，跨行相邻项的间隙坐标是无意义的中间值，第二行拖动时插入点乱跳。修复：改为按行列几何判定——先按实测 top 分组定位光标所在行，行内按光标 X 越过某项中心即插到它前面，再换算全局索引；网格度量（行距/列距）也改为从实测相邻项推得

### 拖出文件夹（用户实测反馈"拖进去就拖不出来"后）

原实现中文件夹 children 没有任何出口（弹层内无拖拽、无右键）。重构为模块级拖拽状态机，网格项目与弹层项目共用：

1. **拖出**：在弹层内按住图标拖动，光标离开弹层内容区（24px 余量）→ 弹层收起、切换到网格落点模式 → 落到网格空位插入（其余图标让位动画），落到其他文件夹移入；悬停**源文件夹** = 取消区（不高亮不让位），松手项目原位保留
2. **入夹方向同步增强**：拖入文件夹的让位动画改为"外部插入"语义（从 insertIdx 起整体右移），与拖出对称
3. **弹层内右键菜单**：新增"移出到网格"一键出口（追加到网格末尾）；"编辑/删除"改为按 id 递归查找（`findItemLocation`），文件夹内项目可直接编辑/删除，删除后弹层内容自动刷新（`refreshOpenFolderPopup`）
4. 弹层项目点击打开链接的行为不受拖拽影响（未超过 5px 阈值即视为点击）

### 文件夹内拖拽排序（用户反馈"文件夹内部也应该可以拖动位置"后）

弹层内拖动手势按光标位置自然分流，共用同一状态机：
1. **弹层内** = 文件夹 children 页内排序：行几何判定插入位（与网格同算法），其余项目 6 列让位动画，松手 splice 提交（含 from/to 索引修正），`renderFolderPopup(false)` 重绘且不重播入场动画（每项内联 `animation:none`）
2. **拖出弹层边界**（24px 余量）= 拖出文件夹：清弹层位移 → 收起弹层 → 切换网格落点模式（沿用既有逻辑）
3. 拖动期间弹层加 `.reordering` 类禁用入场/悬停动画（动画变换会污染实测 rect、覆盖内联 transform），拖拽结束清理
4. 排序提交后同步刷新网格（文件夹瓦片的前 4 个迷你图标随之更新）
5. 已知边界：排序在当前页内进行；超过 12 项的文件夹暂不支持跨页拖动（可右键"移出到网格"后再整理）

### "图标飞出"修复（用户实测反馈：一拖动图标全部飞出）+ 弹层内排序

根因：让位位移用「行列索引 × 估算间距」推算，一旦测量时机踩中面板入场缩放动画（scale 0.82→1，420ms），所有实测坐标按缩放/origin 失真，位移被放大成飞出。修复（已浏览器实测四条路径全部通过）：
1. **位移改为"实测槽位坐标差"**（网格与弹层共用此法）：目标位置永远是另一个已测量的槽位，位移天然有界——整类度量失真 bug 消失；删除 getGridMetrics/getPopupMetrics 推算函数
2. **拖动开始时面板定格**：弹层内拖动一旦开始，立即将面板 transition 置 none 并定格 scale(1)（关闭时清除内联样式，不影响后续开关动画）
3. **`show` 类改为同步添加**：原先经 requestAnimationFrame 添加，在后台/被遮挡标签页中 rAF 被节流不执行，弹层永不显示
4. **拖拽残留保护**：startDrag 先移除旧监听、移除残留幽灵（上次拖拽若未正常收尾不会叠加放大）
5. 浏览器实测记录：弹层内排序（豆包移至首位且持久化）✓；拖出+跨文件夹移入（通义千问→工具，角标更新）✓；拖出+网格精确插入（文心一言插入微博与知乎之间）✓；入场动画中开拖（snap 生效）✓；真实 favicon 全量加载 ✓
