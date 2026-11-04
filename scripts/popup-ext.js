/**
 * MoTab 末页 - Popup 脚本
 */

(function() {
    'use strict';

    // 显示版本号（从 manifest 读取，避免多处硬编码不同步）
    const versionText = document.getElementById('version-text');
    if (versionText) {
        versionText.textContent = 'v' + chrome.runtime.getManifest().version;
    }

    // 国际化（在功能绑定前替换文案）
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.textContent = msg;
    });

    const addPanel = document.getElementById('add-panel');
    const nameInput = document.getElementById('shortcut-name');
    const urlInput = document.getElementById('shortcut-url');
    const targetSelect = document.getElementById('shortcut-target');
    const status = document.getElementById('shortcut-status');
    const saveButton = document.getElementById('save-shortcut-btn');
    function showStatus(message, error = false) {
        status.textContent = message;
        status.classList.toggle('error', error);
    }

    // 弹窗与起始页同属扩展 origin，直接写入同一个 localStorage 键。
    const addShortcutBtn = document.getElementById('add-shortcut-btn');
    if (addShortcutBtn) {
        addShortcutBtn.addEventListener('click', async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                const url = tab && tab.url;
                let supported = false;
                try { supported = ['http:', 'https:'].includes(new URL(url).protocol); } catch { /* unsupported URL */ }
                if (!supported) {
                    alert('不支持添加此类型的页面到捷径');
                    return;
                }
                const loaded = MotabData.readStored(localStorage, MotabData.DEFAULTS);
                if (loaded.invalid.motab_shortcuts) {
                    alert('本地快捷方式数据损坏。请先打开起始页，在“数据管理”中备份或恢复。');
                    return;
                }
                targetSelect.replaceChildren(targetSelect.options[0]);
                loaded.data.shortcuts.filter(item => item.type === 'folder').forEach(folder => {
                    const option = document.createElement('option');
                    option.value = folder.id;
                    option.textContent = folder.name;
                    targetSelect.appendChild(option);
                });
                nameInput.value = (tab.title?.trim() || new URL(url).hostname).slice(0, 100);
                urlInput.value = url;
                saveButton.disabled = false;
                showStatus('');
                addPanel.hidden = false;
                nameInput.focus();
            } catch (e) {
                console.error(e);
                alert('无法读取当前页面，请重试。');
            }
        });
    }
    document.getElementById('cancel-shortcut-btn').addEventListener('click', () => { addPanel.hidden = true; });
    saveButton.addEventListener('click', () => {
        const input = { name: nameInput.value, url: urlInput.value, folderId: targetSelect.value };
        try {
            let result = MotabData.addShortcut(localStorage, input);
            if (result.duplicate) {
                const existing = result.duplicate;
                if (!confirm(`“${existing.name}”已经位于${existing.location}。仍要重复添加吗？`)) {
                    showStatus(`已存在于${existing.location}，没有重复添加。`);
                    return;
                }
                result = MotabData.addShortcut(localStorage, input, true);
            }
            saveButton.disabled = true;
            showStatus(`已添加“${result.added.name}”到${result.location}。`);
        } catch (error) {
            showStatus(error.message || '添加失败，请重试。', true);
        }
    });

    // 打开起始页（startpage.html 为当前生效的起始页）
    const openStartpageBtn = document.getElementById('open-startpage-btn');
    if (openStartpageBtn) {
        openStartpageBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: 'startpage.html' });
            window.close();
        });
    }

    // 清除本地数据
    // 当前起始页数据在 localStorage；同时清除旧 React 版遗留的 IndexedDB。
    const clearDataBtn = document.getElementById('clear-data-btn');
    if (clearDataBtn) {
        clearDataBtn.addEventListener('click', async () => {
            if (!confirm('确定清除所有本地数据吗？\n这将重置起始页的快捷方式、壁纸等所有设置。')) {
                return;
            }

            try {
                await MotabMedia.clear();
                localStorage.clear();
            } catch (error) {
                showStatus(`清除失败：${error.message}。请重试。`, true);
                return;
            }

            try {
                if (indexedDB.databases) {
                    const dbs = await indexedDB.databases();
                    await Promise.all(dbs.filter(db => db.name !== 'motab-media').map(db => new Promise(resolve => {
                        const req = indexedDB.deleteDatabase(db.name);
                        req.onsuccess = resolve;
                        req.onerror = resolve;
                        req.onblocked = resolve;
                    })));
                }
            } catch (e) { console.error(e); }

            alert('本地数据已清除，请刷新起始页');
            window.close();
        });
    }
})();
