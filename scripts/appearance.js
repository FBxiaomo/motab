// Desktop appearance editor. Native DOM and external listeners for MV3 pages.
(function (root) {
    'use strict';
    let config;
    let active = null;
    let sequence = 0;
    const clone = value => JSON.parse(JSON.stringify(value));

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function button(text, className, onClick, id) {
        const node = el('button', className, text);
        node.type = 'button';
        if (id) node.id = id;
        node.addEventListener('click', onClick);
        return node;
    }
    function section(parent, title, description) {
        const node = el('section', 'appearance-section');
        node.appendChild(el('h3', '', title));
        if (description) node.appendChild(el('p', 'appearance-description', description));
        parent.appendChild(node);
        return node;
    }
    function status(session, message, error = false) {
        if (active !== session) return;
        session.status.textContent = message;
        session.status.classList.toggle('is-error', error);
    }
    function busy(session, value) {
        session.busy = value;
        session.panel.setAttribute('aria-busy', String(value));
        session.panel.querySelectorAll('button,input').forEach(node => { node.disabled = value; });
    }
    function finish(session, restore) {
        if (active !== session || session.busy) return false;
        active = null;
        sequence++;
        if (restore && session.kind === 'appearance') {
            try { Promise.resolve(config.restore()).catch(error => console.error('恢复桌面预览失败', error)); }
            catch (error) { console.error('恢复桌面预览失败', error); }
        }
        session.overlay.remove();
        if (session.objectUrl) URL.revokeObjectURL(session.objectUrl);
        session.previousFocus?.focus?.();
        return true;
    }
    function close() {
        if (active) return finish(active, true);
        return true;
    }
    function makeSession(kind, title, subtitle) {
        if (active && !close()) return null;
        const overlay = el('div', 'appearance-overlay');
        const panel = el('div', 'appearance-panel' + (kind === 'icon' ? ' appearance-icon-panel' : ''));
        panel.id = kind === 'icon' ? 'custom-icon-panel' : 'appearance-panel';
        panel.tabIndex = -1;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', title);
        const header = el('div', 'appearance-header');
        const heading = el('div');
        heading.append(el('h2', '', title), el('p', 'appearance-description', subtitle));
        const session = { kind, token: ++sequence, overlay, panel, busy: false, previousFocus: document.activeElement };
        header.append(heading, button('×', 'appearance-close', () => finish(session, true)));
        header.lastChild.setAttribute('aria-label', '取消并关闭');
        const body = el('div', 'appearance-body');
        const message = el('p', 'appearance-status');
        message.setAttribute('role', 'status');
        message.setAttribute('aria-live', 'polite');
        const footer = el('div', 'appearance-footer');
        panel.append(header, body, message, footer);
        overlay.appendChild(panel);
        session.body = body;
        session.footer = footer;
        session.status = message;
        active = session;
        overlay.addEventListener('click', event => { if (event.target === overlay) finish(session, true); });
        // 外观面板内的右键和方向键不应操作后方桌面或文件夹。
        overlay.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); });
        overlay.addEventListener('keydown', event => { event.stopPropagation(); });
        document.body.appendChild(overlay);
        panel.focus();
        return session;
    }
    function preview(session) {
        if (active !== session) return;
        try {
            Promise.resolve(config.preview(clone(session.draft))).catch(error => status(session, error.message || '预览失败，请重试', true));
        } catch (error) { status(session, error.message || '预览失败，请重试', true); }
    }
    function choices(parent, options, selected, change, label) {
        const group = el('div', 'appearance-choices');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', label);
        for (const [value, title] of options) {
            const node = button(title, 'appearance-choice', () => {
                group.querySelectorAll('button').forEach(other => {
                    const chosen = other === node;
                    other.classList.toggle('is-selected', chosen);
                    other.setAttribute('aria-pressed', String(chosen));
                });
                change(value);
            });
            node.dataset.value = value;
            node.classList.toggle('is-selected', value === selected);
            node.setAttribute('aria-pressed', String(value === selected));
            group.appendChild(node);
        }
        parent.appendChild(group);
        return group;
    }
    function slider(parent, label, value, min, max, step, change, suffix = '', id) {
        const row = el('label', 'appearance-range');
        const title = el('span', 'appearance-range-label', label);
        const output = el('output', '', String(value) + suffix);
        const input = el('input');
        input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
        if (id) input.id = id;
        input.setAttribute('aria-label', label);
        input.addEventListener('input', () => {
            output.value = input.value + suffix;
            change(Number(input.value));
        });
        title.appendChild(output);
        row.append(title, input);
        parent.appendChild(row);
        return input;
    }
    function filePicker(parent, text, id, onChange) {
        const input = el('input', 'appearance-file');
        input.id = id;
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/webp';
        const pick = button(text, 'appearance-upload', () => input.click());
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            input.value = '';
            if (file) onChange(file);
        });
        parent.append(pick, input);
    }
    function draftFromState() {
        const state = config.getState();
        return clone({
            appearance: state.appearance || { iconSize: 'medium', showNames: true, iconStyle: 'original', tint: '#B19CD9' },
            iconShape: state.iconShape || 2,
            wallpaper: state.wallpaper,
            wallpaperType: state.wallpaperType,
            wallpaperSettings: state.wallpaperSettings || { assetId: null, x: 50, y: 50, zoom: 1, blur: 0, dim: 8 },
        });
    }
    function renderIcons(session) {
        const draft = session.draft;
        const size = section(session.body, '图标大小', '在桌面上实时查看调整效果');
        choices(size, [['small', '小'], ['medium', '中'], ['large', '大']], draft.appearance.iconSize,
            value => { draft.appearance.iconSize = value; preview(session); }, '图标大小');
        const shape = section(session.body, '图标圆角');
        choices(shape, [['1', '微圆'], ['2', '圆角'], ['3', '大圆'], ['4', '圆形']], String(draft.iconShape),
            value => { draft.iconShape = Number(value); preview(session); }, '图标圆角');
        const names = section(session.body, '名称');
        const row = el('label', 'appearance-switch-row');
        const input = el('input'); input.type = 'checkbox'; input.checked = draft.appearance.showNames; input.id = 'appearance-show-names';
        input.addEventListener('change', () => { draft.appearance.showNames = input.checked; preview(session); });
        row.append(el('span', '', '显示图标名称'), input); names.appendChild(row);
        const style = section(session.body, '图标外观');
        choices(style, [['original', '原色'], ['light', '浅色'], ['dark', '深色'], ['tinted', '主题色']], draft.appearance.iconStyle,
            value => { draft.appearance.iconStyle = value; preview(session); }, '图标外观');
        const colorRow = el('label', 'appearance-color-row');
        const color = el('input'); color.type = 'color'; color.value = draft.appearance.tint; color.id = 'appearance-tint';
        color.addEventListener('input', () => { draft.appearance.tint = color.value; preview(session); });
        colorRow.append(el('span', '', '主题颜色'), color); style.appendChild(colorRow);
        style.appendChild(el('p', 'appearance-description', '单个图标可在快捷方式右键菜单中更换。'));
    }
    function renderWallpapers(session) {
        const draft = session.draft;
        const custom = section(session.body, '你的壁纸', '选择 PNG、JPEG 或 WebP 图片');
        filePicker(custom, '上传本地图片', 'appearance-wallpaper-upload', async file => {
            busy(session, true); status(session, '正在处理图片…');
            try {
                const assetId = await config.media.putImage(file, { kind: 'wallpaper' });
                if (active !== session) return;
                draft.wallpaperSettings.assetId = assetId;
                draft.wallpaperSettings.x = 50; draft.wallpaperSettings.y = 50; draft.wallpaperSettings.zoom = 1;
                session.selectedFileName = file.name;
                busy(session, false); renderTab(session, 'wallpaper'); preview(session); status(session, '图片已就绪，可调整位置后应用');
            } catch (error) { busy(session, false); status(session, error.message || '图片处理失败，请重试', true); }
        });
        if (draft.wallpaperSettings.assetId) custom.appendChild(el('p', 'appearance-description', session.selectedFileName || '正在预览自定义壁纸'));
        function gallery(title, list, type) {
            const area = section(session.body, title);
            const grid = el('div', 'appearance-wallpapers');
            for (const wallpaper of list) {
                const tile = button('', 'appearance-wallpaper', () => {
                    draft.wallpaper = wallpaper.id; draft.wallpaperType = type;
                    draft.wallpaperSettings.assetId = null;
                    renderTab(session, 'wallpaper'); preview(session);
                });
                tile.dataset.wallpaper = wallpaper.id;
                tile.setAttribute('aria-label', wallpaper.name);
                const chosen = !draft.wallpaperSettings.assetId && draft.wallpaper === wallpaper.id && draft.wallpaperType === type;
                tile.classList.toggle('is-selected', chosen);
                tile.setAttribute('aria-pressed', String(chosen));
                const visual = el('span', 'appearance-wallpaper-image');
                if (type === 'live') {
                    const video = el('video'); video.preload = 'metadata'; video.muted = true; video.playsInline = true;
                    video.addEventListener('loadedmetadata', () => {
                        if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.01, video.duration / 2);
                    }, { once: true });
                    video.src = wallpaper.video;
                    video.setAttribute('aria-hidden', 'true');
                    visual.appendChild(video);
                } else visual.style.background = wallpaper.thumb || wallpaper.url;
                tile.append(visual, el('span', 'appearance-wallpaper-name', wallpaper.name));
                grid.appendChild(tile);
            }
            area.appendChild(grid);
        }
        gallery('静态壁纸', config.staticWallpapers || [], 'static');
        gallery('动态壁纸', config.liveWallpapers || [], 'live');
        const controls = section(session.body, '画面调整');
        const update = (name, value) => { draft.wallpaperSettings[name] = value; preview(session); };
        if (draft.wallpaperSettings.assetId) {
            slider(controls, '水平位置', draft.wallpaperSettings.x, 0, 100, 1, value => update('x', value), '%', 'appearance-wallpaper-x');
            slider(controls, '垂直位置', draft.wallpaperSettings.y, 0, 100, 1, value => update('y', value), '%', 'appearance-wallpaper-y');
            slider(controls, '缩放', draft.wallpaperSettings.zoom, 1, 2, 0.05, value => update('zoom', value), '×', 'appearance-wallpaper-zoom');
        }
        slider(controls, '模糊', draft.wallpaperSettings.blur, 0, 20, 1, value => update('blur', value), '', 'appearance-wallpaper-blur');
        slider(controls, '暗度', draft.wallpaperSettings.dim, 0, 60, 1, value => update('dim', value), '%', 'appearance-wallpaper-dim');
    }
    function renderTab(session, tab) {
        session.tab = tab;
        session.tabs.querySelectorAll('button').forEach(node => {
            const selected = node.dataset.tab === tab;
            node.setAttribute('aria-selected', String(selected));
            node.classList.toggle('is-selected', selected);
        });
        session.body.replaceChildren();
        if (tab === 'wallpaper') renderWallpapers(session); else renderIcons(session);
    }
    function open(tab = 'icons') {
        if (!config) throw new Error('MotabAppearance.init must be called first');
        const session = makeSession('appearance', '桌面外观', '让桌面更像你喜欢的样子');
        if (!session) return false;
        session.draft = draftFromState();
        const tabs = el('div', 'appearance-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '外观分类');
        for (const [name, title] of [['icons', '图标'], ['wallpaper', '壁纸']]) {
            const node = button(title, '', () => renderTab(session, name), 'appearance-tab-' + name);
            node.dataset.tab = name; node.setAttribute('role', 'tab'); tabs.appendChild(node);
        }
        session.tabs = tabs;
        session.panel.insertBefore(tabs, session.body);
        session.footer.append(button('取消', 'appearance-secondary', () => finish(session, true), 'appearance-cancel'),
            button('应用', 'appearance-primary', async () => {
                busy(session, true); status(session, '正在保存…');
                try {
                    await config.commit(clone(session.draft));
                    busy(session, false); finish(session, false);
                } catch (error) { busy(session, false); status(session, error.message || '保存失败，请重试', true); }
            }, 'appearance-apply'));
        renderTab(session, tab === 'wallpaper' ? 'wallpaper' : 'icons');
        return true;
    }
    function openIcon(item, onSave) {
        if (!config) throw new Error('MotabAppearance.init must be called first');
        const session = makeSession('icon', '更换图标', item.name || '快捷方式');
        if (!session) return false;
        const previewBox = el('div', 'appearance-icon-preview');
        const fallback = el('div', 'appearance-icon-fallback', (item.name || '?').charAt(0));
        previewBox.appendChild(fallback);
        session.body.appendChild(previewBox);
        if (config.renderIcon && !item.iconAsset) { fallback.textContent = ''; config.renderIcon(fallback, item); }
        if (item.iconAsset) config.media.getUrl(item.iconAsset).then(url => {
            if (active !== session || session.file || !url) return;
            const image = el('img'); image.src = url; image.alt = item.name || '当前图标';
            previewBox.replaceChildren(image);
        }).catch(() => status(session, '当前自定义图标无法读取，可重新上传', true));
        const upload = section(session.body, '选择图片', '拖动下方滑块调整正方形裁切区域');
        session.crop = { x: 50, y: 50, zoom: 1 };
        const cropArea = el('div'); cropArea.hidden = true;
        function draw() {
            if (!session.image) return;
            const image = session.image, crop = session.crop;
            const side = Math.min(image.naturalWidth, image.naturalHeight) / crop.zoom;
            const sx = (image.naturalWidth - side) * crop.x / 100;
            const sy = (image.naturalHeight - side) * crop.y / 100;
            const context = session.canvas.getContext('2d');
            context.clearRect(0, 0, 256, 256);
            context.drawImage(image, sx, sy, side, side, 0, 0, 256, 256);
        }
        filePicker(upload, '上传图标图片', 'custom-icon-upload', async file => {
            busy(session, true); status(session, '正在读取图片…');
            let url;
            try {
                if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片');
                if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20 MB');
                url = URL.createObjectURL(file);
                const image = new Image(); image.src = url;
                let decodeTimer;
                try {
                    await Promise.race([
                        image.decode(),
                        new Promise((resolve, reject) => {
                            decodeTimer = setTimeout(() => reject(new Error('图片读取超时，请换一张图片重试')), 15000);
                        }),
                    ]);
                } finally { clearTimeout(decodeTimer); }
                if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 64 * 1024 * 1024) {
                    image.src = '';
                    throw new Error('图片像素过大，请先缩小到 6400 万像素以内');
                }
                if (active !== session) { URL.revokeObjectURL(url); return; }
                if (session.objectUrl) URL.revokeObjectURL(session.objectUrl);
                session.objectUrl = url; session.file = file; session.image = image;
                session.crop = { x: 50, y: 50, zoom: 1 };
                session.canvas = el('canvas'); session.canvas.width = session.canvas.height = 256;
                session.canvas.setAttribute('aria-label', '图标裁切预览');
                previewBox.replaceChildren(session.canvas);
                cropArea.replaceChildren(); cropArea.hidden = false;
                for (const [name, label, min, max, step, suffix] of [['x', '水平位置', 0, 100, 1, '%'], ['y', '垂直位置', 0, 100, 1, '%'], ['zoom', '缩放', 1, 2, 0.05, '×']]) {
                    slider(cropArea, label, session.crop[name], min, max, step, value => { session.crop[name] = value; draw(); }, suffix, 'custom-icon-' + name);
                }
                draw(); busy(session, false); status(session, '裁切预览已更新，应用后生效');
            } catch (error) {
                if (url && url !== session.objectUrl) URL.revokeObjectURL(url);
                busy(session, false); status(session, error.message || '图片无法读取，请重试', true);
            }
        });
        upload.appendChild(cropArea);
        session.body.appendChild(button('恢复网站默认图标', 'appearance-reset', async () => {
            busy(session, true); status(session, '正在恢复…');
            try { await onSave(null); busy(session, false); finish(session, false); }
            catch (error) { busy(session, false); status(session, error.message || '恢复失败，请重试', true); }
        }, 'custom-icon-reset'));
        session.footer.append(button('取消', 'appearance-secondary', () => finish(session, true), 'custom-icon-cancel'),
            button('应用', 'appearance-primary', async () => {
                if (!session.file) { status(session, '请先选择一张图片，或恢复网站默认图标'); return; }
                busy(session, true); status(session, '正在保存…');
                try {
                    const assetId = await config.media.putImage(session.file, { kind: 'icon', ...session.crop });
                    await onSave(assetId); busy(session, false); finish(session, false);
                } catch (error) { busy(session, false); status(session, error.message || '保存失败，请重试', true); }
            }, 'custom-icon-apply'));
        return true;
    }
    function init(options) {
        config = options;
        if (init.bound) return;
        init.bound = true;
        document.addEventListener('keydown', event => {
            if (!active) return;
            if (event.key === 'Escape') {
                event.preventDefault(); event.stopImmediatePropagation(); close(); return;
            }
            if (event.key !== 'Tab') return;
            const nodes = [...active.panel.querySelectorAll('button,input')].filter(node => !node.disabled && node.getClientRects().length);
            if (!nodes.length) { event.preventDefault(); return; }
            const first = nodes[0], last = nodes[nodes.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === active.panel)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || document.activeElement === active.panel)) { event.preventDefault(); first.focus(); }
        }, true);
    }
    root.MotabAppearance = { init, open, openIcon, close, get isOpen() { return Boolean(active); } };
})(typeof window !== 'undefined' ? window : globalThis);
