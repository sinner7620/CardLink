export function createSceneTransport(sdk, windowObject, fetchImpl, policy, annotationClient, requestPrefix = 'scene-', requestTimeoutMs = () => 60000) {
  const pending = new Map();
  let sequence = 0, annotationTarget = null, annotationOpening = false;
  function log(event, detail) { sdk.call('sceneLog', { event, detail: String(detail || '').slice(0, 400) }).catch(() => {}); }
  windowObject.addEventListener('mn:bridgeResponse', event => {
    const response = event.detail || {}, request = pending.get(response.requestId);
    if (!request) return;
    pending.delete(response.requestId); clearTimeout(request.timer);
    if (response.error) request.reject(new Error(response.error.message || response.error.code));
    else request.resolve(response.payload);
  });
  windowObject.addEventListener('mn:nativeDataChanged', () => windowObject.__onNativeDataChanged?.());
  windowObject.addEventListener('mn:nativeBindingsChanged', () => windowObject.__onNativeBindingsChanged?.());
  windowObject.addEventListener('mn:panelShown', event => windowObject.__onPanelShow?.(event.detail));
  sdk.on('practice', async event => {
    if (!annotationTarget || event.noteid !== annotationTarget.noteid) return;
    const target = annotationTarget; annotationTarget = null;
    log('annotation.closed', 'saved=' + event.saved);
    if (!event.saved) return;
    try {
      await verify();
      const result = await annotationClient.read(target.noteid);
      if (event.commentId && (result.comments || []).some(c => c.commentId === event.commentId)) {
        windowObject.dispatchEvent(new windowObject.CustomEvent('cardlink:annotation-saved', { detail: { recordId: target.recordId } }));
      }
    } catch (error) { log('annotation.saveCheckFailed', error.message); }
  });
  sdk.on('comments', async event => {
    const target = annotationTarget;
    if (!target || ![event.noteid, ...(event.noteids || [])].includes(target.noteid)) return;
    try {
      await verify();
      await annotationClient.read(target.noteid);
      windowObject.dispatchEvent(new windowObject.CustomEvent('cardlink:annotation-saved', { detail: { recordId: target.recordId } }));
    } catch (error) { log('annotation.saveCheckFailed', error.message); }
  });
  async function api(path, options) {
    const opts = { ...(options || {}) };
    if (opts.body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(opts.body); }
    const response = await fetchImpl('/bridge/v1' + path, opts);
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || result.error.code);
    return result;
  }
  async function verify() {
    if (!policy.versionAtLeast450(windowObject.__MN_HOST_VERSION__)) throw new Error('新接口要求软件 4.5.0 及以上');
    let ui;
    try { ui = await api('/ui-state'); }
    catch (error) { await sdk.call('sceneRejected', {}).catch(() => {}); throw error; }
    if (!policy.sceneEnabled(windowObject.__MN_HOST_VERSION__, ui)) {
      await sdk.call('sceneRejected', {});
      throw new Error('已离开场景页面，新接口已停用');
    }
    return ui;
  }
  function nativeRequest(command, payload) {
    const requestId = requestPrefix + (++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('场景请求超时')); }, requestTimeoutMs(command, payload));
      pending.set(requestId, { resolve, reject, timer });
      sdk.call('bridgeRequest', { requestId, command, payload }).then(ack => {
        if (ack?.error) throw new Error(ack.error.message);
        if (!ack?.accepted) throw new Error('场景请求未被接收');
      }).catch(error => { clearTimeout(timer); pending.delete(requestId); reject(error); });
    });
  }
  return {
    busy: () => pending.size > 0,
    async send(command, payload) {
      await verify();
      if (command === 'closePanel') return sdk.call('sceneMinimize', {});
      if (command === 'resetPanelFrame') {
        sdk.size(640, 620);
        try { windowObject.localStorage.setItem('cardlink.scene.windowSize', JSON.stringify({ width: 640, height: 620 })); } catch (_) {}
        return { reset: true };
      }
      if (command !== 'openMistakeHandwriting') return nativeRequest(command, payload);
      if (annotationOpening) throw new Error('正在打开批注面板，请稍候');
      annotationOpening = true;
      const previousTarget = annotationTarget;
      try {
        const target = await nativeRequest(command, payload);
        await verify();
        annotationTarget = target;
        log('annotation.comments.request', 'mode=ordinary; noteid=' + target.noteid);
        const result = await annotationClient.open(target.noteid, async () => {
          await verify();
          log('annotation.editor.request', 'mode=ordinary; noteid=' + target.noteid);
        });
        log('annotation.opened', 'editorOpened=' + result.editorOpened);
        // Keep the full workbench available for choosing the next question.
        // The public scene SDK exposes size, but no floating-panel position API.
        if (result.editorOpened === true) sdk.size(360, 600);
        return result;
      } catch (error) { annotationTarget = previousTarget; log('annotation.failed', error.message); throw error; }
      finally { annotationOpening = false; }
    }
  };
}
