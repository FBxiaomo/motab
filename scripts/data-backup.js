// MoTab backup format and storage operations. No browser UI dependencies.
(function (root) {
    'use strict';

    const FORMAT = 'motab-backup';
    const VERSION = 2;
    const MAX_ASSET_BYTES = 8 * 1024 * 1024;
    const MAX_ASSETS_BYTES = 24 * 1024 * 1024;
    const MAX_ASSETS = 256;
    const UNDO_KEY = 'motab_undo_import';
    const CORRUPT_KEY = 'motab_corrupt_backup';
    const FIELDS = {
        shortcuts: 'motab_shortcuts',
        dock: 'motab_dock',
        wallpaper: 'motab_wallpaper',
        wallpaperType: 'motab_wallpaperType',
        searchEngine: 'motab_searchEngine',
        showSeconds: 'motab_showSeconds',
        showDate: 'motab_showDate',
        openInNewTab: 'motab_openInNewTab',
        iconShape: 'motab_iconShape',
        appearance: 'motab_appearance',
        wallpaperSettings: 'motab_wallpaperSettings',
    };
    const STATIC_WALLPAPERS = new Set(['lilac', 'lavender', 'dusk', 'ocean', 'sunset', 'night']);
    const LIVE_WALLPAPERS = new Set(['live1', 'live2', 'live3', 'live4']);
    const SEARCH_ENGINES = new Set(['baidu', 'google', 'bing', 'duckduckgo']);
    const DEFAULTS = {
        shortcuts: [
            { id: 'folder-tools', name: '工具', type: 'folder', children: [
                { id: 's1', name: '翻译', url: 'https://fanyi.baidu.com' },
                { id: 's2', name: '截图', url: 'https://snipaste.com' },
            ] },
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
            ] },
        ],
        dock: [
            { id: 'd1', name: '应用列表', url: 'javascript:void(0)' },
            { id: 'd2', name: 'QQ邮箱', url: 'https://mail.qq.com' },
            { id: 'd3', name: 'D-Codex', url: 'https://d-codex.com' },
        ],
        wallpaper: 'lilac', wallpaperType: 'static', searchEngine: 'baidu',
        showSeconds: false, showDate: true, openInNewTab: true,
        iconShape: 2,
        appearance: { iconSize: 'medium', showNames: true, iconStyle: 'original', tint: '#B19CD9' },
        wallpaperSettings: { assetId: null, x: 50, y: 50, zoom: 1, blur: 0, dim: 8 },
    };

    function fail(message) { throw new Error(message); }
    function plainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }
    function validWebUrl(value) {
        if (typeof value !== 'string') return false;
        try {
            const url = new URL(value);
            return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
        } catch { return false; }
    }
    function canonicalWebUrl(value) {
        if (!validWebUrl(value)) fail('请输入有效的 http 或 https 网址');
        return new URL(value).href;
    }
    function validAssetId(value) {
        return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
    }
    function cleanAppearance(value) {
        if (value === undefined) return { ...DEFAULTS.appearance };
        if (!plainObject(value)) fail('桌面外观设置无效');
        const data = Object.fromEntries(Object.entries(DEFAULTS.appearance).map(([key, fallback]) =>
            [key, value[key] === undefined ? fallback : value[key]]));
        if (!['small', 'medium', 'large'].includes(data.iconSize) || typeof data.showNames !== 'boolean' ||
            !['original', 'light', 'dark', 'tinted'].includes(data.iconStyle) ||
            typeof data.tint !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(data.tint)) fail('桌面外观设置无效');
        return data;
    }
    function cleanWallpaperSettings(value) {
        if (value === undefined) return { ...DEFAULTS.wallpaperSettings };
        if (!plainObject(value)) fail('壁纸调整设置无效');
        const data = Object.fromEntries(Object.entries(DEFAULTS.wallpaperSettings).map(([key, fallback]) =>
            [key, value[key] === undefined ? fallback : value[key]]));
        if (data.assetId !== null && !validAssetId(data.assetId)) fail('壁纸图片引用无效');
        for (const [key, min, max] of [['x', 0, 100], ['y', 0, 100], ['zoom', 1, 2], ['blur', 0, 20], ['dim', 0, 60]]) {
            if (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < min || data[key] > max) {
                fail('壁纸调整设置无效');
            }
        }
        return data;
    }
    function cleanItem(value, path, allowAction = false) {
        if (!plainObject(value) || typeof value.id !== 'string' || !value.id.trim() ||
            typeof value.name !== 'string' || !value.name.trim()) {
            fail(`${path} 缺少有效的 ID 或名称`);
        }
        if (value.type === 'folder') {
            if (allowAction || !Array.isArray(value.children)) fail(`${path} 的文件夹结构无效`);
            const childIds = new Set();
            const children = value.children.map((child, index) => {
                if (child && child.type === 'folder') fail(`${path} 不支持嵌套文件夹`);
                const cleaned = cleanItem(child, `${path} / 子项 ${index + 1}`);
                if (childIds.has(cleaned.id)) fail(`${path} 中存在重复的子项 ID`);
                childIds.add(cleaned.id);
                return cleaned;
            });
            return { id: value.id, name: value.name, type: 'folder', children };
        }
        if (!validWebUrl(value.url) && !(allowAction && value.url === 'javascript:void(0)')) {
            fail(`${path} 的网址无效或不是 http/https`);
        }
        const cleaned = { id: value.id, name: value.name, url: value.url };
        if (value.iconAsset !== undefined) {
            if (!validAssetId(value.iconAsset)) fail(`${path} 的图标图片引用无效`);
            cleaned.iconAsset = value.iconAsset;
        }
        return cleaned;
    }
    function cleanList(value, path, allowAction) {
        if (!Array.isArray(value)) fail(`${path} 应为列表`);
        const ids = new Set();
        return value.map((item, index) => {
            const cleaned = cleanItem(item, `${path}第 ${index + 1} 项`, allowAction);
            if (ids.has(cleaned.id)) fail(`${path}存在重复的 ID`);
            ids.add(cleaned.id);
            return cleaned;
        });
    }
    function validateData(value) {
        if (!plainObject(value)) fail('备份缺少数据对象');
        const data = {
            shortcuts: cleanList(value.shortcuts, '快捷方式', false),
            dock: cleanList(value.dock, '底栏', true),
            wallpaper: value.wallpaper,
            wallpaperType: value.wallpaperType,
            searchEngine: value.searchEngine,
            showSeconds: value.showSeconds,
            showDate: value.showDate,
            openInNewTab: value.openInNewTab,
            // 新字段缺省时补默认值，兼容旧本地数据与 v1 备份。
            iconShape: value.iconShape === undefined ? DEFAULTS.iconShape : value.iconShape,
            appearance: cleanAppearance(value.appearance),
            wallpaperSettings: cleanWallpaperSettings(value.wallpaperSettings),
        };
        const shortcutIds = new Set();
        for (const item of data.shortcuts) {
            for (const entry of item.type === 'folder' ? [item, ...item.children] : [item]) {
                if (shortcutIds.has(entry.id)) fail('快捷方式与文件夹中存在重复的 ID');
                shortcutIds.add(entry.id);
            }
        }
        if (data.wallpaperType !== 'static' && data.wallpaperType !== 'live') fail('壁纸类型无效');
        const choices = data.wallpaperType === 'live' ? LIVE_WALLPAPERS : STATIC_WALLPAPERS;
        if (!choices.has(data.wallpaper)) fail('壁纸选项无效');
        if (!SEARCH_ENGINES.has(data.searchEngine)) fail('搜索引擎无效');
        for (const name of ['showSeconds', 'showDate', 'openInNewTab']) {
            if (typeof data[name] !== 'boolean') fail(`${name} 设置无效`);
        }
        if (!Number.isInteger(data.iconShape) || data.iconShape < 1 || data.iconShape > 4) fail('图标圆角档位无效');
        return data;
    }
    function assetIds(value) {
        const data = validateData(value);
        const ids = new Set();
        for (const item of [...data.shortcuts, ...data.dock]) {
            for (const entry of item.type === 'folder' ? item.children : [item]) {
                if (entry.iconAsset) ids.add(entry.iconAsset);
            }
        }
        if (data.wallpaperSettings.assetId) ids.add(data.wallpaperSettings.assetId);
        return [...ids];
    }
    function validateAssets(value = {}) {
        if (!plainObject(value)) fail('备份图片资源无效');
        const entries = Object.entries(value);
        if (entries.length > MAX_ASSETS) fail('备份图片资源超过 256 个');
        let total = 0;
        const cleaned = [];
        for (const [id, dataUrl] of entries) {
            if (!validAssetId(id) || typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 + 40) {
                fail('备份图片资源无效或超过 8 MB');
            }
            const comma = dataUrl.indexOf(',');
            if (!['data:image/png;base64', 'data:image/jpeg;base64', 'data:image/webp;base64'].includes(dataUrl.slice(0, comma))) {
                fail('备份图片只支持 PNG、JPEG 或 WebP');
            }
            const encoded = dataUrl.slice(comma + 1);
            if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
                fail('备份图片编码无效');
            }
            const bytes = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
            total += bytes;
            if (bytes > MAX_ASSET_BYTES || total > MAX_ASSETS_BYTES) fail('备份图片资源过大（单张 8 MB，总计 24 MB）');
            cleaned.push([id, dataUrl]);
        }
        return Object.fromEntries(cleaned);
    }
    function requireAssets(data, assets) {
        for (const id of assetIds(data)) {
            if (!Object.prototype.hasOwnProperty.call(assets, id)) fail(`备份缺少图片资源：${id}`);
        }
    }
    function makeBackup(data, assets = {}) {
        const cleaned = validateData(data);
        const images = validateAssets(assets);
        requireAssets(cleaned, images);
        return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), data: cleaned, assets: images };
    }
    function readBackup(text, portable) {
        let value;
        try { value = JSON.parse(text); } catch { fail('文件不是有效的 JSON'); }
        if (!plainObject(value) || value.format !== FORMAT) fail('不是 MoTab 备份文件');
        if (value.version !== 1 && value.version !== VERSION) fail(`不支持的备份版本：${String(value.version)}`);
        if (typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))) {
            fail('备份时间无效');
        }
        const data = validateData(value.data);
        const assets = validateAssets(value.assets);
        if (portable) requireAssets(data, assets);
        return { format: FORMAT, version: VERSION, exportedAt: value.exportedAt, data, assets };
    }
    function parseBackup(text) {
        return readBackup(text, true);
    }
    function counts(data) {
        return {
            shortcuts: data.shortcuts.reduce((sum, item) => sum + (item.type === 'folder' ? item.children.length : 1), 0),
            folders: data.shortcuts.filter(item => item.type === 'folder').length,
            dock: data.dock.length,
        };
    }
    function readStored(storage, defaults) {
        let data = validateData(defaults);
        const invalid = {};
        const parsed = {};
        for (const [field, key] of Object.entries(FIELDS)) {
            const raw = storage.getItem(key);
            if (raw === null) continue;
            try { parsed[field] = JSON.parse(raw); }
            catch { invalid[key] = raw; }
        }
        for (const [field, key] of Object.entries(FIELDS)) {
            if (field === 'wallpaper' || field === 'wallpaperType' || !(field in parsed)) continue;
            try { data = validateData({ ...data, [field]: parsed[field] }); }
            catch { invalid[key] = storage.getItem(key); }
        }
        if ('wallpaper' in parsed || 'wallpaperType' in parsed) {
            try {
                data = validateData({ ...data,
                    wallpaper: 'wallpaper' in parsed ? parsed.wallpaper : data.wallpaper,
                    wallpaperType: 'wallpaperType' in parsed ? parsed.wallpaperType : data.wallpaperType,
                });
            } catch {
                for (const field of ['wallpaper', 'wallpaperType']) {
                    const key = FIELDS[field];
                    const raw = storage.getItem(key);
                    if (raw !== null) invalid[key] = raw;
                }
            }
        }
        return { data, invalid };
    }
    function preserveCorrupt(storage, invalid) {
        if (!Object.keys(invalid).length) return true;
        try {
            const existing = storage.getItem(CORRUPT_KEY);
            if (existing && JSON.stringify(JSON.parse(existing).raw) === JSON.stringify(invalid)) return true;
            storage.setItem(CORRUPT_KEY, JSON.stringify({ capturedAt: new Date().toISOString(), raw: invalid }));
            return true;
        } catch { return false; }
    }
    function writeData(storage, incoming, undoValue) {
        const data = validateData(incoming);
        const changes = Object.entries(FIELDS).map(([field, key]) => [key, JSON.stringify(data[field])]);
        changes.push([UNDO_KEY, undoValue]);
        const previous = changes.map(([key]) => [key, storage.getItem(key)]);
        try {
            for (const [key, value] of changes) {
                if (value === null) storage.removeItem(key);
                else storage.setItem(key, value);
            }
        } catch (error) {
            for (const [key, value] of previous) {
                try {
                    if (value === null) storage.removeItem(key);
                    else storage.setItem(key, value);
                } catch { /* preserve the original error */ }
            }
            throw error;
        }
        return data;
    }
    function importBackup(storage, current, backup) {
        const incoming = parseBackup(JSON.stringify(backup));
        // 本地撤销只存元数据；媒体保留在 IndexedDB，不将大图复制进 localStorage。
        const snapshot = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), data: validateData(current) };
        return writeData(storage, incoming.data, JSON.stringify(snapshot));
    }
    function readUndo(storage) {
        const raw = storage.getItem(UNDO_KEY);
        if (!raw) return null;
        try { return readBackup(raw, false); } catch { return null; }
    }
    function undoImport(storage) {
        const backup = readUndo(storage);
        if (!backup) fail('没有可恢复的导入前快照');
        return writeData(storage, backup.data, null);
    }

    function findDuplicate(data, url) {
        const canonical = canonicalWebUrl(url);
        for (const item of data.shortcuts) {
            if (item.type === 'folder') {
                const found = item.children.find(child => canonicalWebUrl(child.url) === canonical);
                if (found) return { name: found.name, location: item.name };
            } else if (canonicalWebUrl(item.url) === canonical) {
                return { name: item.name, location: '网格' };
            }
        }
        return null;
    }

    function addShortcut(storage, input, allowDuplicate = false) {
        const { data, invalid } = readStored(storage, DEFAULTS);
        if (invalid[FIELDS.shortcuts]) fail('现有快捷方式数据损坏，请先到起始页的数据管理中备份或恢复');
        const url = canonicalWebUrl(input.url);
        const name = String(input.name || '').trim();
        if (!name) fail('请输入快捷方式名称');
        const duplicate = findDuplicate(data, url);
        if (duplicate && !allowDuplicate) return { duplicate };
        let list = data.shortcuts;
        let location = '网格';
        if (input.folderId) {
            const folder = data.shortcuts.find(item => item.id === input.folderId && item.type === 'folder');
            if (!folder) fail('目标文件夹已不存在，请重新选择');
            list = folder.children;
            location = folder.name;
        }
        const ids = new Set(data.shortcuts.flatMap(item => item.type === 'folder' ? [item.id, ...item.children.map(child => child.id)] : [item.id]));
        let id;
        do { id = 's-' + (root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`); }
        while (ids.has(id));
        const added = { id, name, url };
        list.push(added);
        const validated = validateData(data);
        storage.setItem(FIELDS.shortcuts, JSON.stringify(validated.shortcuts));
        return { added, location };
    }

    function findShortcut(data, id) {
        for (let index = 0; index < data.shortcuts.length; index++) {
            const item = data.shortcuts[index];
            if (item.id === id) return { item, list: data.shortcuts, index, folder: null };
            if (item.type === 'folder') {
                const childIndex = item.children.findIndex(child => child.id === id);
                if (childIndex !== -1) return { item: item.children[childIndex], list: item.children,
                    index: childIndex, folder: item };
            }
        }
        return null;
    }
    function pinShortcut(current, id) {
        const data = validateData(current);
        const loc = findShortcut(data, id);
        if (!loc || loc.item.type === 'folder') fail('找不到可固定的快捷方式');
        if (!data.dock.some(item => item.id === id)) data.dock.push({ ...loc.item });
        return validateData(data);
    }
    function moveShortcut(current, id, folderId) {
        const data = validateData(current);
        const loc = findShortcut(data, id);
        if (!loc || loc.item.type === 'folder') fail('找不到可移动的快捷方式');
        const target = folderId ? data.shortcuts.find(item => item.id === folderId && item.type === 'folder') : null;
        if (folderId && !target) fail('目标文件夹已不存在');
        if ((loc.folder?.id || '') === (folderId || '')) return data;
        loc.list.splice(loc.index, 1);
        (target ? target.children : data.shortcuts).push(loc.item);
        return validateData(data);
    }
    function removeShortcut(current, id) {
        const data = validateData(current);
        const loc = findShortcut(data, id);
        if (!loc) fail('快捷方式已不存在');
        const removedIds = new Set(loc.item.type === 'folder' ?
            [loc.item.id, ...loc.item.children.map(child => child.id)] : [loc.item.id]);
        loc.list.splice(loc.index, 1);
        data.dock = data.dock.filter(item => !removedIds.has(item.id));
        return validateData(data);
    }
    function reorderDock(current, fromId, toId) {
        const data = validateData(current);
        const from = data.dock.findIndex(item => item.id === fromId);
        const to = data.dock.findIndex(item => item.id === toId);
        if (from === -1 || to === -1 || from === to) return data;
        const [moved] = data.dock.splice(from, 1);
        data.dock.splice(to, 0, moved);
        return validateData(data);
    }

    const api = { VERSION, MAX_ASSET_BYTES, MAX_ASSETS_BYTES, MAX_ASSETS, FIELDS, UNDO_KEY, CORRUPT_KEY, DEFAULTS,
        validateData, validateAssets, assetIds, makeBackup, parseBackup, counts,
        readStored, preserveCorrupt, importBackup, readUndo, undoImport, findDuplicate, addShortcut,
        pinShortcut, moveShortcut, removeShortcut, reorderDock };
    root.MotabData = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
