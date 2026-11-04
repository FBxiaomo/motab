# MoTab 末页 Code Wiki

> **⚠️ 本文档已废弃（2026-09-29）**：内容与实际代码严重不符（清单版本、权限、存储键名、文件结构均错误），仅作历史存档保留。
> 请以 `manifest.json`、`AGENTS.md` 和 `PROJECT_REPORT.md` 为准。

## 项目概述

| 属性 | 值 |
|------|-----|
| 项目名称 | 末页 (MoTab) |
| 版本 | 1.0.0 |
| 类型 | Chrome/Edge 浏览器扩展 (Manifest V3) |
| 描述 | 一个简洁、美观的本地浏览器起始页，完全离线运行 |
| 最低Chrome版本 | 88 |

---

## 项目架构

```
Motab/
├── index.html              # 新标签页主页面 (本地起始页)
├── manifest.json           # Chrome扩展清单文件
├── popup-ext.html         # 扩展弹出窗口
├── _locales/              # 国际化资源
│   ├── zh_CN/messages.json  # 中文语言包
│   └── en/messages.json     # 英文语言包
├── images/                # 扩展图标
│   ├── lime-icon-*.png     # 各尺寸图标
│   └── favicon-newtabpage.png
├── scripts/               # JavaScript脚本
│   ├── background.js      # Service Worker (后台)
│   ├── lime.js           # 起始页核心逻辑
│   └── popup-ext.js       # 弹出窗口逻辑
├── styles/                # 样式表
│   ├── lime.css          # 起始页样式
│   └── popup-ext.css     # 弹出窗口样式
└── wallpapers/           # 动态壁纸资源
    ├── Live1.mp4
    ├── Live2.mp4
    ├── Live3.mp4
    └── Live4.mp4
```

---

## 核心模块说明

### 1. manifest.json

Chrome扩展的核心配置文件。

**关键配置项：**

| 配置项 | 说明 |
|--------|------|
| `manifest_version` | 固定为 3 (MV3) |
| `chrome_url_overrides` | 将新标签页替换为本地 `index.html` |
| `action` | 扩展图标点击时打开 `popup-ext.html` |
| `background` | 注册 Service Worker 为 `background.js` |
| `commands` | 定义快捷命令 `add-shortcut` |
| `permissions` | 只需 activeTab, storage（精简后） |

---

### 2. index.html (主起始页)

本地起始页的主页面，包含完整的UI结构：

**页面结构：**
- `#wallpaper-layer` - 静态壁纸层
- `#video-bg` - 动态视频壁纸
- `.main-container` - 主内容区
  - `.logo-area` - Logo/标题
  - `.search-area` - 搜索框
  - `.shortcuts-area` - 快捷方式网格
- `.settings-btn` - 设置按钮
- `.settings-panel` - 设置面板（侧滑）
- `#add-shortcut-modal` - 添加快捷方式弹窗

---

### 3. styles/lime.css

起始页样式，保持青柠绿主题色 `#70c000`。

**主要特性：**
- CSS变量管理主题颜色
- 支持浅色/深色主题 (prefers-color-scheme)
- 毛玻璃效果 (backdrop-filter)
- 响应式设计
- 平滑过渡动画

**主题色变量：**
```css
--theme-color: #70c000;
--theme-color-hover: #90cf3f;
--theme-color-active: #61a600;
```

---

### 4. scripts/lime.js (核心逻辑)

起始页的核心脚本，管理所有交互和数据。

**配置对象 CONFIG：**
```javascript
{
    searchEngines: {
        baidu: { url: 'https://www.baidu.com/s?wd=', name: '百度' },
        google: { url: 'https://www.google.com/search?q=', name: 'Google' },
        bing: { url: 'https://www.bing.com/search?q=', name: 'Bing' },
        duckduckgo: { url: 'https://duckduckgo.com/?q=', name: 'DuckDuckGo' }
    },
    defaultShortcuts: [...],  // 默认快捷方式
    storageKey: 'motab_settings'
}
```

**状态对象 state：**
```javascript
{
    shortcuts: [],      // 用户快捷方式列表
    searchEngine: 'baidu',  // 当前搜索引擎
    wallpaperType: 'default',  // 'default' | 'video'
    wallpaperVideo: ''    // 视频壁纸路径
}
```

**主要函数：**

| 函数 | 说明 |
|------|------|
| `init()` | 初始化入口 |
| `loadSettings()` | 从localStorage加载用户设置 |
| `saveSettings()` | 保存用户设置到localStorage |
| `handleSearch()` | 执行搜索 |
| `renderShortcuts()` | 渲染快捷方式网格 |
| `handleAddShortcut()` | 添加新快捷方式 |
| `deleteShortcut(index)` | 删除快捷方式 |
| `handleWallpaperChange()` | 切换壁纸 |
| `applyWallpaper()` | 应用壁纸设置 |

**默认快捷方式：**
- 百度、微博、知乎、GitHub、哔哩哔哩、淘宝

---

### 5. scripts/popup-ext.js

扩展弹出窗口的逻辑，提供扩展的快捷操作。

**功能：**
1. 显示版本号
2. 添加当前网站到捷径
3. 打开起始页
4. 清除本地数据

---

### 6. scripts/background.js

Service Worker，处理后台任务和快捷命令。

**功能：**
- 监听 `add-shortcut` 命令
- 在新标签页打开添加捷径页面

---

### 7. styles/popup-ext.css

弹出窗口样式，简洁设计。

---

## 国际化 (_locales)

支持中英文双语切换，跟随系统语言。

---

## 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` | 访问当前活动标签页 |
| `storage` | 存储扩展设置 (localStorage) |

---

## 运行方式

### 本地加载测试
1. 打开 Chrome/Edge，进入 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `d:\My_Mods\Motab` 文件夹

### 功能测试
- 打开新标签页应该显示本地起始页
- 点击右下角设置按钮可打开设置面板
- 可添加/删除快捷方式
- 可切换壁纸（静态/动态）
- 可切换搜索引擎

---

## 数据存储

所有数据使用 `localStorage` 存储，key 为 `motab_settings`。

**数据结构：**
```javascript
{
    shortcuts: [
        { name: '百度', url: 'https://www.baidu.com', color: '#2932e1' },
        // ...
    ],
    searchEngine: 'baidu',
    wallpaperType: 'default',  // or 'video'
    wallpaperVideo: 'wallpapers/Live1.mp4'
}
```

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2024 | 初始版本，纯本地起始页 |
