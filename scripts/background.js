/**
 * MoTab 末页 - Background Service Worker
 */

// 添加当前网站到捷径
async function addToShortcuts() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab.url && tab.url.startsWith('http')) {
            // 将URL作为查询参数传递（简化版，实际由popup处理）
            // 这里仅打开新标签页提示用户
            chrome.tabs.create({
                url: 'index.html?add=' + encodeURIComponent(tab.url)
            });
        }
    } catch (error) {
        console.error('添加捷径失败:', error);
    }
}

// 监听命令
chrome.commands.onCommand.addListener((command) => {
    if (command === 'add-shortcut') {
        addToShortcuts();
    }
});

// 监听安装/更新
chrome.runtime.onInstalled.addListener((details) => {
    console.log('MoTab 末页已安装/更新', details.reason);
});
