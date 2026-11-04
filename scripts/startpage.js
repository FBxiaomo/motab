// scripts/startpage.js — 末页起始页逻辑（原生 JS，无构建依赖）
// 由 startpage.html 内联脚本抽出（MV3 扩展页禁止内联 <script>）并增强：
//   1. 统一的图标构建器：favicon 多级回退（favicon.im → iowen → 源站 favicon.ico → 字母头像），
//      每个来源 3.5s 超时强制推进（挂起的请求不会触发 error，必须靠超时兜底），
//      会话级失败缓存避免重渲染时反复轰炸失效源
//      全部使用 DOM 属性挂载 onerror（CSP 安全，内联 onerror 属性在 MV3 下不执行）
//   2. 文件夹：数量角标、悬停微动效、拖拽入夹/出夹、弹层内拖拽排序、弹层内右键菜单（移出/编辑/删除）
//   3. 文件夹弹层：从图标位置平移缩放展开，支持中途反向；翻页时图标轻量入场
//   4. 拖拽：排序 / 入夹 / 出夹共用一套模块级拖拽状态机；全局禁用原生拖拽

const Storage = {
    set(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); }
        catch (error) {
            console.error('保存起始页数据失败', error);
            alert('保存失败：浏览器本地存储可能已满或不可用。请先导出备份。');
        }
    }
};

const Defaults = MotabData.DEFAULTS;

const storedState = MotabData.readStored(localStorage, Defaults);
const corruptPreserved = MotabData.preserveCorrupt(localStorage, storedState.invalid);
const State = {
    ...storedState.data,
    contextTarget: null,
};

let layoutEditing = false;
let suppressShortcutClick = false;
let cancelDockDrag = () => {};
const layoutHistory = [];
function recordLayoutChange(before) {
    const after = JSON.stringify(snapshotForUndo());
    if (JSON.stringify(before) === after) return;
    if (layoutHistory.length && layoutHistory.at(-1).after !== JSON.stringify(before)) layoutHistory.length = 0;
    layoutHistory.push({ before, after });
    if (layoutHistory.length > 20) layoutHistory.shift();
    document.getElementById('layout-undo').disabled = false;
}
function cancelLayoutDrag() {
    if (dragState?.started) suppressShortcutClick = true;
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    dragState?.item?.classList.remove('dragging');
    ghost?.remove();
    cleanupDrag();
    dragState = null;
    ghost = null;
    cancelDockDrag();
}
function setLayoutEditing(active) {
    cancelLayoutDrag();
    layoutEditing = active;
    document.body.classList.toggle('layout-editing', active);
    document.getElementById('layout-toolbar').hidden = !active;
    document.getElementById('layout-menu').hidden = true;
    layoutHistory.length = 0;
    document.getElementById('layout-undo').disabled = true;
    hideContextMenu();
    document.getElementById('dock-inner').dispatchEvent(new MouseEvent('mouseleave'));
}
function initLayoutEditing() {
    const menu = document.getElementById('layout-menu');
    const button = document.getElementById('layout-start');
    document.addEventListener('contextmenu', e => {
        if (e.defaultPrevented || e.target.closest('a, button, input, textarea, .shortcut-item, .dock, .folder-popup, .modal, .settings-panel, .top-right, .layout-toolbar, #context-menu')) return;
        e.preventDefault();
        hideContextMenu();
        button.textContent = layoutEditing ? '完成自定义布局' : '开始自定义布局';
        menu.hidden = false;
        menu.style.left = Math.max(8, Math.min(e.clientX, innerWidth - menu.offsetWidth - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(e.clientY, innerHeight - menu.offsetHeight - 8)) + 'px';
    });
    button.addEventListener('click', () => setLayoutEditing(!layoutEditing));
    document.getElementById('layout-icons').addEventListener('click', () => openAppearance('icons'));
    document.getElementById('layout-wallpaper').addEventListener('click', () => openAppearance('wallpaper'));
    document.getElementById('layout-done').addEventListener('click', () => setLayoutEditing(false));
    document.getElementById('layout-undo').addEventListener('click', () => {
        cancelLayoutDrag();
        const entry = layoutHistory.pop();
        if (entry && entry.after === JSON.stringify(snapshotForUndo())) {
            State.shortcuts = entry.before.shortcuts;
            State.dock = entry.before.dock;
            saveShortcuts(); saveDock(); renderShortcuts(); renderDock(); refreshOpenFolderPopup();
        } else layoutHistory.length = 0;
        document.getElementById('layout-undo').disabled = !layoutHistory.length;
    });
    document.addEventListener('mousedown', () => { suppressShortcutClick = false; }, true);
    for (const eventName of ['click', 'auxclick']) document.addEventListener(eventName, e => {
        const item = e.target.closest('.shortcut-item, .folder-popup-item, .dock-item');
        if (item && (suppressShortcutClick || (layoutEditing && item.matches('a')))) {
            e.preventDefault(); e.stopImmediatePropagation();
            suppressShortcutClick = false;
        }
        if (!menu.contains(e.target)) menu.hidden = true;
    }, true);
    window.addEventListener('blur', cancelLayoutDrag);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelLayoutDrag(); });
}

function saveShortcuts() { dismissUndo(); Storage.set('motab_shortcuts', State.shortcuts); }
function saveDock() { dismissUndo(); Storage.set('motab_dock', State.dock); }
function saveWallpaper() { Storage.set('motab_wallpaper', State.wallpaper); Storage.set('motab_wallpaperType', State.wallpaperType); }
function saveSearchEngine() { Storage.set('motab_searchEngine', State.searchEngine); }
function saveDisplay() { Storage.set('motab_showSeconds', State.showSeconds); Storage.set('motab_showDate', State.showDate); Storage.set('motab_openInNewTab', State.openInNewTab); }
function saveIconShape() { Storage.set('motab_iconShape', State.iconShape); }

// 图标圆角个性化 4 档：1 微圆四边形 → 4 圆形；统一 round（标准圆弧）+ 半径线性递增，保证各档视觉圆度均匀递进
// 第 4 档 50% 为正圆；若用 squircle 在 50% 会铺满成超椭圆/方圆形而非真圆，且与 round 混用会导致曲率跳变不线性
const ICON_SHAPES = {
    1: { name: '微圆', radius: '12%', shape: 'round' },
    2: { name: '圆角', radius: '22%', shape: 'round' },
    3: { name: '大圆', radius: '36%', shape: 'round' },
    4: { name: '圆形', radius: '50%', shape: 'round' },
};
function applyIconShape() {
    document.documentElement.setAttribute('data-icon-shape', String(State.iconShape));
}

function applyAppearance(draft = State) {
    const appearance = draft.appearance || Defaults.appearance;
    const root = document.documentElement;
    const sizes = { small: [80, 50, 56, 48, 32], medium: [96, 60, 64, 56, 36], large: [108, 68, 72, 64, 40] };
    const [shortcut, image, folder, dock, dockImage] = sizes[appearance.iconSize];
    root.dataset.iconShape = String(draft.iconShape);
    root.dataset.iconStyle = appearance.iconStyle;
    root.dataset.showNames = String(appearance.showNames);
    root.style.setProperty('--shortcut-size', `${shortcut}px`);
    root.style.setProperty('--shortcut-icon-size', `${image}px`);
    root.style.setProperty('--folder-icon-size', `${folder}px`);
    root.style.setProperty('--dock-icon-size', `${dock}px`);
    root.style.setProperty('--dock-image-size', `${dockImage}px`);
    root.style.setProperty('--icon-tint', appearance.tint);
}

function openAppearance(tab) {
    cancelLayoutDrag();
    hideSettingsPanel();
    document.getElementById('layout-menu').hidden = true;
    MotabAppearance.open(tab);
}

async function persistAppearanceDraft(draft) {
    // 只保存外观相关字段，避免覆盖预览期间从别的标签页同步来的快捷方式。
    const fields = ['appearance', 'iconShape', 'wallpaper', 'wallpaperType', 'wallpaperSettings'];
    const incoming = MotabData.validateData({ ...State, ...draft });
    const previous = fields.map(field => [MotabData.FIELDS[field], localStorage.getItem(MotabData.FIELDS[field])]);
    try {
        for (const field of fields) localStorage.setItem(MotabData.FIELDS[field], JSON.stringify(incoming[field]));
    } catch (error) {
        for (const [key, value] of previous) {
            if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
        }
        throw error;
    }
    for (const field of fields) State[field] = incoming[field];
    applyAppearance();
    await applyWallpaper();
}

function initAppearanceControls() {
    MotabAppearance.init({
        getState: () => State,
        media: MotabMedia,
        staticWallpapers: Wallpapers.static,
        liveWallpapers: Wallpapers.live,
        renderIcon: buildIconInto,
        preview: draft => { cancelLayoutDrag(); applyAppearance(draft); return applyWallpaper(draft); },
        restore: () => { applyAppearance(); return applyWallpaper(); },
        commit: persistAppearanceDraft,
    });
}

function customizeShortcutIcon(item) {
    MotabAppearance.openIcon(item, async assetId => {
        const current = MotabData.readStored(localStorage, Defaults);
        if (Object.keys(current.invalid).length) throw new Error('本地数据需要恢复，请先检查数据管理。');
        const data = current.data;
        const entries = data.shortcuts.flatMap(entry => entry.type === 'folder' ? entry.children : [entry]);
        const linked = entries.find(entry => entry.id === item.id);
        const dock = data.dock.find(entry => entry.id === item.id);
        if (!linked && !dock) throw new Error('快捷方式已不存在，请关闭后重试。');
        for (const entry of [linked, dock].filter(Boolean)) {
            if (assetId) entry.iconAsset = assetId; else delete entry.iconAsset;
        }
        const before = ['shortcuts', 'dock'].map(field => [MotabData.FIELDS[field], localStorage.getItem(MotabData.FIELDS[field])]);
        try {
            localStorage.setItem(MotabData.FIELDS.shortcuts, JSON.stringify(data.shortcuts));
            localStorage.setItem(MotabData.FIELDS.dock, JSON.stringify(data.dock));
        } catch (error) {
            for (const [key, value] of before) {
                if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
            }
            throw error;
        }
        applyStoredData();
    });
}

const SearchEngines = {
    baidu: { name: '百度', url: 'https://www.baidu.com/s?wd=' },
    google: { name: 'Google', url: 'https://www.google.com/search?q=' },
    bing: { name: '必应', url: 'https://www.bing.com/search?q=' },
    duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
};

const Wallpapers = {
    static: [
        { id: 'lilac', name: '丁香紫', thumb: 'linear-gradient(135deg, #B19CD9 0%, #D3D3D3 100%)', url: 'linear-gradient(135deg, #B19CD9 0%, #D3D3D3 100%)' },
        { id: 'lavender', name: '薰衣草', thumb: 'linear-gradient(135deg, #E0C3FC 0%, #8EC5FC 100%)', url: 'linear-gradient(135deg, #E0C3FC 0%, #8EC5FC 100%)' },
        { id: 'dusk', name: '黄昏紫', thumb: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)', url: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
        { id: 'ocean', name: '雾霾蓝', thumb: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)', url: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)' },
        { id: 'sunset', name: '桃粉', thumb: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)', url: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
        { id: 'night', name: '暗夜紫', thumb: 'linear-gradient(135deg, #2c1654 0%, #4a2c7a 100%)', url: 'linear-gradient(135deg, #2c1654 0%, #4a2c7a 100%)' },
    ],
    live: [
        { id: 'live1', name: '动态1', video: 'wallpapers/Live1.mp4', thumb: 'linear-gradient(135deg, #0c0c3d 0%, #1a1a4e 100%)' },
        { id: 'live2', name: '动态2', video: 'wallpapers/Live2.mp4', thumb: 'linear-gradient(135deg, #434343 0%, #000000 100%)' },
        { id: 'live3', name: '动态3', video: 'wallpapers/Live3.mp4', thumb: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
        { id: 'live4', name: '动态4', video: 'wallpapers/Live4.mp4', thumb: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)' },
    ]
};

// ============ 图标系统 ============

// 字母头像配色（按域名哈希取色，同一站点永远同色）
const AVATAR_COLORS = ['#B19CD9', '#8EC5FC', '#7FC8A9', '#F0A8A0', '#F2C94C', '#93A8E8', '#E8A0C8', '#8FD0E8'];
function avatarColor(seed) {
    let h = 0;
    for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// 单个图标来源的最长等待时间：挂起的请求不会触发 error，必须靠超时兜底
const ICON_TIMEOUT_MS = 3500;
// 会话级失败缓存：全部来源都失败过的主机，本次会话内直接用字母头像
const iconFailedHosts = new Set();

// favicon 来源链：favicon.im（Cloudflare CDN，国内一般可达）→ iowen（国内快，若存活）→ 源站自身 favicon.ico
function faviconChain(url) {
    try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) return [];
        const host = u.hostname;
        if (iconFailedHosts.has(host)) return [];
        return [
            `https://favicon.im/${host}?larger=true`,
            `https://api.iowen.cn/favicon/${host}.png`,
            `${u.origin}/favicon.ico`,
        ];
    } catch { return []; }
}

// 向 container 内构建图标：img 淡入；单源超时/失败即推进下一源；全部失败替换为字母头像
function buildIconInto(container, item) {
    const token = Symbol('icon');
    container.iconToken = token;
    if (!item?.iconAsset) { buildWebsiteIconInto(container, item); return; }
    // 本地图标读取期间先显示字母占位；失败再回退到原网站图标链。
    buildWebsiteIconInto(container, { name: item.name });
    MotabMedia.getUrl(item.iconAsset).then(url => {
        if (container.iconToken !== token) return;
        if (!url) throw new Error('图标素材不存在');
        const img = document.createElement('img');
        img.alt = item.name;
        img.draggable = false;
        img.className = 'custom-icon-image';
        let timer;
        const fallback = () => {
            clearTimeout(timer); img.onload = img.onerror = null;
            if (container.iconToken === token) {
                container.replaceChildren();
                buildWebsiteIconInto(container, { ...item, iconAsset: undefined });
            }
        };
        img.onload = () => {
            clearTimeout(timer);
            if (container.iconToken === token) { img.classList.add('icon-loaded'); container.replaceChildren(img); }
        };
        img.onerror = fallback;
        timer = setTimeout(fallback, ICON_TIMEOUT_MS);
        img.src = url;
    }).catch(() => {
        if (container.iconToken === token) { container.replaceChildren(); buildWebsiteIconInto(container, item); }
    });
}

function buildWebsiteIconInto(container, item) {
    const chain = item && item.url ? faviconChain(item.url) : [];
    const makeLetter = () => {
        const letter = document.createElement('span');
        letter.className = 'icon-letter';
        letter.textContent = ((item && item.name) || '?').charAt(0).toUpperCase();
        letter.style.background = avatarColor((item && item.url) || (item && item.name) || '?');
        return letter;
    };
    if (!chain.length) {
        container.appendChild(makeLetter());
        return;
    }
    const img = document.createElement('img');
    img.draggable = false; // 图片默认可原生拖拽，必须显式关闭
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.alt = (item && item.name) || '';
    let step = 0;
    let timer = null;
    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const advance = () => {
        clearTimer();
        step++;
        if (step < chain.length) {
            timer = setTimeout(advance, ICON_TIMEOUT_MS);
            img.src = chain[step];
        } else {
            try { iconFailedHosts.add(new URL(item.url).hostname); } catch { /* ignore */ }
            img.remove();
            container.appendChild(makeLetter());
        }
    };
    img.addEventListener('load', () => { clearTimer(); img.classList.add('icon-loaded'); });
    img.addEventListener('error', advance);
    img.src = chain[0];
    timer = setTimeout(advance, ICON_TIMEOUT_MS);
    container.appendChild(img);
}

// ============ 原生拖拽禁用 ============

// 链接和图片默认可被浏览器原生拖拽（表现为"以链接/图片形式拖出"），
// 本页所有拖拽均由自定义逻辑接管，全局拦截原生 dragstart
document.addEventListener('dragstart', (e) => e.preventDefault());

// ============ 时钟 ============

function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('time').textContent = State.showSeconds ? `${h}:${m}:${s}` : `${h}:${m}`;
    if (State.showDate) {
        const weekdays = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
        document.getElementById('date').textContent = `${now.getMonth()+1}月${now.getDate()}日 ${weekdays[now.getDay()]}`;
        document.getElementById('date').style.display = 'block';
    } else {
        document.getElementById('date').style.display = 'none';
    }
}

let wallpaperRequest = 0;
async function applyWallpaper(draft = State) {
    const request = ++wallpaperRequest;
    const wpEl = document.getElementById('wallpaper');
    const settings = draft.wallpaperSettings || Defaults.wallpaperSettings;
    wpEl.style.filter = `blur(${settings.blur}px)`;
    wpEl.style.transform = `scale(${settings.zoom * (settings.blur ? 1.04 : 1)})`;
    wpEl.style.transformOrigin = `${settings.x}% ${settings.y}%`;
    wpEl.style.backgroundPosition = `${settings.x}% ${settings.y}%`;
    document.querySelector('.wallpaper-overlay').style.background = `rgba(0,0,0,${settings.dim / 100})`;
    if (settings.assetId) {
        const url = await MotabMedia.getUrl(settings.assetId).catch(() => null);
        if (request !== wallpaperRequest) return;
        if (url) {
            wpEl.querySelector('video')?.remove();
            wpEl.style.backgroundImage = `url("${url}")`;
            wpEl.style.backgroundSize = 'cover';
            return;
        }
    }
    if (draft.wallpaperType === 'live') {
        const wp = Wallpapers.live.find(w => w.id === draft.wallpaper);
        if (wp) {
            wpEl.style.background = 'transparent';
            let video = wpEl.querySelector('video');
            if (!video) {
                video = document.createElement('video');
                video.autoplay = true; video.muted = true; video.loop = true; video.playsInline = true;
                video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                wpEl.appendChild(video);
            }
            video.style.objectPosition = `${settings.x}% ${settings.y}%`;
            if (video.getAttribute('src') !== wp.video) video.src = wp.video;
        }
    } else {
        const wp = Wallpapers.static.find(w => w.id === draft.wallpaper) || Wallpapers.static[0];
        wpEl.style.background = wp.url;
        const video = wpEl.querySelector('video');
        if (video) video.remove();
    }
}

// 按 id 在顶层与所有文件夹 children 中查找项目，返回其所在位置
function findItemLocation(id) {
    for (let i = 0; i < State.shortcuts.length; i++) {
        const it = State.shortcuts[i];
        if (it.id === id) return { item: it, list: State.shortcuts, index: i, folder: null };
        if (it.type === 'folder' && it.children) {
            const j = it.children.findIndex(c => c.id === id);
            if (j !== -1) return { item: it.children[j], list: it.children, index: j, folder: it };
        }
    }
    return null;
}

function reconcileDock() {
    let changed = false;
    State.dock = State.dock.map(entry => {
        const linked = findItemLocation(entry.id)?.item;
        if (!linked || linked.type === 'folder') return entry;
        if (entry.name === linked.name && entry.url === linked.url && entry.iconAsset === linked.iconAsset) return entry;
        changed = true;
        return { id: linked.id, name: linked.name, url: linked.url, ...(linked.iconAsset ? { iconAsset: linked.iconAsset } : {}) };
    });
    if (changed) Storage.set('motab_dock', State.dock);
}

let undoSnapshot = null;
let undoTimer = null;
function dismissUndo() {
    clearTimeout(undoTimer);
    undoSnapshot = null;
    const toast = document.getElementById('undo-toast');
    if (toast) toast.hidden = true;
}
function showUndo(message, snapshot) {
    dismissUndo();
    undoSnapshot = snapshot;
    document.getElementById('undo-message').textContent = message;
    document.getElementById('undo-toast').hidden = false;
    undoTimer = setTimeout(dismissUndo, 7000);
}
function snapshotForUndo() {
    return { shortcuts: JSON.parse(JSON.stringify(State.shortcuts)), dock: JSON.parse(JSON.stringify(State.dock)) };
}

// ============ 主网格 ============

function createShortcutEl(item, type) {
    const isLink = item.type !== 'folder' && item.url;
    const wrap = document.createElement(isLink ? 'a' : 'div');
    wrap.className = 'shortcut-item';
    wrap.dataset.id = item.id;
    wrap.dataset.type = type;
    wrap.setAttribute('aria-label', item.name);
    wrap.title = item.name;
    if (isLink) {
        wrap.href = item.url;
        wrap.target = '_blank';
        wrap.rel = 'noopener';
        wrap.draggable = false; // 拖拽排序由自定义逻辑处理，避免原生链接拖拽干扰
    }

    const icon = document.createElement('div');
    icon.className = 'shortcut-icon' + (item.type === 'folder' ? ' folder' : '');

    if (item.type === 'folder') {
        item.children.slice(0, 4).forEach(child => {
            const mini = document.createElement('div');
            mini.className = 'mini-icon';
            buildIconInto(mini, child);
            icon.appendChild(mini);
        });
    } else {
        buildIconInto(icon, item);
    }

    const name = document.createElement('div');
    name.className = 'shortcut-name';
    name.textContent = item.name;
    wrap.appendChild(icon);
    wrap.appendChild(name);

    wrap.addEventListener('click', (e) => {
        if (e.detail === 0) return;
        if (item.type === 'folder') { e.preventDefault(); showFolderPopup(item, icon); return; }
        if (!State.openInNewTab) { e.preventDefault(); window.location.href = item.url; }
    });
    wrap.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, { item, type }); });
    return wrap;
}

function renderShortcuts() {
    const grid = document.getElementById('shortcuts-grid');
    const addBtn = document.getElementById('add-shortcut');
    grid.innerHTML = '';
    State.shortcuts.forEach(item => grid.appendChild(createShortcutEl(item, 'grid')));
    grid.appendChild(addBtn);
}

// ============ 拖拽：排序 / 拖入文件夹 / 拖出文件夹 ============
// 网格项目与文件夹弹层项目共用同一套拖拽状态机（模块级状态）：
//   source = 'grid'  —— 顶层项目：排序、拖入文件夹
//   source = 'popup' —— 弹层内项目：拖出弹层后落网格或入其他文件夹

const DRAG_COLS = 7;
const DRAG_GAP = 24;
let dragState = null;    // { id, source, sourceFolderId, startX, startY, offsetX, offsetY, ghostWidth, item, started, enteredGrid }
let ghost = null;
let originalPositions = [];       // 网格项目实测位置（拖动开始时捕获）
let popupOriginalPositions = [];  // 弹层项目实测位置（弹层内拖动排序用）
let insertIdx = -1;
let popupInsertIdx = -1;
let dropFolderEl = null;

function getGridItems() {
    return [...document.querySelectorAll('#shortcuts-grid .shortcut-item')];
}

function captureGridPositions() {
    originalPositions = getGridItems().map(el => {
        const r = el.getBoundingClientRect();
        return { el, left: r.left, top: r.top, width: r.width, height: r.height };
    });
    getGridItems().forEach(el => {
        if (!el.classList.contains('dragging')) {
            el.style.transition = 'transform 0.2s ease';
        }
    });
}

// 按行分组（top 相差 <10px 视为同一行），组内保持 left 升序
function groupRows() {
    const rows = [];
    const sorted = [...originalPositions].sort((a, b) => (a.top - b.top) || (a.left - b.left));
    sorted.forEach(r => {
        const last = rows[rows.length - 1];
        if (last && Math.abs(last.top - r.top) < 10) last.items.push(r);
        else rows.push({ top: r.top, items: [r] });
    });
    return rows;
}

// 插入位置判定（按行列几何）：先定位光标所在行，行内越过某项中心即插到它前面
function findInsertIndex(clientX, clientY) {
    const items = getGridItems();
    if (items.length === 0) return 0;
    if (originalPositions.length < 2) return items.length;

    const rows = groupRows();

    let row = rows[rows.length - 1];
    for (const r of rows) {
        if (clientY < r.top + r.items[0].height + DRAG_GAP / 2) { row = r; break; }
    }

    let posInRow = row.items.length;
    for (let i = 0; i < row.items.length; i++) {
        const it = row.items[i];
        if (clientX < it.left + it.width / 2) { posInRow = i; break; }
    }

    let base = 0;
    for (const r of rows) {
        if (r === row) break;
        base += r.items.length;
    }
    return base + posInRow;
}

// 光标悬停在某个文件夹上（拖顶层文件夹时不允许——不支持嵌套）
function findFolderTarget(clientX, clientY) {
    if (!dragState) return null;
    if (dragState.source === 'grid') {
        const dragged = State.shortcuts.find(s => s.id === dragState.id);
        if (!dragged || dragged.type === 'folder') return null;
    }
    for (const el of getGridItems()) {
        if (dragState.source === 'grid' && el.dataset.id === dragState.id) continue;
        const item = State.shortcuts.find(s => s.id === el.dataset.id);
        if (!item || item.type !== 'folder') continue;
        const r = el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
            return el;
        }
    }
    return null;
}

function setDropFolder(el) {
    if (dropFolderEl === el) return;
    if (dropFolderEl) dropFolderEl.classList.remove('drop-target');
    dropFolderEl = el;
    if (el) el.classList.add('drop-target');
}

// 让位动画：被拖项之外的项目平移到目标槽位。
// 位移直接取"实测槽位坐标差"，而不是 行列索引×估算间距 推算——
// 推算一旦度量失真（如在面板入场缩放动画中测量），位移会被放大成"图标飞出"。
function moveToIdx(newIdx) {
    if (newIdx === insertIdx) return;
    insertIdx = newIdx;

    const items = getGridItems();
    const isPopupSource = dragState.source === 'popup';
    let fromIdx = -1;
    if (!isPopupSource) {
        fromIdx = items.findIndex(el => el.dataset.id === dragState.id);
        if (fromIdx === -1) return;
    }

    items.forEach((el, i) => {
        if (!isPopupSource && el.dataset.id === dragState.id) return;
        let targetIdx = i;
        if (isPopupSource) {
            if (i >= newIdx) targetIdx = i + 1;
        } else if (i < fromIdx) {
            if (i >= newIdx) targetIdx = i + 1;
        } else if (i > fromIdx) {
            if (i < newIdx) targetIdx = i - 1;
        }
        const tgt = originalPositions[targetIdx];
        const orig = originalPositions[i];
        if (!tgt || !orig) { el.style.transform = ''; return; }
        const dx = tgt.left - orig.left;
        const dy = tgt.top - orig.top;
        if (!dx && !dy) { el.style.transform = ''; return; }
        el.style.transform = `translate(${dx}px, ${dy}px)`;
    });
}

// ============ 弹层内拖拽排序（文件夹 children 页内重排） ============

function findPopupInsertIndex(clientX, clientY) {
    if (!popupOriginalPositions.length) return 0;
    const rows = [];
    const sorted = [...popupOriginalPositions].sort((a, b) => (a.top - b.top) || (a.left - b.left));
    sorted.forEach(r => {
        const last = rows[rows.length - 1];
        if (last && Math.abs(last.top - r.top) < 10) last.items.push(r);
        else rows.push({ top: r.top, items: [r] });
    });
    let row = rows[rows.length - 1];
    for (const r of rows) {
        if (clientY < r.top + r.items[0].height + 5) { row = r; break; }
    }
    let posInRow = row.items.length;
    for (let i = 0; i < row.items.length; i++) {
        const it = row.items[i];
        if (clientX < it.left + it.width / 2) { posInRow = i; break; }
    }
    let base = 0;
    for (const r of rows) {
        if (r === row) break;
        base += r.items.length;
    }
    return base + posInRow;
}

// 弹层内让位动画：位移取实测槽位坐标差（同 moveToIdx 注记）
function moveToPopupIdx(newPos) {
    if (newPos === popupInsertIdx) return;
    popupInsertIdx = newPos;
    const items = [...document.querySelectorAll('#folder-popup-grid .folder-popup-item')];
    const fromPos = items.findIndex(el => el.dataset.childId === dragState.id);
    if (fromPos === -1 || !popupOriginalPositions.length) return;
    items.forEach((el, i) => {
        if (i === fromPos) return;
        let targetIdx = i;
        if (i < fromPos) {
            if (i >= newPos) targetIdx = i + 1;
        } else if (i > fromPos) {
            if (i < newPos) targetIdx = i - 1;
        }
        const tgt = popupOriginalPositions[targetIdx];
        const orig = popupOriginalPositions[i];
        if (!tgt || !orig) { el.style.transform = ''; return; }
        const dx = tgt.left - orig.left;
        const dy = tgt.top - orig.top;
        if (!dx && !dy) { el.style.transform = ''; return; }
        el.style.transform = `translate(${dx}px, ${dy}px)`;
    });
}

function clearPopupDragVisuals() {
    document.querySelectorAll('#folder-popup-grid .folder-popup-item').forEach(el => { el.style.transform = ''; });
    popupInsertIdx = -1;
}

function cleanupDrag() {
    getGridItems().forEach(el => {
        el.style.transition = '';
        el.style.transform = '';
        el.classList.remove('drop-target');
    });
    const fg = document.getElementById('folder-popup-grid');
    if (fg) {
        fg.classList.remove('reordering');
        fg.querySelectorAll('.folder-popup-item').forEach(el => { el.style.transform = ''; });
    }
    dropFolderEl = null;
    originalPositions = [];
    popupOriginalPositions = [];
    insertIdx = -1;
    popupInsertIdx = -1;
}

function startDrag(itemEl, e, source) {
    if (!layoutEditing) return;
    // 上一次拖拽若未正常收尾（监听/幽灵残留），先清理，避免叠加放大
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    if (ghost) { ghost.remove(); ghost = null; }
    // 文件夹展开中就开始操作时，先结束缩放再记录抓取点和幽灵尺寸。
    if (source === 'popup') settleFolderPopup();
    const rect = itemEl.getBoundingClientRect();
    dragState = {
        id: source === 'grid' ? itemEl.dataset.id : itemEl.dataset.childId,
        source,
        sourceFolderId: source === 'popup' ? (folderPopupState.folder ? folderPopupState.folder.id : null) : null,
        startX: e.clientX, startY: e.clientY,
        offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
        ghostWidth: rect.width,
        item: itemEl,
        started: false,
        enteredGrid: false,
        before: snapshotForUndo(),
    };
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
}

function handleDragMove(e) {
    if (!dragState) return;
    if (!dragState.started) {
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;
        dragState.started = true;
        e.preventDefault();
        dragState.item.classList.add('dragging');
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.innerHTML = dragState.item.innerHTML;
        ghost.style.width = dragState.ghostWidth + 'px';
        ghost.style.left = (e.clientX - dragState.offsetX) + 'px';
        ghost.style.top = (e.clientY - dragState.offsetY) + 'px';
        document.body.appendChild(ghost);
        if (dragState.source === 'grid') {
            captureGridPositions();
        } else {
            const fg = document.getElementById('folder-popup-grid');
            fg.classList.add('reordering');
            // 先结束 WAAPI，再测量布局；行内 transform 无法覆盖仍在运行的动画。
            settleFolderPopup();
            popupOriginalPositions = [...fg.querySelectorAll('.folder-popup-item')].map(el => {
                const r = el.getBoundingClientRect();
                return { el, left: r.left, top: r.top, width: r.width, height: r.height };
            });
        }
    }
    ghost.style.left = (e.clientX - dragState.offsetX) + 'px';
    ghost.style.top = (e.clientY - dragState.offsetY) + 'px';

    // 弹层拖出：光标离开弹层内容区（留 24px 余量）即收起弹层，切换到网格落点模式
    if (dragState.source === 'popup' && !dragState.enteredGrid) {
        const content = document.querySelector('#folder-popup .folder-popup-content');
        const cr = content.getBoundingClientRect();
        const grace = 24;
        const outside = e.clientX < cr.left - grace || e.clientX > cr.right + grace ||
                        e.clientY < cr.top - grace || e.clientY > cr.bottom + grace;
        if (!outside) {
            // 仍在弹层内 = 文件夹内部排序
            moveToPopupIdx(findPopupInsertIndex(e.clientX, e.clientY));
            return;
        }
        dragState.enteredGrid = true;
        clearPopupDragVisuals();
        hideFolderPopup();
        captureGridPositions();
    }

    // 文件夹命中优先；拖出时悬停源文件夹 = 取消区（不高亮、不让位）
    const folderEl = findFolderTarget(e.clientX, e.clientY);
    if (folderEl) {
        if (dragState.sourceFolderId && folderEl.dataset.id === dragState.sourceFolderId) {
            setDropFolder(null);
            getGridItems().forEach(el => { el.style.transform = ''; });
            insertIdx = -1;
            return;
        }
        setDropFolder(folderEl);
        getGridItems().forEach(el => { if (el.dataset.id !== dragState.id) el.style.transform = ''; });
        insertIdx = -1;
        return;
    }
    setDropFolder(null);
    moveToIdx(findInsertIndex(e.clientX, e.clientY));
}

function handleDragEnd(e) {
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    let changed = false;

    if (dragState && dragState.started) {
        suppressShortcutClick = true;
        if (dragState.source === 'grid') {
            if (dropFolderEl) {
                // 顶层项目拖入文件夹
                const folder = State.shortcuts.find(s => s.id === dropFolderEl.dataset.id);
                const loc = findItemLocation(dragState.id);
                if (folder && folder.type === 'folder' && loc && !loc.folder && loc.item.type !== 'folder') {
                    loc.list.splice(loc.index, 1);
                    folder.children.push(loc.item);
                    changed = true;
                }
            } else if (insertIdx !== -1) {
                // 顶层排序
                const fromIdx = State.shortcuts.findIndex(s => s.id === dragState.id);
                if (fromIdx !== -1) {
                    let toIdx = insertIdx;
                    if (fromIdx < toIdx) toIdx--;
                    if (fromIdx !== toIdx) {
                        const [moved] = State.shortcuts.splice(fromIdx, 1);
                        State.shortcuts.splice(toIdx, 0, moved);
                        changed = true;
                    }
                }
            }
        } else if (dragState.source === 'popup' && !dragState.enteredGrid) {
            // 弹层内拖动 = 文件夹 children 页内排序
            const folder = folderPopupState.folder;
            const pageStart = folderPopupState.page * folderPopupState.perPage;
            const items = [...document.querySelectorAll('#folder-popup-grid .folder-popup-item')];
            const fromPos = items.findIndex(el => el.dataset.childId === dragState.id);
            if (folder && popupInsertIdx !== -1 && fromPos !== -1 && fromPos !== popupInsertIdx) {
                const from = pageStart + fromPos;
                let to = pageStart + popupInsertIdx;
                if (from < to) to--;
                const [moved] = folder.children.splice(from, 1);
                folder.children.splice(Math.max(0, Math.min(to, folder.children.length)), 0, moved);
                changed = true;
            }
        } else if (dragState.source === 'popup' && dragState.enteredGrid) {
            // 弹层项目拖出：落网格某位置，或移入其他文件夹
            const loc = findItemLocation(dragState.id);
            if (loc && loc.folder) {
                if (dropFolderEl && dropFolderEl.dataset.id !== dragState.sourceFolderId) {
                    const target = State.shortcuts.find(s => s.id === dropFolderEl.dataset.id);
                    if (target && target.type === 'folder') {
                        loc.list.splice(loc.index, 1);
                        target.children.push(loc.item);
                        changed = true;
                    }
                } else if (insertIdx !== -1) {
                    loc.list.splice(loc.index, 1);
                    State.shortcuts.splice(Math.min(insertIdx, State.shortcuts.length), 0, loc.item);
                    changed = true;
                }
                // 其余情况：取消，项目留在原文件夹
            }
        }
    }

    if (dragState && dragState.item) dragState.item.classList.remove('dragging');
    if (ghost) ghost.remove();
    cleanupDrag();
    if (changed) {
        saveShortcuts();
        renderShortcuts();
        if (dragState.source === 'popup' && !dragState.enteredGrid) renderFolderPopup(false);
        recordLayoutChange(dragState.before);
    }
    dragState = null;
    ghost = null;
}

function initDragDrop() {
    const grid = document.getElementById('shortcuts-grid');
    grid.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.shortcut-item');
        if (!item || e.button !== 0) return;
        startDrag(item, e, 'grid');
    });
}

// ============ 底栏（macOS/iOS 风格） ============

let dockSuppressClick = false;
function renderDock() {
    const inner = document.getElementById('dock-inner');
    inner.innerHTML = '';
    State.dock.forEach(item => {
        const isLink = item.url && item.url !== 'javascript:void(0)';
        const d = document.createElement(isLink ? 'a' : 'div');
        d.className = 'dock-item pinned'; // pinned 类显示底部指示点
        d.dataset.id = item.id;
        d.setAttribute('aria-label', item.name);
        if (isLink) { d.href = item.url; d.target = '_blank'; d.rel = 'noopener'; d.draggable = false; }
        buildIconInto(d, item);
        const tip = document.createElement('div');
        tip.className = 'dock-tooltip';
        tip.textContent = item.name;
        d.appendChild(tip);
        d.addEventListener('click', (e) => {
            if (dockSuppressClick) { e.preventDefault(); e.stopPropagation(); return; }
            if (isLink && !State.openInNewTab) { e.preventDefault(); window.location.href = item.url; }
        });
        d.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, { item, type: 'dock' }); });
        inner.appendChild(d);
    });
    // 磁吸监听器只在 init() 绑定一次：renderDock 会被反复调用，这里再绑会不断堆叠监听器导致卡顿
}

// Dock 磁吸放大（macOS 风格）：距离场放大 + 横向让位 + rAF 插值，零重叠、进出平滑。
// 关键点：
//   1. 距离用 offsetLeft/offsetWidth（布局坐标，不受 transform 影响）计算——
//      若用 getBoundingClientRect，放大后的 rect 会反过来改变距离，形成反馈抖动；
//   2. 只写 transform 不改 margin；相邻对按"宽度增量各半"横向互相让位
//      （累计求和后整体减去总量一半，向两侧对称扩张）——相邻间隙恒等于原 gap，永不重叠；
//   3. mousemove 只更新"目标值"，显示值由 rAF 每帧插值逼近——否则进入 Dock 的
//      第一个事件会把边缘图标从 1.0 直接跳到放大值（"突然变大"）；插值让进入
//      平滑增长、移动依然跟手、离开平滑回落，全程不依赖 CSS transition。
function initDockMagnify() {
    const inner = document.getElementById('dock-inner');
    const RANGE = 130;      // 磁吸影响半径（px）：收窄到紧邻项
    const MAX_LIFT = 12;    // 最大上浮（px）
    const MAX_SCALE = 0.42; // 最大放大增量
    const SMOOTH = 0.32;    // 每帧插值系数：越大越跟手，越小越平滑

    let display = null;   // [{el, scale, lift}] 显示态（插值中的当前值）
    let targetX = null;   // 鼠标相对 .dock 的布局 x；null = 全部回落
    let rafId = null;

    function ensureDisplay(items) {
        if (!display || display.length !== items.length ||
            items.some((el, i) => el !== display[i].el)) {
            display = items.map(el => ({ el, scale: 1, lift: 0 }));
        }
        return display;
    }

    function frame() {
        rafId = null;
        const items = [...inner.querySelectorAll('.dock-item')];
        if (!items.length) { display = null; return; }
        const entries = ensureDisplay(items);

        // 1) 目标值（拖拽中的项与无鼠标时一律回落）
        const targets = entries.map(en => {
            if (layoutEditing || targetX === null || en.el.classList.contains('dragging')) return { scale: 1, lift: 0 };
            const center = en.el.offsetLeft + en.el.offsetWidth / 2;
            const t = Math.max(0, 1 - Math.abs(targetX - center) / RANGE);
            const k = t * t; // 平方衰减：只有紧邻项明显响应
            return { scale: 1 + MAX_SCALE * k, lift: MAX_LIFT * k };
        });

        // 2) 显示值向目标插值（进入/移动/回落都平滑）
        let settled = true;
        entries.forEach((en, i) => {
            en.scale += (targets[i].scale - en.scale) * SMOOTH;
            en.lift += (targets[i].lift - en.lift) * SMOOTH;
            if (Math.abs(targets[i].scale - en.scale) > 0.002 || Math.abs(targets[i].lift - en.lift) > 0.1) settled = false;
        });

        // 3) 基于显示值计算横向让位，写 transform
        const segs = [];
        let total = 0;
        for (let i = 0; i < entries.length - 1; i++) {
            const seg = ((entries[i].scale - 1) * entries[i].el.offsetWidth
                + (entries[i + 1].scale - 1) * entries[i + 1].el.offsetWidth) / 2;
            segs.push(seg);
            total += seg;
        }
        let acc = -total / 2;
        entries.forEach((en, i) => {
            if (i > 0) acc += segs[i - 1];
            if (en.el.classList.contains('dragging')) return; // 拖拽项交回 .dragging 样式
            en.el.style.transition = 'none'; // 平滑由插值负责，避免 CSS 过渡叠加粘滞
            en.el.style.transform = `translate(${acc.toFixed(2)}px, ${(-en.lift).toFixed(2)}px) scale(${en.scale.toFixed(3)})`;
        });

        if (settled && targetX === null) {
            // 完全回落后清理行内样式，恢复干净状态
            entries.forEach(en => { en.el.style.transition = ''; en.el.style.transform = ''; });
            display = null;
            return;
        }
        if (!settled) rafId = requestAnimationFrame(frame);
    }

    function kick() { if (rafId === null) rafId = requestAnimationFrame(frame); }

    inner.addEventListener('mousemove', (e) => {
        const items = [...inner.querySelectorAll('.dock-item')];
        if (!items.length) return;
        const origin = items[0].offsetParent; // dock-item 的 offsetParent 是 .dock（position:fixed）
        targetX = e.clientX - (origin ? origin.getBoundingClientRect().left : 0);
        kick();
    });
    inner.addEventListener('mouseleave', () => { targetX = null; kick(); });
}

function initDockDrag() {
    const inner = document.getElementById('dock-inner');
    let dragging = null;
    function move(e) {
        if (!dragging) return;
        if (!dragging.started) {
            if (Math.hypot(e.clientX - dragging.startX, e.clientY - dragging.startY) <= 5) return;
            dragging.started = true;
            e.preventDefault();
            dragging.item.classList.add('dragging');
            dragging.item.style.transform = ''; // 清除磁吸行内变换，让 .dragging 的收缩样式生效
            const ghostEl = dragging.item.cloneNode(true);
            ghostEl.className = 'drag-ghost dock-ghost';
            ghostEl.querySelector('.dock-tooltip')?.remove();
            ghostEl.style.width = dragging.width + 'px';
            ghostEl.style.height = dragging.height + 'px';
            ghostEl.style.transform = ''; // 克隆会带上磁吸行内变换，须清除
            document.body.appendChild(ghostEl);
            dragging.ghost = ghostEl;
        }
        dragging.ghost.style.left = (e.clientX - dragging.offsetX) + 'px';
        dragging.ghost.style.top = (e.clientY - dragging.offsetY) + 'px';
        inner.querySelectorAll('.dock-item').forEach(el => el.classList.remove('drop-target'));
        dragging.targetId = null;
        const bounds = inner.getBoundingClientRect();
        if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) return;
        const items = [...inner.querySelectorAll('.dock-item')];
        const nearest = items.reduce((best, el) => {
            const rect = el.getBoundingClientRect();
            const distance = Math.abs(e.clientX - (rect.left + rect.width / 2));
            return !best || distance < best.distance ? { el, distance } : best;
        }, null);
        if (nearest) {
            nearest.el.classList.add('drop-target');
            dragging.targetId = nearest.el.dataset.id;
        }
    }
    function end() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', end);
        if (!dragging) return;
        if (dragging.started) {
            suppressShortcutClick = true;
            dockSuppressClick = true;
            setTimeout(() => { dockSuppressClick = false; }, 0);
            const from = State.dock.findIndex(item => item.id === dragging.id);
            const to = State.dock.findIndex(item => item.id === dragging.targetId);
            if (from !== -1 && to !== -1 && from !== to) {
                State.dock = MotabData.reorderDock(State, dragging.id, dragging.targetId).dock;
                saveDock();
                renderDock();
                recordLayoutChange(dragging.before);
            } else {
                dragging.item.classList.remove('dragging');
                inner.querySelectorAll('.dock-item').forEach(el => el.classList.remove('drop-target'));
            }
            dragging.ghost.remove();
        }
        dragging = null;
    }
    inner.addEventListener('mousedown', (e) => {
        if (!layoutEditing) return;
        const item = e.target.closest('.dock-item');
        if (!item || e.button !== 0) return;
        const rect = item.getBoundingClientRect();
        dragging = { id: item.dataset.id, item, startX: e.clientX, startY: e.clientY,
            offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
            width: rect.width, height: rect.height, started: false, targetId: null, ghost: null, before: snapshotForUndo() };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', end);
    });
    cancelDockDrag = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', end);
        if (dragging?.started) suppressShortcutClick = true;
        dragging?.ghost?.remove();
        dragging?.item?.classList.remove('dragging');
        inner.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
        dragging = null;
    };
}

// ============ 右键菜单 ============

function showContextMenu(x, y, target) {
    const menu = document.getElementById('context-menu');
    State.contextTarget = target;
    const toDock = menu.querySelector('[data-action="to-dock"]');
    const toGrid = menu.querySelector('[data-action="to-grid"]');
    const moveToFolder = menu.querySelector('[data-action="move-to-folder"]');
    const openAll = menu.querySelector('[data-action="open-all"]');
    const isFolder = target.item && target.item.type === 'folder';
    menu.querySelector('[data-action="customize-icon"]').style.display = isFolder ? 'none' : 'flex';
    toGrid.style.display = target.type === 'popup' ? 'flex' : 'none';
    toDock.style.display = (target.type === 'dock' || isFolder || State.dock.some(d => d.id === target.item.id)) ? 'none' : 'flex';
    moveToFolder.style.display = (target.type === 'dock' || isFolder) ? 'none' : 'flex';
    openAll.style.display = isFolder ? 'flex' : 'none';
    menu.querySelector('[data-action="edit"] span').textContent = isFolder ? '重命名' : '编辑';
    menu.querySelector('[data-action="delete"] span').textContent = target.type === 'dock' ? '从底栏移除' : '删除';

    // 1. 立即隐藏（无过渡），重置到不可见状态
    menu.style.transition = 'none';
    menu.classList.remove('show');
    menu.style.opacity = '0';
    menu.style.visibility = 'hidden';
    menu.style.transform = 'scale(0.95)';

    // 2. 用 clone 或临时样式测量真实尺寸（不影响当前菜单位置）
    //    这里直接用 menu 测量，但保持在不可见状态
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const padding = 8;

    // 3. 计算最终位置
    let finalX = x;
    let finalY = y;
    let originX = 'left';
    let originY = 'top';

    if (x + menuWidth + padding > viewportW) {
        finalX = Math.max(padding, x - menuWidth);
        originX = 'right';
    }
    if (y + menuHeight + padding > viewportH) {
        finalY = Math.max(padding, y - menuHeight);
        originY = 'bottom';
    }
    finalX = Math.max(padding, Math.min(finalX, viewportW - menuWidth - padding));
    finalY = Math.max(padding, Math.min(finalY, viewportH - menuHeight - padding));

    // 4. 设置新位置（此时仍不可见）
    menu.style.transformOrigin = `${originY} ${originX}`;
    menu.style.left = finalX + 'px';
    menu.style.top = finalY + 'px';

    // 5. 强制重排，确保浏览器提交"隐藏+新位置"状态
    void menu.offsetHeight;

    // 6. 恢复过渡并显示 → 从新位置原地淡入+缩放，不会从画外飞入
    menu.style.transition = '';
    menu.style.opacity = '';
    menu.style.visibility = '';
    menu.style.transform = '';
    menu.classList.add('show');
}

function hideContextMenu() {
    document.getElementById('context-menu').classList.remove('show');
    State.contextTarget = null;
}

// 弹层开着时，数据变更后刷新其内容；文件夹已不存在则收起
function refreshOpenFolderPopup() {
    if (!folderPopupState.folder) return;
    const loc = findItemLocation(folderPopupState.folder.id);
    if (loc && loc.item.type === 'folder') {
        folderPopupState.folder = loc.item;
        renderFolderPopup();
    } else {
        hideFolderPopup();
    }
}

// ============ 添加 / 编辑弹窗 ============

function showAddModal() {
    document.getElementById('add-name').value = '';
    document.getElementById('add-url').value = 'https://';
    document.getElementById('add-is-folder').checked = false;
    document.getElementById('add-url-group').style.display = '';
    document.getElementById('add-modal').classList.add('show');
    document.getElementById('add-name').focus();
}
function hideAddModal() { document.getElementById('add-modal').classList.remove('show'); }

function showMoveModal(item) {
    const select = document.getElementById('move-target');
    select.replaceChildren();
    const rootOption = document.createElement('option');
    rootOption.value = '';
    rootOption.textContent = '快捷方式网格';
    select.appendChild(rootOption);
    State.shortcuts.filter(entry => entry.type === 'folder').forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        select.appendChild(option);
    });
    select.value = findItemLocation(item.id)?.folder?.id || '';
    document.getElementById('move-modal').dataset.id = item.id;
    document.getElementById('move-modal').classList.add('show');
    select.focus();
}
function hideMoveModal() { document.getElementById('move-modal').classList.remove('show'); }

function showEditModal(item) {
    const isFolder = item.type === 'folder';
    const isDockAction = State.contextTarget?.type === 'dock' && item.url === 'javascript:void(0)';
    document.getElementById('edit-modal-title').textContent = isFolder ? '重命名文件夹' : '编辑快捷方式';
    document.getElementById('edit-name').value = item.name;
    document.getElementById('edit-url-group').style.display = isFolder || isDockAction ? 'none' : '';
    document.getElementById('edit-url').value = item.url || '';
    document.getElementById('edit-modal').classList.add('show');
    document.getElementById('edit-modal').dataset.id = item.id;
    document.getElementById('edit-modal').dataset.source = State.contextTarget?.type === 'dock' ? 'dock' : 'shortcuts';
    document.getElementById('edit-name').focus();
}
function hideEditModal() { document.getElementById('edit-modal').classList.remove('show'); }

// 从网址推断名称建议（名称留空时）
function suggestNameFromUrl(urlStr) {
    try {
        const normalized = normalizeShortcutUrl(urlStr);
        if (!normalized) return '';
        const u = new URL(normalized);
        return u.hostname.replace(/^www\./, '');
    } catch { return ''; }
}

function normalizeShortcutUrl(value) {
    const raw = value.trim();
    if (!raw) return null;
    const candidate = /^https?:\/\//i.test(raw) ? raw :
        /^[a-z][a-z\d+.-]*:(?!\d)/i.test(raw) ? raw : `https://${raw}`;
    try {
        const url = new URL(candidate);
        return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : null;
    } catch { return null; }
}

function validShortcutUrl(input) {
    input.setCustomValidity('');
    const url = normalizeShortcutUrl(input.value);
    if (!url) {
        input.setCustomValidity('请输入有效的 http 或 https 网址');
        input.reportValidity();
        return null;
    }
    input.value = url;
    return url;
}

// ============ 设置面板 ============

function getAppVersion() {
    try { return chrome.runtime.getManifest().version; } catch { return '1.0.1'; }
}

let settingsTab = null;
let pendingImport = null;

function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dataStatus(message, error = false) {
    const el = document.getElementById('data-status');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', error);
}

function applyStoredData() {
    const loaded = MotabData.readStored(localStorage, Defaults);
    dismissUndo();
    Object.assign(State, loaded.data);
    reconcileDock();
    applyWallpaper();
    applyAppearance();
    updateClock();
    renderShortcuts();
    renderDock();
    if (folderPopupState.folder) refreshOpenFolderPopup();
    if (settingsTab && document.getElementById('settings-panel').classList.contains('show')) {
        showSettingsPanel(settingsTab);
    }
}

async function createPortableBackup(data = State) {
    const snapshot = MotabData.validateData(data);
    const assets = await MotabMedia.exportAssets(MotabData.assetIds(snapshot));
    return MotabData.makeBackup(snapshot, assets);
}

async function restorePortableBackup(backup) {
    const validated = MotabData.parseBackup(JSON.stringify(backup));
    // 先解码并写入素材，成功后才切换元数据；旧素材保留供撤销导入使用。
    await MotabMedia.importAssets(validated.assets);
    const current = MotabData.readStored(localStorage, Defaults).data;
    MotabData.importBackup(localStorage, current, validated);
    applyStoredData();
}

function initDataControls(body) {
    body.querySelector('#data-export').addEventListener('click', async () => {
        try {
            const backup = await createPortableBackup();
            downloadJson(`motab-backup-${backup.exportedAt.slice(0, 10)}.json`, backup);
            dataStatus('备份文件已下载。');
        } catch (error) { dataStatus(`导出失败：${error.message}`, true); }
    });
    body.querySelector('#data-select').addEventListener('click', () => body.querySelector('#data-file').click());
    body.querySelector('#data-file').addEventListener('change', async (event) => {
        pendingImport = null;
        body.querySelector('#data-apply').disabled = true;
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 40 * 1024 * 1024) { dataStatus('文件超过 40 MB，无法导入。', true); return; }
        try {
            const backup = MotabData.parseBackup(await file.text());
            const count = MotabData.counts(backup.data);
            pendingImport = backup;
            body.querySelector('#data-apply').disabled = false;
            dataStatus(`备份时间：${new Date(backup.exportedAt).toLocaleString()}\n快捷方式：${count.shortcuts} 个；文件夹：${count.folders} 个；底栏：${count.dock} 个。\n确认后将覆盖当前起始页数据。`);
        } catch (error) { dataStatus(`导入文件无效：${error.message}`, true); }
    });
    body.querySelector('#data-apply').addEventListener('click', async () => {
        if (!pendingImport || !confirm('用这份备份覆盖当前快捷方式和设置？导入前状态会保留，可在此处恢复。')) return;
        try {
            body.querySelector('#data-apply').disabled = true;
            await restorePortableBackup(pendingImport);
            pendingImport = null;
            dataStatus('导入完成。可以使用“恢复导入前状态”撤销本次导入。');
        } catch (error) { dataStatus(`导入失败，现有数据未改变：${error.message}`, true); body.querySelector('#data-apply').disabled = !pendingImport; }
    });
    body.querySelector('#data-undo').addEventListener('click', () => {
        if (!confirm('恢复到上次导入前的快捷方式和设置？导入后的修改也会被覆盖。')) return;
        try {
            MotabData.undoImport(localStorage);
            applyStoredData();
            dataStatus('已恢复导入前状态。');
        } catch (error) { dataStatus(`恢复失败：${error.message}`, true); }
    });
    const corruptButton = body.querySelector('#data-corrupt');
    if (corruptButton) corruptButton.addEventListener('click', () => {
        try {
            downloadJson('motab-damaged-data.json', JSON.parse(localStorage.getItem(MotabData.CORRUPT_KEY)));
            dataStatus('损坏数据原文已下载，可留作人工恢复。');
        } catch (error) { dataStatus(`下载失败：${error.message}`, true); }
    });
}

function showSettingsPanel(tab) {
    if (tab === 'wallpaper') { openAppearance('wallpaper'); return; }
    settingsTab = tab;
    const panel = document.getElementById('settings-panel');
    const body = document.getElementById('settings-body');
    document.getElementById('settings-title').textContent = { general:'常规设置', search:'搜索引擎偏好', wallpaper:'壁纸偏好', data:'数据管理', about:'关于' }[tab] || '设置';
    let html = '';
    if (tab === 'general') {
        html = `<div class="settings-section"><h4>显示</h4>
            <div class="setting-row"><div><div class="setting-label">显示秒数</div><div class="setting-desc">在时钟上显示秒</div></div><div class="toggle ${State.showSeconds?'active':''}" data-toggle="showSeconds"></div></div>
            <div class="setting-row"><div><div class="setting-label">显示日期</div><div class="setting-desc">在时钟下方显示日期</div></div><div class="toggle ${State.showDate?'active':''}" data-toggle="showDate"></div></div></div>
            <div class="settings-section"><h4>打开方式</h4>
            <div class="setting-row"><div><div class="setting-label">新标签页打开</div><div class="setting-desc">快捷方式在新标签页中打开</div></div><div class="toggle ${State.openInNewTab?'active':''}" data-toggle="openInNewTab"></div></div></div>
            <div class="settings-section"><h4>个性化</h4>
            <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:10px;">
                <div><div class="setting-label">图标圆角</div><div class="setting-desc">调节图标圆角弧度，从微圆四边形到圆形共 4 档</div></div>
                <div class="shape-group">${Object.entries(ICON_SHAPES).map(([n, s]) => `<div class="shape-item ${State.iconShape === Number(n) ? 'active' : ''}" data-shape="${n}"><span class="shape-swatch" style="border-radius:${s.radius};corner-shape:${s.shape}"></span><span class="shape-name">${s.name}</span></div>`).join('')}</div>
            </div></div>`;
    } else if (tab === 'search') {
        html = `<div class="settings-section"><h4>默认搜索引擎</h4><div class="select-group">${Object.entries(SearchEngines).map(([k,v]) => `<div class="select-item ${State.searchEngine===k?'active':''}" data-engine="${k}">${v.name}</div>`).join('')}</div></div>`;
    } else if (tab === 'wallpaper') {
        html = `<div class="settings-section"><h4>静态壁纸</h4><div class="wallpaper-grid">${Wallpapers.static.map(w => `<div class="wallpaper-preview ${State.wallpaper===w.id&&State.wallpaperType==='static'?'active':''}" data-wp="${w.id}" data-type="static" style="background:${w.thumb}"></div>`).join('')}</div></div>
            <div class="settings-section"><h4>动态壁纸</h4><div class="wallpaper-grid">${Wallpapers.live.map(w => `<div class="wallpaper-preview live ${State.wallpaper===w.id&&State.wallpaperType==='live'?'active':''}" data-wp="${w.id}" data-type="live" style="background:${w.thumb}"></div>`).join('')}</div></div>`;
    } else if (tab === 'data') {
        const hasUndo = Boolean(MotabData.readUndo(localStorage));
        const hasCorrupt = localStorage.getItem(MotabData.CORRUPT_KEY) !== null;
        html = `<div class="settings-section"><h4>备份与恢复</h4>
            <div class="setting-desc">备份包含快捷方式、文件夹、底栏、搜索和显示设置、壁纸选择与图标圆角个性化。</div>
            <div class="data-actions"><button class="btn btn-primary" id="data-export">导出备份</button>
            <button class="btn btn-secondary" id="data-select">选择备份文件</button></div>
            <input id="data-file" type="file" accept=".json,application/json" hidden>
            <div class="data-actions"><button class="btn btn-primary" id="data-apply" disabled>覆盖恢复</button>
            <button class="btn btn-secondary" id="data-undo" ${hasUndo ? '' : 'disabled'}>恢复导入前状态</button></div>
            ${hasCorrupt ? '<div class="data-actions"><button class="btn btn-secondary" id="data-corrupt">下载损坏数据原文</button></div>' : ''}
            <div class="data-status" id="data-status" role="status" aria-live="polite">请选择备份文件，预览内容后再恢复。</div></div>`;
    } else if (tab === 'about') {
        html = `<div class="settings-section"><div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;"><div class="setting-label" style="font-size:18px;font-weight:600;">末页 MoTab</div><div class="setting-desc">版本 ${getAppVersion()}</div><div class="setting-desc">一个简洁美观的浏览器起始页</div></div></div>`;
    }
    body.innerHTML = html;
    if (tab === 'general') {
        const appearanceButton = document.createElement('button');
        appearanceButton.className = 'btn btn-primary';
        appearanceButton.textContent = '图标与壁纸外观';
        appearanceButton.addEventListener('click', () => openAppearance('icons'));
        body.appendChild(appearanceButton);
    }
    panel.classList.add('show');
    body.querySelectorAll('.toggle').forEach(t => {
        t.addEventListener('click', () => { State[t.dataset.toggle] = !State[t.dataset.toggle]; t.classList.toggle('active'); saveDisplay(); updateClock(); });
    });
    body.querySelectorAll('[data-engine]').forEach(el => {
        el.addEventListener('click', () => { State.searchEngine = el.dataset.engine; saveSearchEngine(); body.querySelectorAll('[data-engine]').forEach(e => e.classList.remove('active')); el.classList.add('active'); });
    });
    body.querySelectorAll('[data-wp]').forEach(el => {
        el.addEventListener('click', () => { State.wallpaper = el.dataset.wp; State.wallpaperType = el.dataset.type; saveWallpaper(); applyWallpaper(); body.querySelectorAll('[data-wp]').forEach(e => e.classList.remove('active')); el.classList.add('active'); });
    });
    body.querySelectorAll('[data-shape]').forEach(el => {
        el.addEventListener('click', () => {
            State.iconShape = Number(el.dataset.shape);
            saveIconShape(); applyIconShape();
            body.querySelectorAll('[data-shape]').forEach(e => e.classList.remove('active'));
            el.classList.add('active');
        });
    });
    if (tab === 'data') initDataControls(body);
}

function hideSettingsPanel() { document.getElementById('settings-panel').classList.remove('show'); }

// ============ 文件夹弹层（iOS 风格，Web Animations API） ============
// 面板只动画 transform/opacity，背景独立淡入；不叠加父层透明度、子项缩放或多层模糊。
// 中断时先读取当前呈现状态再取消动画，避免快速开关跳到终点。

let folderPopupState = { folder: null, page: 0, perPage: 8 }; // 4列x2行=8个/页
let folderPopupMotion = null;
let folderPopupOrigin = null;

function cancelFolderPopupMotion() {
    if (!folderPopupMotion) return;
    folderPopupMotion.panel.cancel();
    folderPopupMotion.backdrop.cancel();
    folderPopupMotion = null;
}

function folderPopupIconTransform(content) {
    // 主网格可能因编辑、排序或跨标签页同步被重建，关闭时重新查找源图标。
    const item = [...document.querySelectorAll('#shortcuts-grid .shortcut-item')]
        .find(el => el.dataset.id === folderPopupState.folder?.id);
    const icon = item?.querySelector('.shortcut-icon') || folderPopupOrigin;
    if (!icon?.isConnected) return 'translate3d(0, 0, 0) scale(0.92)';
    const ir = icon.getBoundingClientRect();
    const popup = document.getElementById('folder-popup').getBoundingClientRect();
    // offsetWidth 不受正在运行的 transform 影响，始终以居中终态为基准。
    const dx = ir.left + ir.width / 2 - (popup.left + popup.width / 2);
    const dy = ir.top + ir.height / 2 - (popup.top + popup.height / 2);
    const scale = Math.max(0.05, Math.min(1, ir.width / content.offsetWidth));
    return `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;
}

function readFolderPopupPose(content, backdrop) {
    const style = getComputedStyle(content);
    return {
        panel: { transform: style.transform, opacity: style.opacity },
        backdrop: { opacity: getComputedStyle(backdrop).opacity },
    };
}

function animateFolderPopup(opening, from) {
    const popup = document.getElementById('folder-popup');
    const content = popup.querySelector('.folder-popup-content');
    const backdrop = popup.querySelector('.folder-popup-backdrop');
    const end = opening
        ? { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 }
        : { transform: folderPopupIconTransform(content), opacity: 0 };
    cancelFolderPopupMotion();
    popup.classList.toggle('closing', !opening);

    const finish = () => {
        cancelFolderPopupMotion();
        content.style.willChange = '';
        backdrop.style.willChange = '';
        if (!opening) {
            popup.classList.remove('show', 'closing');
            folderPopupState.folder = null;
            folderPopupOrigin = null;
        }
    };
    // 减少动态效果时立即切换；无 WAAPI 的环境也能正常开关。
    if (!content.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        finish();
        return;
    }
    content.style.willChange = 'transform, opacity';
    backdrop.style.willChange = 'opacity';
    const options = {
        duration: opening ? 360 : 260,
        easing: opening ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'both',
    };
    const motion = {
        panel: content.animate([from.panel, end], options),
        backdrop: backdrop.animate([from.backdrop, { opacity: opening ? 1 : 0 }], options),
    };
    folderPopupMotion = motion;
    motion.panel.addEventListener('finish', () => {
        if (folderPopupMotion === motion) finish();
    }, { once: true });
}

function settleFolderPopup() {
    if (!folderPopupMotion || document.getElementById('folder-popup').classList.contains('closing')) return;
    cancelFolderPopupMotion();
    document.querySelector('#folder-popup .folder-popup-content').style.willChange = '';
    document.querySelector('#folder-popup .folder-popup-backdrop').style.willChange = '';
}

function showFolderPopup(folder, originEl) {
    const popup = document.getElementById('folder-popup');
    const content = popup.querySelector('.folder-popup-content');
    const backdrop = popup.querySelector('.folder-popup-backdrop');
    const resuming = popup.classList.contains('show') && folderPopupState.folder?.id === folder.id;
    if (resuming && !popup.classList.contains('closing')) return;
    // 同一文件夹收起途中重开：保留图标 DOM、页码及当前画面，反向继续。
    let from = resuming ? readFolderPopupPose(content, backdrop) : null;
    cancelFolderPopupMotion();
    folderPopupState.folder = folder;
    folderPopupOrigin = originEl || (resuming ? folderPopupOrigin : null);
    if (!resuming) {
        folderPopupState.page = 0;
        renderFolderPopup(false); // 整体展开时不再叠加 8 个图标的缩放、错峰淡入。
        content.scrollTop = 0;
        from = {
            panel: { transform: folderPopupIconTransform(content), opacity: 0 },
            backdrop: { opacity: 0 },
        };
    }
    popup.classList.add('show');
    animateFolderPopup(true, from);
}

function hideFolderPopup() {
    const popup = document.getElementById('folder-popup');
    if (!popup.classList.contains('show') || popup.classList.contains('closing')) return;
    const content = popup.querySelector('.folder-popup-content');
    const backdrop = popup.querySelector('.folder-popup-backdrop');
    animateFolderPopup(false, readFolderPopupPose(content, backdrop));
}

function renderFolderPopup(animate = true) {
    const { folder } = folderPopupState;
    if (!folder) return;
    const children = folder.children || [];
    const totalPages = Math.max(1, Math.ceil(children.length / folderPopupState.perPage));
    const page = Math.min(folderPopupState.page, totalPages - 1);
    folderPopupState.page = page;
    const start = page * folderPopupState.perPage;
    const pageItems = children.slice(start, start + folderPopupState.perPage);

    document.getElementById('folder-popup-title').textContent = folder.name;
    document.getElementById('folder-popup-count').textContent = `${children.length} 个快捷方式`;

    const grid = document.getElementById('folder-popup-grid');
    grid.innerHTML = '';
    pageItems.forEach((child, i) => {
        const isLink = child.url;
        const el = document.createElement(isLink ? 'a' : 'div');
        el.className = 'folder-popup-item';
        el.setAttribute('aria-label', child.name);
        el.title = child.name;
        el.style.setProperty('--i', i);
        if (isLink) { el.href = child.url; el.target = '_blank'; el.rel = 'noopener'; el.draggable = false; }
        if (!animate) el.style.animation = 'none'; // 排序落位后的重绘不重播入场动画
        const icon = document.createElement('div');
        icon.className = 'shortcut-icon';
        buildIconInto(icon, child);
        const name = document.createElement('div');
        name.className = 'shortcut-name';
        name.textContent = child.name;
        el.appendChild(icon);
        el.appendChild(name);
        el.addEventListener('click', (ev) => {
            if (isLink && !State.openInNewTab) {
                ev.preventDefault();
                window.location.href = child.url;
            }
        });

        // 拖出弹层 + 右键菜单
        el.dataset.childId = child.id;
        el.addEventListener('mousedown', (ev) => { if (ev.button === 0) startDrag(el, ev, 'popup'); });
        el.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            showContextMenu(ev.clientX, ev.clientY, { item: child, type: 'popup' });
        });
        grid.appendChild(el);
    });

    const dots = document.getElementById('folder-popup-dots');
    dots.innerHTML = '';
    for (let i = 0; i < totalPages; i++) {
        const dot = document.createElement('div');
        dot.className = 'folder-popup-dot' + (i === page ? ' active' : '');
        dot.addEventListener('click', () => { folderPopupState.page = i; renderFolderPopup(); });
        dots.appendChild(dot);
    }
    dots.style.display = totalPages > 1 ? '' : 'none';
    document.getElementById('folder-popup-nav').style.display = totalPages > 1 ? '' : 'none';
}

// ============ 搜索 ============

function initSearch() {
    const input = document.getElementById('search-input');
    const box = document.getElementById('search-box');
    const btn = document.getElementById('search-btn');
    input.addEventListener('focus', () => box.classList.add('focused'));
    input.addEventListener('blur', () => { if (!input.value) box.classList.remove('focused'); });
    function doSearch() {
        const q = input.value.trim();
        if (!q) return;
        window.location.href = (SearchEngines[State.searchEngine] || SearchEngines.baidu).url + encodeURIComponent(q);
    }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    btn.addEventListener('click', doSearch);
}

// ============ 右键菜单行为 ============

function initContextMenu() {
    const menu = document.getElementById('context-menu');
    menu.querySelectorAll('.context-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            const target = State.contextTarget;
            if (!target) return;
            if (action === 'edit') showEditModal(target.item);
            else if (action === 'customize-icon') customizeShortcutIcon(target.item);
            else if (action === 'to-dock' && target.item.type !== 'folder') {
                State.dock = MotabData.pinShortcut(State, target.item.id).dock;
                saveDock(); renderDock();
            } else if (action === 'move-to-folder' && target.type !== 'dock' && target.item.type !== 'folder') {
                showMoveModal(target.item);
            } else if (action === 'open-all' && target.item.type === 'folder') {
                const children = target.item.children || [];
                if (!children.length) alert('文件夹里还没有快捷方式。');
                else if (children.length <= 5 || confirm(`将打开 ${children.length} 个标签页，继续吗？`)) {
                    children.forEach(child => chrome.tabs.create({ url: child.url, active: false }));
                }
            } else if (action === 'to-grid' && target.type === 'popup') {
                const loc = findItemLocation(target.item.id);
                if (loc && loc.folder) {
                    loc.list.splice(loc.index, 1);
                    State.shortcuts.push(loc.item);
                    saveShortcuts();
                    renderShortcuts();
                    refreshOpenFolderPopup();
                }
            } else if (action === 'delete') {
                const it = target.item;
                if (it.type === 'folder' && !confirm(`删除文件夹「${it.name}」及其中 ${it.children.length} 个快捷方式？`)) {
                    hideContextMenu();
                    return;
                }
                if (target.type !== 'dock' && it.type !== 'folder' && State.dock.some(d => d.id === it.id) &&
                    !confirm(`删除「${it.name}」也会从底栏移除对应的固定项。继续吗？`)) {
                    hideContextMenu();
                    return;
                }
                if (target.type === 'dock') {
                    const snapshot = snapshotForUndo();
                    State.dock = State.dock.filter(d => d.id !== it.id);
                    saveDock(); renderDock();
                    showUndo('已从底栏移除', snapshot);
                } else {
                    const loc = findItemLocation(it.id);
                    if (loc) {
                        const snapshot = snapshotForUndo();
                        const oldDockLength = State.dock.length;
                        const updated = MotabData.removeShortcut(State, it.id);
                        State.shortcuts = updated.shortcuts;
                        State.dock = updated.dock;
                        saveShortcuts();
                        if (State.dock.length !== oldDockLength) saveDock();
                        renderShortcuts();
                        renderDock();
                        if (target.type === 'popup') refreshOpenFolderPopup();
                        showUndo(`已删除「${it.name}」`, snapshot);
                    }
                }
            }
            hideContextMenu();
        });
    });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) hideContextMenu(); });
}

// ============ 弹窗行为 ============

function initModals() {
    document.getElementById('add-cancel').addEventListener('click', hideAddModal);
    document.getElementById('edit-cancel').addEventListener('click', hideEditModal);
    document.getElementById('move-cancel').addEventListener('click', hideMoveModal);
    document.getElementById('move-confirm').addEventListener('click', () => {
        const id = document.getElementById('move-modal').dataset.id;
        const folderId = document.getElementById('move-target').value;
        const loc = findItemLocation(id);
        if (!loc || (loc.folder?.id || '') === folderId) { hideMoveModal(); return; }
        try { State.shortcuts = MotabData.moveShortcut(State, id, folderId).shortcuts; }
        catch (error) { alert(error.message); hideMoveModal(); return; }
        saveShortcuts();
        renderShortcuts();
        refreshOpenFolderPopup();
        hideMoveModal();
    });
    document.getElementById('undo-delete').addEventListener('click', () => {
        if (!undoSnapshot) return;
        const snapshot = undoSnapshot;
        State.shortcuts = snapshot.shortcuts;
        State.dock = snapshot.dock;
        saveShortcuts();
        saveDock();
        renderShortcuts();
        renderDock();
        refreshOpenFolderPopup();
    });

    // "创建为文件夹"切换：文件夹没有网址
    document.getElementById('add-is-folder').addEventListener('change', (e) => {
        document.getElementById('add-url-group').style.display = e.target.checked ? 'none' : '';
    });

    // 网址失焦时自动建议名称
    document.getElementById('add-url').addEventListener('blur', () => {
        const nameInput = document.getElementById('add-name');
        const suggested = suggestNameFromUrl(document.getElementById('add-url').value.trim());
        if (!nameInput.value.trim() && suggested) nameInput.value = suggested;
    });
    for (const id of ['add-url', 'edit-url']) {
        document.getElementById(id).addEventListener('input', (e) => e.target.setCustomValidity(''));
    }

    document.getElementById('add-confirm').addEventListener('click', () => {
        const name = document.getElementById('add-name').value.trim();
        const isFolder = document.getElementById('add-is-folder').checked;
        if (!name) { document.getElementById('add-name').focus(); return; }
        const url = isFolder ? null : validShortcutUrl(document.getElementById('add-url'));
        if (!isFolder && !url) return;
        if (isFolder) {
            State.shortcuts.push({ id: 'f' + Date.now(), name, type: 'folder', children: [] });
        } else {
            State.shortcuts.push({ id: 's' + Date.now(), name, url });
        }
        saveShortcuts(); renderShortcuts(); hideAddModal();
    });

    document.getElementById('edit-confirm').addEventListener('click', () => {
        const id = document.getElementById('edit-modal').dataset.id;
        const name = document.getElementById('edit-name').value.trim();
        const source = document.getElementById('edit-modal').dataset.source;
        const loc = findItemLocation(id);
        const item = loc?.item || (source === 'dock' ? State.dock.find(d => d.id === id) : null);
        if (!item) { hideEditModal(); return; }
        if (item.type === 'folder' || (source === 'dock' && item.url === 'javascript:void(0)')) {
            if (!name) return;
            item.name = name;
        } else {
            if (!name) { document.getElementById('edit-name').focus(); return; }
            const url = validShortcutUrl(document.getElementById('edit-url'));
            if (!url) return;
            item.name = name; item.url = url;
        }
        if (loc) {
            saveShortcuts(); renderShortcuts();
            reconcileDock();
            renderDock();
            if (folderPopupState.folder) refreshOpenFolderPopup();
        } else {
            saveDock(); renderDock();
        }
        hideEditModal();
    });

    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('show'); });
    });
}

// ============ 设置下拉 ============

function initDropdown() {
    const btn = document.getElementById('settings-btn');
    const menu = document.getElementById('settings-menu');
    btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('show'); });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== btn) menu.classList.remove('show'); });
    menu.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            menu.classList.remove('show');
            const action = item.dataset.action;
            if (['general','search','wallpaper','data','about'].includes(action)) showSettingsPanel(action);
        });
    });
    document.getElementById('close-settings').addEventListener('click', hideSettingsPanel);
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('settings-panel');
        if (panel.classList.contains('show') && !panel.contains(e.target) && !e.target.closest('#settings-btn') && !e.target.closest('#settings-menu')) {
            hideSettingsPanel();
        }
    });
}

// ============ 全局键盘 ============

function initKeyboard() {
    document.addEventListener('keydown', (e) => {
        const popup = document.getElementById('folder-popup');
        if (e.key === 'Escape') {
            if (document.querySelector('#appearance-panel:not([hidden]), #custom-icon-panel:not([hidden])')) return;
            document.getElementById('layout-menu').hidden = true;
            if (dragState) { cancelLayoutDrag(); return; }
            if (popup.classList.contains('show')) { hideFolderPopup(); return; }
            if (layoutEditing) { setLayoutEditing(false); return; }
            hideContextMenu();
            return;
        }
        if (!popup.classList.contains('show')) return;
        const total = Math.max(1, Math.ceil((folderPopupState.folder?.children?.length || 0) / folderPopupState.perPage));
        if (e.key === 'ArrowLeft' && folderPopupState.page > 0) { folderPopupState.page--; renderFolderPopup(); }
        else if (e.key === 'ArrowRight' && folderPopupState.page < total - 1) { folderPopupState.page++; renderFolderPopup(); }
    });
}

// ============ 入口 ============

function init() {
    updateClock();
    setInterval(updateClock, 1000);
    applyWallpaper();
    applyAppearance();
    renderShortcuts();
    reconcileDock();
    renderDock();
    initSearch();
    initContextMenu();
    initModals();
    initDropdown();
    initDragDrop();
    initDockDrag();
    initDockMagnify(); // 只绑定一次，避免 renderDock 反复调用时堆叠监听器
    initKeyboard();
    initLayoutEditing();
    initAppearanceControls();
    document.getElementById('add-shortcut').addEventListener('click', showAddModal);
    document.getElementById('folder-popup-close').addEventListener('click', hideFolderPopup);
    document.getElementById('folder-popup').addEventListener('click', (e) => { 
        if (e.target === document.getElementById('folder-popup') || e.target.classList.contains('folder-popup-backdrop')) {
            hideFolderPopup();
        }
    });
    if (Object.keys(storedState.invalid).length) {
        alert(corruptPreserved
            ? '检测到部分本地数据损坏，已暂用默认值并保留原始内容。可在“数据管理”下载损坏数据。'
            : '检测到部分本地数据损坏，且无法保存原始内容。请先检查浏览器存储空间。');
    }
}

let storageSyncTimer = null;
window.addEventListener('storage', (event) => {
    const relevant = event.key === null || Object.values(MotabData.FIELDS).includes(event.key) ||
        event.key === MotabData.UNDO_KEY || event.key === MotabData.CORRUPT_KEY;
    if (!relevant) return;
    clearTimeout(storageSyncTimer);
    storageSyncTimer = setTimeout(function sync() {
        if (dragState) { storageSyncTimer = setTimeout(sync, 250); return; }
        applyStoredData();
    }, 80);
});

document.addEventListener('DOMContentLoaded', init);
