// background.js — 纯本地版本（Manifest V3 Service Worker），已移除所有外连逻辑
// 原版三个联网 handler：fetchbaidu / getWebsiteInfo / uploadIcon
// 本版本将 fetchbaidu 和 uploadIcon 改为本地返回，不发起任何网络请求
// 注意：MV3 下此文件以 Service Worker 运行，无 DOM/localStorage，只保留消息处理

chrome.runtime.onMessage.addListener(function (n, o, a) {

  // 【已禁用】原版向 baidu.com/sugrec 请求搜索建议
  // 现在直接返回空数组，不影响搜索功能本身（搜索由搜索引擎直接处理）
  if ("fetchbaidu" === n.todo) {
    a([]);
    return true;
  }

  // 获取网址元信息（标题、描述等）—— 保留，用户主动触发，仅拉取目标网页
  if ("getWebsiteInfo" === n.todo) {
    const controller = new AbortController();
    const signal = controller.signal;
    const url = n.url;
    // 超时 8 秒自动中断
    const timeout = setTimeout(() => controller.abort(), 8000);
    // Service Worker 中 fetch 默认不发送 Referer，且不受扩展页 CSP 限制
    // 移除 mode:"cors" 以避免预检请求失败；部分站点不支持 CORS 但仍可读取 HTML
    fetch(url, { method: "GET", signal, redirect: "follow" })
      .then(t => t.text())
      .then(t => { clearTimeout(timeout); a(t); })
      .catch(() => { clearTimeout(timeout); a(null); });
    return true;
  }

  // 【已禁用】原版向 web.gotab.cn 上传图标
  // 现在直接返回 null，不发起任何网络请求
  if ("uploadIcon" === n.todo) {
    a(null);
    return true;
  }

  return true;
});
