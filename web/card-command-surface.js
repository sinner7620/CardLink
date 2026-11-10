import { createSceneCommandTransport } from './src/lib/sceneTransport.js';

// A visible command host in the existing documented mini panel, not a hidden worker.
window.CardLinkCommandSurface = {
  install(sdk, ready) {
    let active = false, transport;
    const inWorkbench = () => window.__MN_WORKBENCH_MOUNTING__ === true;
    const root = document.getElementById('root');
    let surface;
    function show(message, failed = false) {
      const compact = !inWorkbench();
      active = compact;
      if (!surface) {
        surface = document.createElement('div');
        surface.setAttribute('role', 'status');
        surface.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fafafa;color:#333;font:13px system-ui;box-sizing:border-box;overflow:auto';
        document.body.appendChild(surface);
      }
      if (compact) root.hidden = true;
      else surface.style.cssText = "position:fixed;left:16px;bottom:60px;z-index:2147483647;display:flex;gap:8px;padding:10px 14px;max-width:calc(100vw - 32px);background:#fff;color:#333;border:1px solid #dce2eb;border-radius:12px;box-shadow:0 4px 18px #0002;font:13px system-ui";
      surface.replaceChildren();
      const text = document.createElement('span'); text.textContent = message;
      text.style.cssText = 'flex:1;overflow-wrap:anywhere'; surface.appendChild(text);
      if (failed) {
        const close = document.createElement('button'); close.textContent = '关闭';
        close.onclick = () => { if (compact) return sdk.call('sceneClose', {}); surface.remove(); surface = null; }; surface.appendChild(close);
      }
      if (compact) { sdk.mode('mini'); sdk.size(240, failed ? 100 : 64); }
    }
    window.CardLinkCardMenu.listen(async payload => {
      if (!inWorkbench()) show(payload.id === 'findAnswer' ? '正在查找答案…' : '正在打开卡片侧边反馈…');
      try {
        await ready;
        await sdk.call('sceneCommandReady', {});
        transport ||= createSceneCommandTransport(sdk, window, window.fetch.bind(window), window.CardLinkHostPolicy, 'card-menu-',
          (command, target) => command === 'cardMenuCommand' && target?.id === 'markMistake' ? null : 60000);
        await transport.send('cardMenuCommand', payload);
      } catch (error) { show(error.message || String(error), true); throw error; }
    }, () => active ? sdk.call('sceneClose', {}) : undefined);
    return { active: () => active, restoreWorkbench() { active = false; root.hidden = false; if (surface) { surface.remove(); surface = null; } } };
  }
};
