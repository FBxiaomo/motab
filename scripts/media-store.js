// Local image assets. Metadata stays in localStorage; image bytes live in IndexedDB.
// Load after data-backup.js. Assets are immutable and retained for undo snapshots.
(function (root) {
    'use strict';

    const DB_NAME = 'motab-media';
    const STORE_NAME = 'assets';
    const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
    const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
    const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
    const urls = new Map();
    const pendingUrls = new Map();
    let dbPromise = null;
    let generation = 0;

    function checkId(id) {
        if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) {
            throw new Error('图片资源 ID 无效');
        }
    }
    function init() {
        if (dbPromise) return dbPromise;
        if (!root.indexedDB) return Promise.reject(new Error('浏览器无法使用本地图片存储'));
        dbPromise = new Promise((resolve, reject) => {
            const request = root.indexedDB.open(DB_NAME, 1);
            let rejected = false;
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
            };
            request.onerror = () => { rejected = true; dbPromise = null; reject(request.error || new Error('打开图片存储失败')); };
            request.onblocked = () => { rejected = true; dbPromise = null; reject(new Error('图片存储被其他页面占用，请关闭旧标签页后重试')); };
            request.onsuccess = () => {
                const db = request.result;
                if (rejected) { db.close(); return; }
                db.onversionchange = () => { db.close(); dbPromise = null; invalidateUrls(); };
                resolve(db);
            };
        });
        return dbPromise;
    }
    function transactionDone(tx) {
        return new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error || new Error('图片存储操作已取消'));
            tx.onerror = () => reject(tx.error || new Error('图片存储操作失败'));
        });
    }
    async function readBlob(id) {
        checkId(id);
        const db = await init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('读取图片失败'));
            tx.onabort = () => reject(tx.error || new Error('读取图片失败'));
        });
    }
    async function addBlobs(entries) {
        if (!entries.length) return;
        const db = await init();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const done = transactionDone(tx);
        for (const [id, blob] of entries) tx.objectStore(STORE_NAME).add(blob, id);
        await done;
    }
    function invalidateUrls() {
        generation++;
        for (const url of urls.values()) root.URL.revokeObjectURL(url);
        urls.clear();
        pendingUrls.clear();
    }
    async function decodeImage(blob) {
        let image;
        if (root.createImageBitmap) {
            try { image = await root.createImageBitmap(blob); }
            catch { throw new Error('图片无法解码，请选择有效的 PNG、JPEG 或 WebP 图片'); }
        } else {
            image = await new Promise((resolve, reject) => {
                const img = new root.Image();
                const url = root.URL.createObjectURL(blob);
                img.onload = () => { root.URL.revokeObjectURL(url); resolve(img); };
                img.onerror = () => { root.URL.revokeObjectURL(url); reject(new Error('图片无法解码')); };
                img.src = url;
            });
        }
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!width || !height || width * height > MAX_IMAGE_PIXELS) {
            image.close?.();
            throw new Error('图片像素过大，请先缩小到 6400 万像素以内');
        }
        return { image, width, height };
    }
    async function putImage(file, options = {}) {
        if (!file || !TYPES.has(file.type) || typeof file.size !== 'number' || file.size <= 0) {
            throw new Error('请选择 PNG、JPEG 或 WebP 图片');
        }
        if (file.size > MAX_UPLOAD_BYTES) throw new Error('图片不能超过 20 MB');
        if (options.kind !== 'icon' && options.kind !== 'wallpaper') throw new Error('图片用途无效');
        const { x = 50, y = 50, zoom = 1 } = options;
        if (![x, y, zoom].every(Number.isFinite) || x < 0 || x > 100 || y < 0 || y > 100 || zoom < 1 || zoom > 2) {
            throw new Error('图片裁剪参数无效');
        }
        const { image, width, height } = await decodeImage(file);
        let blob;
        try {
            const canvas = root.document.createElement('canvas');
            const isIcon = options.kind === 'icon';
            const factor = Math.min(1, 2560 / Math.max(width, height));
            canvas.width = isIcon ? 256 : Math.max(1, Math.round(width * factor));
            canvas.height = isIcon ? 256 : Math.max(1, Math.round(height * factor));
            const context = canvas.getContext('2d');
            if (!context) throw new Error('浏览器无法处理图片');
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            if (isIcon) {
                const side = Math.min(width, height) / zoom;
                context.drawImage(image, (width - side) * x / 100, (height - side) * y / 100,
                    side, side, 0, 0, 256, 256);
            } else context.drawImage(image, 0, 0, canvas.width, canvas.height);
            blob = await new Promise((resolve, reject) => canvas.toBlob(result => {
                if (result) resolve(result);
                else reject(new Error('图片转换失败'));
            }, isIcon ? 'image/png' : 'image/webp', 0.88));
        } finally { image.close?.(); }
        if (blob.size > root.MotabData.MAX_ASSET_BYTES) throw new Error('处理后的图片仍超过 8 MB，请使用较小图片');
        const id = 'asset-' + root.crypto.randomUUID();
        await addBlobs([[id, blob]]);
        return id;
    }
    async function getUrl(id) {
        checkId(id);
        if (urls.has(id)) return urls.get(id);
        if (pendingUrls.has(id)) return pendingUrls.get(id);
        const currentGeneration = generation;
        const pending = (async () => {
            const blob = await readBlob(id);
            if (!blob || currentGeneration !== generation) return null;
            const url = root.URL.createObjectURL(blob);
            urls.set(id, url);
            return url;
        })();
        pendingUrls.set(id, pending);
        try { return await pending; }
        finally { if (pendingUrls.get(id) === pending) pendingUrls.delete(id); }
    }
    function blobDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new root.FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('读取图片备份失败'));
            reader.onabort = () => reject(new Error('读取图片备份已取消'));
            reader.readAsDataURL(blob);
        });
    }
    async function exportAssets(ids) {
        const list = [...new Set(ids)];
        if (list.length > root.MotabData.MAX_ASSETS) throw new Error('备份图片资源超过 256 个');
        const entries = [];
        let total = 0;
        for (const id of list) {
            const blob = await readBlob(id);
            if (!blob) throw new Error(`找不到图片资源：${id}`);
            total += blob.size;
            if (blob.size > root.MotabData.MAX_ASSET_BYTES || total > root.MotabData.MAX_ASSETS_BYTES) {
                throw new Error('备份图片资源超过大小限制');
            }
            entries.push([id, await blobDataUrl(blob)]);
        }
        return root.MotabData.validateAssets(Object.fromEntries(entries));
    }
    async function importAssets(map) {
        const assets = root.MotabData.validateAssets(map);
        const additions = [];
        for (const [id, dataUrl] of Object.entries(assets)) {
            const comma = dataUrl.indexOf(',');
            const binary = root.atob(dataUrl.slice(comma + 1));
            const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
            const blob = new root.Blob([bytes], { type: dataUrl.slice(5, dataUrl.indexOf(';')) });
            const { image } = await decodeImage(blob);
            image.close?.();
            const existing = await readBlob(id);
            if (existing) {
                const original = new Uint8Array(await existing.arrayBuffer());
                if (existing.type !== blob.type || original.length !== bytes.length || !original.every((byte, index) => byte === bytes[index])) {
                    // 覆盖同 ID 的旧图片会破坏当前页面和导入撤销；冲突必须拒绝。
                    throw new Error(`图片资源 ID 冲突：${id}`);
                }
            } else additions.push([id, blob]);
        }
        await addBlobs(additions);
    }
    async function clear() {
        const db = await init();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const done = transactionDone(tx);
        tx.objectStore(STORE_NAME).clear();
        await done;
        invalidateUrls();
    }

    const api = { init, putImage, getUrl, exportAssets, importAssets, clear };
    root.MotabMedia = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
