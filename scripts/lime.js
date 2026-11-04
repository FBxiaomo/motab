const Storage = {
    get(key, def = null) {
        try {
            const v = localStorage.getItem(key);
            return v ? JSON.parse(v) : def;
        } catch { return def; }
    },
    set(key, val) {
        localStorage.setItem(key, JSON.stringify(val));
    }
};

const Defaults = {
    shortcuts: [
        { id: 'folder-tools', name: '工具', type: 'folder', children: [
            { id: 's1', name: '翻译', url: 'https://fanyi.baidu.com' },
            { id: 's2', name: '截图', url: 'https://snipaste.com' },
        ]},
        { id: 's3', name: 'QQ邮箱', url: 'https://mail.qq.com' },
        { id: 's4', name: '网易云音乐', url: 'https://music.163.com' },
        { id: 's5', name: '哔哩哔哩', url: 'https://www.bilibili.com' },
        { id: 's6', name: '微博', url: 'https://weibo.com' },
        { id: 's7', name: '知乎', url: 'https://www.zhihu.com' },
        { id: 's8', name: 'GitHub', url: 'https://github.com' },
        { id: 'folder-ai', name: 'AI', type: 'folder', children: [
            { id: 'ai1', name: 'ChatGPT', url: 'https://chat.openai.com' },
            { id: 'ai2', name: '豆包', url: 'https://www.doubao.com' },
            { id: 'ai3', name: '文心一言', url: 'https://yiyan.baidu.com' },
            { id: 'ai4', name: '通义千问', url: 'https://tongyi.aliyun.com' },
        ]},
    ],
    dock: [
        { id: 'd1', name: '应用列表', url: 'javascript:void(0)' },
        { id: 'd2', name: 'QQ邮箱', url: 'https://mail.qq.com' },
        { id: 'd3', name: 'D-Codex', url: 'https://d-codex.com' },
    ],
    wallpaper: 'lilac',
    wallpaperType: 'static',
    searchEngine: 'baidu',
    showSeconds: false,
    showDate: true,
};

const State = {
    shortcuts: Storage.get('motab_shortcuts', Defaults.shortcuts),
    dock: Storage.get('motab_dock', Defaults.dock),
    wallpaper: Storage.get('motab_wallpaper', Defaults.wallpaper),
    wallpaperType: Storage.get('motab_wallpaperType', Defaults.wallpaperType),
    searchEngine: Storage.get('motab_searchEngine', Defaults.searchEngine),
    showSeconds: Storage.get('motab_showSeconds', Defaults.showSeconds),
    showDate: Storage.get('motab_showDate', Defaults.showDate),
    contextTarget: null,
};

function saveShortcuts() { Storage.set('motab_shortcuts', State.shortcuts); }
function saveDock() { Storage.set('motab_dock', State.dock); }
function saveWallpaper() { Storage.set('motab_wallpaper', State.wallpaper); Storage.set('motab_wallpaperType', State.wallpaperType); }
function saveSearchEngine() { Storage.set('motab_searchEngine', State.searchEngine); }
function saveDisplay() { Storage.set('motab_showSeconds', State.showSeconds); Storage.set('motab_showDate', State.showDate); }

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

function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('time').textContent = State.showSeconds ? `${h}:${m}:${s}` : `${h}:${m}`;

    if (State.showDate) {
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]}`;
        document.getElementById('date').textContent = dateStr;
        document.getElementById('date').style.display = 'block';
    } else {
        document.getElementById('date').style.display = 'none';
    }
}

function applyWallpaper() {
    const wpEl = document.getElementById('wallpaper');
    if (State.wallpaperType === 'live') {
        const wp = Wallpapers.live.find(w => w.id === State.wallpaper);
        if (wp) {
            wpEl.style.background = 'transparent';
            let video = wpEl.querySelector('video');
            if (!video) {
                video = document.createElement('video');
                video.autoplay = true;
                video.muted = true;
                video.loop = true;
                video.playsInline = true;
                video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                wpEl.appendChild(video);
            }
            video.src = wp.video;
        }
    } else {
        const wp = Wallpapers.static.find(w => w.id === State.wallpaper) || Wallpapers.static[0];
        wpEl.style.background = wp.url;
        const video = wpEl.querySelector('video');
        if (video) video.remove();
    }
}

function renderShortcuts() {
    const grid = document.getElementById('shortcuts-grid');
    grid.innerHTML = '';
    State.shortcuts.forEach(item => {
        grid.appendChild(createShortcutEl(item, 'grid'));
    });
}

function getFaviconURL(url) {
    try {
        const domain = new URL(url).hostname;
        return `https://api.iowen.cn/favicon/${domain}.png`;
    } catch {
        return null;
    }
}

function getIconHTML(item) {
    const favUrl = item.url ? getFaviconURL(item.url) : null;
    if (favUrl) {
        const fallbackUrl = item.url ? `https://www.google.com/s2/favicons?domain=${new URL(item.url).hostname}&sz=64` : '';
        return `<img src="${favUrl}" alt="${item.name}" ` +
               `onerror="if(this.src!=='${fallbackUrl}'){this.src='${fallbackUrl}';}else{this.style.display='none';this.nextElementSibling.style.display='flex';}">` +
               `<span class="icon-fallback" style="display:none">${item.name.charAt(0)}</span>`;
    }
    return `<span class="icon-fallback">${item.name.charAt(0)}</span>`;
}

function createShortcutEl(item, type) {
    const wrap = document.createElement('div');
    wrap.className = 'shortcut-item';
    wrap.dataset.id = item.id;
    wrap.dataset.type = type;

    const icon = document.createElement('div');
    icon.className = 'shortcut-icon' + (item.type === 'folder' ? ' folder' : '');

    if (item.type === 'folder') {
        const previews = item.children.slice(0, 4);
        previews.forEach(child => {
            const mini = document.createElement('div');
            mini.className = 'mini-icon';
            const favUrl = getFaviconURL(child.url);
            const fallbackUrl = `https://www.google.com/s2/favicons?domain=${new URL(child.url).hostname}&sz=64`;
            if (favUrl) {
                const img = document.createElement('img');
                img.src = favUrl;
                img.alt = child.name;
                img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:3px;';
                img.onerror = function() {
                    if (this.src !== fallbackUrl) {
                        this.src = fallbackUrl;
                    } else {
                        this.style.display = 'none';
                        this.nextElementSibling.style.display = 'block';
                    }
                };
                mini.appendChild(img);
                const fallback = document.createElement('span');
                fallback.textContent = child.name.charAt(0);
                fallback.style.cssText = 'display:none;font-size:13px;font-weight:500;color:#555;';
                mini.appendChild(fallback);
            } else {
                mini.textContent = child.name.charAt(0);
            }
            icon.appendChild(mini);
        });
    } else {
        icon.innerHTML = getIconHTML(item);
    }

    const name = document.createElement('div');
    name.className = 'shortcut-name';
    name.textContent = item.name;

    wrap.appendChild(icon);
    wrap.appendChild(name);

    wrap.addEventListener('click', (e) => {
        if (e.detail === 0) return;
        onShortcutClick(item, type);
    });

    wrap.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, { item, type });
    });

    return wrap;
}

function renderDock() {
    const inner = document.getElementById('dock-inner');
    inner.innerHTML = '';
    State.dock.forEach(item => {
        const d = document.createElement('div');
        d.className = 'dock-item';
        d.dataset.id = item.id;

        const favUrl = getFaviconURL(item.url);
        if (favUrl) {
            const fallbackUrl = `https://www.google.com/s2/favicons?domain=${new URL(item.url).hostname}&sz=64`;
            const img = document.createElement('img');
            img.src = favUrl;
            img.alt = item.name;
            img.onerror = function() {
                if (this.src !== fallbackUrl) {
                    this.src = fallbackUrl;
                } else {
                    this.style.display = 'none';
                    this.nextElementSibling.style.display = 'block';
                }
            };
            d.appendChild(img);
            const fallback = document.createElement('span');
            fallback.textContent = item.name.charAt(0);
            fallback.className = 'dock-fallback';
            fallback.style.cssText = 'display:none;font-size:20px;font-weight:500;color:#444;';
            d.appendChild(fallback);
        } else {
            d.textContent = item.name.charAt(0);
        }

        const tip = document.createElement('div');
        tip.className = 'dock-tooltip';
        tip.textContent = item.name;
        d.appendChild(tip);

        d.addEventListener('click', () => {
            if (item.url && item.url !== 'javascript:void(0)') {
                window.location.href = item.url;
            }
        });

        d.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY, { item, type: 'dock' });
        });

        inner.appendChild(d);
    });
}

function onShortcutClick(item, type) {
    if (item.type === 'folder') {
        alert('文件夹功能开发中...');
        return;
    }
    window.location.href = item.url;
}

function showContextMenu(x, y, target) {
    const menu = document.getElementById('context-menu');
    State.contextTarget = target;

    const toDockItem = menu.querySelector('[data-action="to-dock"]');
    if (target.type === 'dock') {
        toDockItem.style.display = 'none';
    } else {
        toDockItem.style.display = 'flex';
    }

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('show');

    setTimeout(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
        }
    }, 0);
}

function hideContextMenu() {
    document.getElementById('context-menu').classList.remove('show');
    State.contextTarget = null;
}

function showAddModal() {
    document.getElementById('add-name').value = '';
    document.getElementById('add-url').value = 'https://';
    document.getElementById('add-modal').classList.add('show');
    document.getElementById('add-name').focus();
}

function hideAddModal() {
    document.getElementById('add-modal').classList.remove('show');
}

function showEditModal(item) {
    document.getElementById('edit-name').value = item.name;
    document.getElementById('edit-url').value = item.url || '';
    document.getElementById('edit-modal').classList.add('show');
    document.getElementById('edit-name').focus();
    document.getElementById('edit-modal').dataset.id = item.id;
}

function hideEditModal() {
    document.getElementById('edit-modal').classList.remove('show');
}

function showSettingsPanel(tab) {
    const panel = document.getElementById('settings-panel');
    const title = document.getElementById('settings-title');
    const body = document.getElementById('settings-body');

    const titles = {
        general: '常规设置',
        search: '搜索引擎偏好',
        wallpaper: '壁纸偏好',
        about: '关于',
    };
    title.textContent = titles[tab] || '设置';

    let html = '';
    if (tab === 'general') {
        html = `
            <div class="settings-section">
                <h4>显示</h4>
                <div class="setting-row">
                    <div>
                        <div class="setting-label">显示秒数</div>
                        <div class="setting-desc">在时钟上显示秒</div>
                    </div>
                    <div class="toggle ${State.showSeconds ? 'active' : ''}" data-toggle="showSeconds"></div>
                </div>
                <div class="setting-row">
                    <div>
                        <div class="setting-label">显示日期</div>
                        <div class="setting-desc">在时钟下方显示日期</div>
                    </div>
                    <div class="toggle ${State.showDate ? 'active' : ''}" data-toggle="showDate"></div>
                </div>
            </div>
        `;
    } else if (tab === 'search') {
        html = `
            <div class="settings-section">
                <h4>默认搜索引擎</h4>
                <div class="select-group">
                    ${Object.entries(SearchEngines).map(([k, v]) => `
                        <div class="select-item ${State.searchEngine === k ? 'active' : ''}" data-engine="${k}">
                            ${v.name}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } else if (tab === 'wallpaper') {
        html = `
            <div class="settings-section">
                <h4>静态壁纸</h4>
                <div class="wallpaper-grid">
                    ${Wallpapers.static.map(w => `
                        <div class="wallpaper-preview ${State.wallpaper === w.id && State.wallpaperType === 'static' ? 'active' : ''}"
                             data-wp="${w.id}" data-type="static"
                             style="background:${w.thumb}">
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="settings-section">
                <h4>动态壁纸</h4>
                <div class="wallpaper-grid">
                    ${Wallpapers.live.map(w => `
                        <div class="wallpaper-preview live ${State.wallpaper === w.id && State.wallpaperType === 'live' ? 'active' : ''}"
                             data-wp="${w.id}" data-type="live"
                             style="background:${w.thumb}">
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } else if (tab === 'about') {
        html = `
            <div class="settings-section">
                <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
                    <div class="setting-label" style="font-size:18px;font-weight:600;">末页 MoTab</div>
                    <div class="setting-desc">版本 1.0.0</div>
                    <div class="setting-desc">一个简洁美观的浏览器起始页</div>
                </div>
            </div>
        `;
    }

    body.innerHTML = html;
    panel.classList.add('show');

    body.querySelectorAll('.toggle').forEach(t => {
        t.addEventListener('click', () => {
            const key = t.dataset.toggle;
            State[key] = !State[key];
            t.classList.toggle('active');
            saveDisplay();
            updateClock();
        });
    });

    body.querySelectorAll('[data-engine]').forEach(el => {
        el.addEventListener('click', () => {
            State.searchEngine = el.dataset.engine;
            saveSearchEngine();
            body.querySelectorAll('[data-engine]').forEach(e => e.classList.remove('active'));
            el.classList.add('active');
        });
    });

    body.querySelectorAll('[data-wp]').forEach(el => {
        el.addEventListener('click', () => {
            State.wallpaper = el.dataset.wp;
            State.wallpaperType = el.dataset.type;
            saveWallpaper();
            applyWallpaper();
            body.querySelectorAll('[data-wp]').forEach(e => e.classList.remove('active'));
            el.classList.add('active');
        });
    });
}

function hideSettingsPanel() {
    document.getElementById('settings-panel').classList.remove('show');
}

function initSearch() {
    const input = document.getElementById('search-input');
    const box = document.getElementById('search-box');
    const btn = document.getElementById('search-btn');

    input.addEventListener('focus', () => box.classList.add('focused'));
    input.addEventListener('blur', () => {
        if (!input.value) box.classList.remove('focused');
    });

    function doSearch() {
        const q = input.value.trim();
        if (!q) return;
        const engine = SearchEngines[State.searchEngine] || SearchEngines.baidu;
        window.location.href = engine.url + encodeURIComponent(q);
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
    });
    btn.addEventListener('click', doSearch);
}

function initContextMenu() {
    const menu = document.getElementById('context-menu');
    menu.querySelectorAll('.context-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            const target = State.contextTarget;
            if (!target) return;

            if (action === 'edit') {
                if (target.type !== 'dock') {
                    showEditModal(target.item);
                }
            } else if (action === 'to-dock') {
                if (target.item.type !== 'folder') {
                    const exists = State.dock.find(d => d.id === target.item.id);
                    if (!exists) {
                        State.dock.push({ ...target.item });
                        saveDock();
                        renderDock();
                    }
                }
            } else if (action === 'delete') {
                if (target.type === 'grid') {
                    State.shortcuts = State.shortcuts.filter(s => s.id !== target.item.id);
                    saveShortcuts();
                    renderShortcuts();
                } else if (target.type === 'dock') {
                    State.dock = State.dock.filter(d => d.id !== target.item.id);
                    saveDock();
                    renderDock();
                }
            }
            hideContextMenu();
        });
    });

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) hideContextMenu();
    });
}

function initModals() {
    document.getElementById('add-cancel').addEventListener('click', hideAddModal);
    document.getElementById('edit-cancel').addEventListener('click', hideEditModal);

    document.getElementById('add-confirm').addEventListener('click', () => {
        const name = document.getElementById('add-name').value.trim();
        const url = document.getElementById('add-url').value.trim();
        if (!name || !url) return;

        const id = 's' + Date.now();
        State.shortcuts.push({ id, name, url });
        saveShortcuts();
        renderShortcuts();
        hideAddModal();
    });

    document.getElementById('edit-confirm').addEventListener('click', () => {
        const id = document.getElementById('edit-modal').dataset.id;
        const name = document.getElementById('edit-name').value.trim();
        const url = document.getElementById('edit-url').value.trim();
        if (!name || !url) return;

        const item = State.shortcuts.find(s => s.id === id);
        if (item) {
            item.name = name;
            item.url = url;
            saveShortcuts();
            renderShortcuts();
        }
        hideEditModal();
    });

    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', (e) => {
            if (e.target === m) m.classList.remove('show');
        });
    });
}

function initDropdown() {
    const btn = document.getElementById('settings-btn');
    const menu = document.getElementById('settings-menu');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && e.target !== btn) {
            menu.classList.remove('show');
        }
    });

    menu.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            menu.classList.remove('show');
            if (['general', 'search', 'wallpaper', 'about'].includes(action)) {
                showSettingsPanel(action);
            } else if (action === 'donate') {
                alert('感谢支持！');
            } else if (action === 'help') {
                alert('帮助和反馈');
            } else if (action === 'extension') {
                alert('浏览器扩展');
            }
        });
    });

    document.getElementById('close-settings').addEventListener('click', hideSettingsPanel);
}

function init() {
    updateClock();
    setInterval(updateClock, 1000);
    applyWallpaper();
    renderShortcuts();
    renderDock();
    initSearch();
    initContextMenu();
    initModals();
    initDropdown();

    document.getElementById('add-shortcut').addEventListener('click', showAddModal);

    document.getElementById('avatar-btn').addEventListener('click', () => {
        alert('用户中心 - 开发中');
    });
}

document.addEventListener('DOMContentLoaded', init);
