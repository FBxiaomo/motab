const test = require('node:test');
const assert = require('node:assert/strict');
const backup = require('../scripts/data-backup.js');

class MemoryStorage {
    constructor() { this.values = new Map(); this.failOnceOn = null; }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    setItem(key, value) {
        if (this.failOnceOn === key) { this.failOnceOn = null; throw new Error('quota'); }
        this.values.set(key, String(value));
    }
    removeItem(key) { this.values.delete(key); }
}

function sample() {
    return {
        shortcuts: [{ id: 'folder', name: '工具', type: 'folder', children: [
            { id: 'site', name: '站点', url: 'https://example.com/' },
        ] }],
        dock: [{ id: 'apps', name: '应用列表', url: 'javascript:void(0)' }],
        wallpaper: 'live1', wallpaperType: 'live', searchEngine: 'baidu',
        showSeconds: false, showDate: true, openInNewTab: true,
        iconShape: 2,
        appearance: { ...backup.DEFAULTS.appearance },
        wallpaperSettings: { ...backup.DEFAULTS.wallpaperSettings },
    };
}

test('备份往返保留文件夹、Dock 与设置', () => {
    const original = sample();
    const parsed = backup.parseBackup(JSON.stringify(backup.makeBackup(original)));
    assert.deepEqual(parsed.data, original);
    assert.deepEqual(backup.counts(parsed.data), { shortcuts: 1, folders: 1, dock: 1 });
});

test('拒绝危险网址、嵌套文件夹和不支持的版本', () => {
    const unsafe = backup.makeBackup(sample());
    unsafe.data.shortcuts[0].children[0].url = 'javascript:alert(1)';
    assert.throws(() => backup.parseBackup(JSON.stringify(unsafe)), /网址无效/);
    const nested = backup.makeBackup(sample());
    nested.data.shortcuts[0].children.push({ id: 'nested', name: '嵌套', type: 'folder', children: [] });
    assert.throws(() => backup.parseBackup(JSON.stringify(nested)), /嵌套文件夹/);
    const duplicate = backup.makeBackup(sample());
    duplicate.data.shortcuts.push({ id: 'site', name: '重复', url: 'https://other.example/' });
    assert.throws(() => backup.parseBackup(JSON.stringify(duplicate)), /重复的 ID/);
    const future = backup.makeBackup(sample());
    future.version = 3;
    assert.throws(() => backup.parseBackup(JSON.stringify(future)), /不支持的备份版本/);
});

test('读取旧数据时正确组合动态壁纸，并保留损坏字段原文', () => {
    const storage = new MemoryStorage();
    storage.setItem('motab_wallpaper', JSON.stringify('live3'));
    storage.setItem('motab_wallpaperType', JSON.stringify('live'));
    storage.setItem('motab_shortcuts', '{bad json');
    const result = backup.readStored(storage, sample());
    assert.equal(result.data.wallpaper, 'live3');
    assert.equal(result.data.wallpaperType, 'live');
    assert.deepEqual(result.data.shortcuts, sample().shortcuts);
    assert.equal(result.invalid.motab_shortcuts, '{bad json');
    assert.equal(backup.preserveCorrupt(storage, result.invalid), true);
    assert.equal(JSON.parse(storage.getItem(backup.CORRUPT_KEY)).raw.motab_shortcuts, '{bad json');
});

test('导入能撤销；写入失败时回滚已有数据', () => {
    const storage = new MemoryStorage();
    const current = sample();
    const incoming = sample();
    incoming.shortcuts = [{ id: 'new', name: '新站点', url: 'https://new.example/' }];
    backup.importBackup(storage, current, backup.makeBackup(incoming));
    assert.deepEqual(backup.readStored(storage, current).data, incoming);
    assert.deepEqual(backup.undoImport(storage), current);
    assert.equal(backup.readUndo(storage), null);

    backup.importBackup(storage, current, backup.makeBackup(current));
    const before = new Map(storage.values);
    storage.failOnceOn = 'motab_dock';
    assert.throws(() => backup.importBackup(storage, current, backup.makeBackup(incoming)), /quota/);
    assert.deepEqual(storage.values, before);
});

test('弹窗首次添加保留默认捷径，并能直接加入文件夹', () => {
    const storage = new MemoryStorage();
    const originalCount = backup.DEFAULTS.shortcuts.length;
    const result = backup.addShortcut(storage, {
        name: '新网站', url: 'https://new.example/', folderId: 'folder-tools',
    });
    assert.equal(result.location, '工具');
    const loaded = backup.readStored(storage, backup.DEFAULTS).data;
    assert.equal(loaded.shortcuts.length, originalCount);
    assert.equal(loaded.shortcuts.find(item => item.id === 'folder-tools').children.at(-1).name, '新网站');
});

test('弹窗检测重复网址，允许确认后重复添加', () => {
    const storage = new MemoryStorage();
    const input = { name: '另一个名字', url: 'https://mail.qq.com/', folderId: '' };
    const before = storage.getItem('motab_shortcuts');
    assert.deepEqual(backup.addShortcut(storage, input).duplicate, { name: 'QQ邮箱', location: '网格' });
    assert.equal(storage.getItem('motab_shortcuts'), before);
    assert.equal(backup.addShortcut(storage, input, true).added.name, '另一个名字');
    assert.equal(backup.readStored(storage, backup.DEFAULTS).data.shortcuts.length,
        backup.DEFAULTS.shortcuts.length + 1);
});

test('弹窗拒绝非网页地址和已消失的目标文件夹', () => {
    const storage = new MemoryStorage();
    assert.throws(() => backup.addShortcut(storage, { name: '危险', url: 'javascript:alert(1)' }), /http 或 https/);
    assert.throws(() => backup.addShortcut(storage, {
        name: '站点', url: 'https://new.example/', folderId: 'missing',
    }), /目标文件夹已不存在/);
    assert.equal(storage.getItem('motab_shortcuts'), null);
});

test('固定、移动和删除文件夹内捷径保持 Dock 关联', () => {
    const original = sample();
    const pinned = backup.pinShortcut(original, 'site');
    assert.equal(pinned.dock.at(-1).id, 'site');
    assert.equal(original.dock.length, 1);
    const moved = backup.moveShortcut(pinned, 'site', '');
    assert.equal(moved.shortcuts.at(-1).id, 'site');
    assert.equal(moved.dock.at(-1).id, 'site');
    const inside = backup.moveShortcut(moved, 'site', 'folder');
    assert.equal(inside.shortcuts[0].children[0].id, 'site');
    const removed = backup.removeShortcut(inside, 'folder');
    assert.deepEqual(removed.shortcuts, []);
    assert.deepEqual(removed.dock.map(item => item.id), ['apps']);
});

test('图标圆角档位校验：旧备份缺省回退默认档，非法档位被拒绝', () => {
    const legacy = backup.makeBackup(sample());
    delete legacy.data.iconShape;
    assert.equal(backup.parseBackup(JSON.stringify(legacy)).data.iconShape, backup.DEFAULTS.iconShape);
    for (const bad of [0, 5, 2.5, '3', null]) {
        const wrapped = backup.makeBackup(sample());
        wrapped.data.iconShape = bad;
        assert.throws(() => backup.parseBackup(JSON.stringify(wrapped)), /图标圆角档位无效/);
    }
    const storage = new MemoryStorage();
    storage.setItem('motab_iconShape', JSON.stringify(9));
    const result = backup.readStored(storage, sample());
    assert.equal(result.data.iconShape, sample().iconShape);
    assert.equal(result.invalid.motab_iconShape, JSON.stringify(9));
});

test('Dock 排序按 ID 移动，未修改输入数据', () => {
    const current = sample();
    current.dock.push({ id: 'another', name: '另一站', url: 'https://another.example/' });
    const reordered = backup.reorderDock(current, 'another', 'apps');
    assert.deepEqual(reordered.dock.map(item => item.id), ['another', 'apps']);
    assert.deepEqual(current.dock.map(item => item.id), ['apps', 'another']);
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';

test('v1 备份和旧本地数据自动补齐外观与壁纸设置，导出为 v2', () => {
    const legacy = { format: 'motab-backup', version: 1, exportedAt: new Date().toISOString(), data: sample() };
    delete legacy.data.appearance;
    delete legacy.data.wallpaperSettings;
    const parsed = backup.parseBackup(JSON.stringify(legacy));
    assert.equal(parsed.version, 2);
    assert.deepEqual(parsed.data.appearance, backup.DEFAULTS.appearance);
    assert.deepEqual(parsed.data.wallpaperSettings, backup.DEFAULTS.wallpaperSettings);
    assert.deepEqual(parsed.assets, {});
    assert.equal(backup.makeBackup(parsed.data).version, 2);
    const loaded = backup.readStored(new MemoryStorage(), legacy.data);
    assert.deepEqual(loaded.data.appearance, backup.DEFAULTS.appearance);
    assert.deepEqual(loaded.invalid, {});
    parsed.data.appearance.iconSize = 'large';
    assert.equal(backup.DEFAULTS.appearance.iconSize, 'medium');
});

test('外观和壁纸设置校验边界，损坏新字段单独回退', () => {
    for (const [field, key, bad] of [
        ['appearance', 'iconSize', 'huge'], ['appearance', 'showNames', 'true'],
        ['appearance', 'iconStyle', 'svg'], ['appearance', 'tint', 'url(javascript:1)'],
        ['wallpaperSettings', 'assetId', 'blob:temporary'], ['wallpaperSettings', 'x', -1],
        ['wallpaperSettings', 'y', 101], ['wallpaperSettings', 'zoom', 0.99],
        ['wallpaperSettings', 'zoom', 2.01], ['wallpaperSettings', 'blur', 21],
        ['wallpaperSettings', 'dim', 61], ['wallpaperSettings', 'dim', Infinity],
    ]) {
        const data = sample();
        data[field][key] = bad;
        assert.throws(() => backup.validateData(data), /设置无效|图片引用无效/);
    }
    const boundary = sample();
    boundary.wallpaperSettings = { assetId: null, x: 0, y: 100, zoom: 2, blur: 20, dim: 60 };
    assert.deepEqual(backup.validateData(boundary).wallpaperSettings, boundary.wallpaperSettings);
    const storage = new MemoryStorage();
    storage.setItem(backup.FIELDS.appearance, JSON.stringify({ iconStyle: 'bad' }));
    const read = backup.readStored(storage, sample());
    assert.deepEqual(read.data.appearance, backup.DEFAULTS.appearance);
    assert.equal(read.invalid.motab_appearance, JSON.stringify({ iconStyle: 'bad' }));
});

test('图片引用在固定、移动、弹窗添加和便携备份中保留', () => {
    const original = sample();
    original.shortcuts[0].children[0].iconAsset = 'asset-icon';
    original.wallpaperSettings.assetId = 'asset-wallpaper';
    original.appearance = { iconSize: 'small', showNames: false, iconStyle: 'tinted', tint: '#112233' };
    const pinned = backup.pinShortcut(original, 'site');
    assert.equal(pinned.dock.at(-1).iconAsset, 'asset-icon');
    const moved = backup.moveShortcut(pinned, 'site', '');
    assert.equal(moved.shortcuts.at(-1).iconAsset, 'asset-icon');
    assert.deepEqual(backup.assetIds(moved), ['asset-icon', 'asset-wallpaper']);
    const assets = { 'asset-icon': PNG, 'asset-wallpaper': PNG };
    const wrapped = backup.makeBackup(moved, assets);
    assert.deepEqual(backup.parseBackup(JSON.stringify(wrapped)).data, moved);
    const storage = new MemoryStorage();
    for (const [field, key] of Object.entries(backup.FIELDS)) storage.setItem(key, JSON.stringify(moved[field]));
    backup.addShortcut(storage, { name: '新网站', url: 'https://new.example/' });
    assert.equal(backup.readStored(storage, sample()).data.shortcuts.find(item => item.id === 'site').iconAsset, 'asset-icon');
});

test('便携备份要求所有图片齐全，拒绝危险 MIME、无效编码和资源 ID', () => {
    const data = sample();
    data.shortcuts[0].children[0].iconAsset = 'asset-icon';
    assert.throws(() => backup.makeBackup(data), /缺少图片资源/);
    const wrapped = backup.makeBackup(data, { 'asset-icon': PNG });
    delete wrapped.assets['asset-icon'];
    assert.throws(() => backup.parseBackup(JSON.stringify(wrapped)), /缺少图片资源/);
    for (const bad of ['data:image/svg+xml;base64,PHN2Zz4=', 'https://example.com/icon.png',
        'data:image/png;base64,abcd=', 'data:image/png;base64,', 'data:image/png;base64,!!!!']) {
        assert.throws(() => backup.validateAssets({ 'asset-icon': bad }), /图片/);
    }
    assert.throws(() => backup.validateAssets({ '../escape': PNG }), /图片资源无效/);
    assert.throws(() => backup.validateAssets(JSON.parse('{"__proto__":"x"}')), /图片资源无效/);
    data.shortcuts[0].children[0].iconAsset = null;
    assert.throws(() => backup.validateData(data), /图片引用无效/);
});

test('图片备份限制数量、单张及累计大小', () => {
    assert.throws(() => backup.validateAssets(Object.fromEntries(
        Array.from({ length: backup.MAX_ASSETS + 1 }, (_, i) => [`asset-${i}`, PNG]))), /超过 256/);
    const oversize = 'data:image/png;base64,' + 'A'.repeat(Math.ceil((backup.MAX_ASSET_BYTES + 3) / 3) * 4);
    assert.throws(() => backup.validateAssets({ 'asset-big': oversize }), /超过 8 MB|资源过大/);
    const threeMiB = 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024);
    assert.throws(() => backup.validateAssets(Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [`asset-${i}`, threeMiB]))), /总计 24 MB/);
});

test('本地导入撤销只存图片引用，保留旧 v1 快照兼容性', () => {
    const storage = new MemoryStorage();
    const current = sample();
    current.shortcuts[0].children[0].iconAsset = 'asset-before';
    current.wallpaperSettings.assetId = 'wallpaper-before';
    const incoming = sample();
    incoming.wallpaperSettings.assetId = 'wallpaper-after';
    backup.importBackup(storage, current, backup.makeBackup(incoming, { 'wallpaper-after': PNG }));
    const snapshot = backup.readUndo(storage);
    assert.deepEqual(snapshot.data, current);
    assert.deepEqual(snapshot.assets, {});
    assert.equal(storage.getItem(backup.UNDO_KEY).includes('base64'), false);
    for (const value of storage.values.values()) assert.equal(value.includes('data:image/'), false);
    assert.deepEqual(backup.undoImport(storage), current);
    assert.equal(backup.readUndo(storage), null);
    const old = { format: 'motab-backup', version: 1, exportedAt: new Date().toISOString(), data: sample() };
    delete old.data.appearance;
    delete old.data.wallpaperSettings;
    storage.setItem(backup.UNDO_KEY, JSON.stringify(old));
    assert.deepEqual(backup.undoImport(storage).appearance, backup.DEFAULTS.appearance);
});

test('新增外观和壁纸字段写入失败也回滚全部元数据和撤销快照', () => {
    const storage = new MemoryStorage();
    const current = sample();
    backup.importBackup(storage, current, backup.makeBackup(current));
    const before = new Map(storage.values);
    const incoming = sample();
    incoming.appearance.iconStyle = 'dark';
    incoming.wallpaperSettings.blur = 12;
    for (const key of [backup.FIELDS.appearance, backup.FIELDS.wallpaperSettings, backup.UNDO_KEY]) {
        storage.failOnceOn = key;
        assert.throws(() => backup.importBackup(storage, current, backup.makeBackup(incoming)), /quota/);
        assert.deepEqual(storage.values, before);
    }
});
