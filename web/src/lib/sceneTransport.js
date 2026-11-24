import { resetSceneWindowSize } from "./sceneWindow"
import { createWritingSessionClient } from "./writingSession"
// Command-only channel: no workbench callbacks, practice subscriptions or annotation replies.
export function createSceneCommandTransport(sdk, windowObject, fetchImpl, policy, requestPrefix = 'card-menu-', requestTimeoutMs = () => 60000) {
  const pending = new Map();
  let disposed = false;
  const sequences = windowObject.__CARDLINK_SCENE_REQUEST_SEQUENCES__ ||= new Map();
  const onResponse = event => {
    const response = event.detail || {}, request = pending.get(response.requestId);
    if (!request) return;
    pending.delete(response.requestId); clearTimeout(request.timer);
    if (response.error) request.reject(new Error(response.error.message || response.error.code));
    else request.resolve(response.payload);
  };
  windowObject.addEventListener('mn:bridgeResponse', onResponse);
  async function api(path, options) {
    const opts = { ...(options || {}) };
    if (opts.body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(opts.body); }
    const response = await fetchImpl('/bridge/v1' + path, opts);
    const result = await response.json();
    if (result.error) throw Object.assign(new Error(result.error.message || result.error.code), { code: result.error.code });
    return result;
  }
  async function verify() {
    if (disposed) throw new Error('场景通道已销毁');
    if (!policy.versionAtLeast450(windowObject.__MN_HOST_VERSION__)) throw new Error('新接口要求软件 4.5.0 及以上');
    let ui;
    try { ui = await api('/ui-state'); }
    catch (error) { await sdk.call('sceneRejected', {}).catch(() => {}); throw error; }
    if (!policy.sceneEnabled(windowObject.__MN_HOST_VERSION__, ui)) {
      await sdk.call('sceneRejected', {});
      throw new Error('已离开场景页面，新接口已停用');
    }
    // Media/boot checks can suspend the same native session too. Confirm the
    // freshly read scene instead of relying on transport-local suspension state.
    const ack = await sdk.call('sceneReady', ui);
    if (disposed) throw new Error('场景通道已销毁');
    if (ack?.enabled !== true) throw new Error('场景状态尚未恢复，请稍后重试');
    return ui;
  }
  function nativeRequest(command, payload) {
    if (disposed) return Promise.reject(new Error('场景通道已销毁'));
    const sequence = (sequences.get(requestPrefix) || 0) + 1;
    sequences.set(requestPrefix, sequence);
    const requestId = requestPrefix + sequence;
    return new Promise((resolve, reject) => {
      const timeout = requestTimeoutMs(command, payload);
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('场景请求超时')); }, timeout ?? 60000);
      pending.set(requestId, { resolve, reject, timer });
      sdk.call('bridgeRequest', { requestId, command, payload }).then(ack => {
        if (ack?.error) throw new Error(ack.error.message);
        if (!ack?.accepted) throw new Error('场景请求未被接收');
        // An accepted interactive request ends only when the user saves or cancels.
        if (timeout === null) clearTimeout(timer);
      }).catch(error => { clearTimeout(timer); pending.delete(requestId); reject(error); });
    });
  }
  return {
    api, verify, nativeRequest,
    busy: () => pending.size > 0,
    async send(command, payload) { await verify(); return nativeRequest(command, payload); },
    dispose() {
      if (disposed) return;
      disposed = true;
      windowObject.removeEventListener('mn:bridgeResponse', onResponse);
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('场景通道已销毁')); }
      pending.clear();
    }
  };
}

export function createSceneTransport(sdk, windowObject, fetchImpl, policy, annotationClient, requestPrefix = 'scene-', requestTimeoutMs = () => 60000) {
  if (!annotationClient) throw new Error('练习批注客户端尚未初始化');
  windowObject.__CARDLINK_REVIEW_TRANSPORT__?.dispose();
  const channel = createSceneCommandTransport(sdk, windowObject, fetchImpl, policy, requestPrefix, requestTimeoutMs);
  const { api, verify, nativeRequest } = channel;
  let disposed = false;
  const listeners = [];
  function listen(name, handler) {
    const activeHandler = event => { if (!disposed) return handler(event); };
    windowObject.addEventListener(name, activeHandler);
    listeners.push([name, activeHandler]);
  }
  // SDK subscriptions remain registered; disposed controllers ignore later events.
  function subscribe(name, handler) { sdk.on(name, event => { if (!disposed) return handler(event); }); }
  function reply(payload) { if (!disposed) return sdk.call('reviewAnnotationReply', payload); }
  let sequence = 0, annotationTarget = null, annotationOpening = false;
  let annotationClosed = null;
  let writingClient;
  let earlyPracticeEvents = [];
  const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  const matchesTarget = (target, id) => [target.noteid, ...(target.hostNoteIds || [])].some(value => sameId(value, id));
  function log(event, detail) {
    try { Promise.resolve(sdk.call('sceneLog', { event, detail: String(detail || '').slice(0, 400) })).catch(() => {}); } catch (_) {}
  }
  // Keep each fragment below both the Web and native 400-character limit.
  // Every fragment retains its request ID and position for exported logs.
  function logData(event, data, traceId) {
    try {
      const encoded = JSON.stringify(data), trace = String(traceId || 'unmatched');
      const size = Math.max(40, 360 - trace.length);
      const count = Math.ceil(encoded.length / size) || 1;
      for (let i = 0; i < count; i++) log(event, `trace=${trace} part=${i + 1}/${count} ${encoded.slice(i * size, (i + 1) * size)}`);
    } catch (_) {}
  }
  function diagnostic(traceId, target) {
    logData('annotation.trace', { operation: target.operation || 'open', noteid: target.noteid ?? null,
      reviewToken: target.reviewToken ?? null, ordinary: target.ordinary === true, hostVersion: windowObject.__MN_HOST_VERSION__ ?? null }, traceId);
    return (event, data) => logData(event, data, traceId);
  }
  // 折叠写入只走官方场景 SDK：mn.api 等价于 fetch('/bridge/v1'+path).then(r => r.json())，
  // 错误对象落在 resolve 里，因此要显式检查 error。changed/folded 只作为诊断，
  // 成功与否由 JSB 侧按题卡读回决定。
  async function foldMindmapBranch(noteid, folded) {
    if (typeof sdk.api !== 'function') throw new Error('当前宿主未提供场景 SDK 的 mn.api');
    const result = await sdk.api('/notes/fold', { method: 'POST', body: { noteIds: [noteid], folded, confirm: true } });
    if (!result || typeof result !== 'object') throw new Error('折叠接口未返回结果');
    if (result.error) throw Object.assign(new Error(result.error.message || result.error.code || '折叠接口返回错误'), { code: result.error.code });
    const target = noteid.toLowerCase();
    const skipped = (Array.isArray(result.skipped) ? result.skipped : []).find(item => item && typeof item.noteid === 'string' && item.noteid.toLowerCase() === target);
    return {
      folded: result.folded === true ? true : result.folded === false ? false : undefined,
      topicid: typeof result.topicid === 'string' ? result.topicid : undefined,
      skipped: skipped ? { noteid: skipped.noteid, reason: skipped.reason } : undefined,
      changed: Array.isArray(result.changed) ? result.changed.length : undefined,
      bridgeApiVersion: typeof result.bridgeApiVersion === 'string' ? result.bridgeApiVersion : undefined
    };
  }
  // `/notes/fold` 的请求体没有 topicid，只能靠面板刚读到的界面状态确认作用域。
  // 键集合随版本变化，只读认识的 topicid；读不到就当作未知，不允许写入。
  function sceneTopic(ui) {
    const state = ui && ui.state;
    if (!state || typeof state !== 'object') return '';
    return typeof state.topicid === 'string' ? state.topicid.trim() : '';
  }
  const sameIdentifier = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim() !== '' && a.trim().toLowerCase() === b.trim().toLowerCase();
  listen('mn:foldBranch', async event => {
    const detail = event.detail || {};
    const requestId = detail.requestId;
    if (!requestId || typeof detail.noteid !== 'string' || !detail.noteid) return;
    let payload;
    let posted = false;
    try {
      if (typeof detail.notebookId !== 'string' || !detail.notebookId.trim()) throw new Error('折叠请求缺少学习集，未写入分支状态');
      const ui = await verify();
      const current = sceneTopic(ui);
      if (!current) throw new Error('无法确认场景当前学习集，未写入分支状态');
      if (!sameIdentifier(current, detail.notebookId)) {
        throw Object.assign(new Error('场景当前学习集与目标题卡不一致，未写入分支状态'), { topicid: current });
      }
      posted = true;
      payload = { requestId, dispatched: true, result: Object.assign(await foldMindmapBranch(detail.noteid, detail.folded === true), { sceneTopic: current }) };
      log('mindmap.fold.written', `noteid=${detail.noteid} folded=${detail.folded === true} topicid=${payload.result.topicid || '(空)'} scene=${current} changed=${payload.result.changed ?? '(无)'}`);
    } catch (error) {
      payload = { requestId, dispatched: posted, error: error.message || String(error), code: error.code, topicid: error.topicid };
      log('mindmap.fold.failed', `dispatched=${posted} ${error.message || String(error)}`);
    }
    if (!disposed) try { await sdk.call('foldBranchReply', payload); }
    catch (error) { log('mindmap.fold.replyFailed', error.message || String(error)); }
  });
  listen('mn:nativeDataChanged', () => windowObject.__onNativeDataChanged?.());
  listen('mn:nativeBindingsChanged', () => windowObject.__onNativeBindingsChanged?.());
  listen('mn:updatePrompt', event => windowObject.__cardLinkUpdatePrompt?.(event.detail ?? null));
  listen('mn:panelShown', event => windowObject.__onPanelShow?.(event.detail));
  listen('mn:clipperToolsRead', async event => {
    const requestId = event.detail?.requestId;
    if (!requestId) return;
    let payload;
    try {
      await verify();
      const config = await api('/immersive/template');
      const result = { available: config.available, reason: config.reason, template: { id: config.template?.id },
        excerptTools: { source: config.excerptTools?.source, tools: config.excerptTools?.tools } };
      payload = { requestId, result };
    } catch (error) {
      payload = { requestId, error: error.message || String(error) };
    }
    if (!disposed) try { await sdk.call('clipperToolsReply', payload); }
    catch (error) { log('clipper.tools.replyFailed', error.message || String(error)); }
  });
  async function onPractice(event) {
    annotationClient.invalidate?.(event.noteid);
    logData('review.practice.received', { noteid: event.noteid ?? null, commentId: event.commentId ?? null,
      action: event.action ?? null, saved: event.saved ?? null, opening: annotationOpening }, annotationTarget?.diagnosticRequestId);
    if (annotationOpening && annotationTarget?.reviewToken) { earlyPracticeEvents = [...earlyPracticeEvents.slice(-3), event]; return; }
    if (!annotationTarget || !matchesTarget(annotationTarget, event.noteid)) return;
    const target = annotationTarget; annotationTarget = null;
    const closed = { ...event, ...(target.ordinary && event.action === 'saved' ? { action: target.advance } : {}), ...(target.rejectedOldSheet ? { action: 'closed', identityUnconfirmed: true } : {}), ...(target.reusedExisting ? { reusedExisting: true } : {}), hostNoteid: event.noteid, noteid: target.noteid, reviewToken: target.reviewToken };
    // Retain the host close receipt before crossing into JSB. A failed delivery
    // must not turn a closed editor back into an allegedly open editor.
    if (target.reviewToken) annotationClosed = closed;
    logData('annotation.closed', { noteid: closed.noteid, hostNoteid: closed.hostNoteid, commentId: closed.commentId ?? null,
      action: closed.action, saved: closed.saved, hostSaved: event.saved, rejectedOldSheet: !!target.rejectedOldSheet,
      reviewToken: closed.reviewToken ?? null }, target.diagnosticRequestId);
    if (target.reviewToken) {
      try {
        const ack = await sdk.call('reviewAnnotationClosed', closed);
        if (ack?.error) throw new Error(ack.error.message || ack.error.code);
        if (ack?.accepted === false) throw new Error('关闭事件未被复习队列接收');
      } catch (error) {
        log('review.practice.deliveryFailed', error.message);
        return;
      }
    }
    if (!event.saved) return;
    try {
      // The host editor can cover the scene while emitting save/close events.
      const result = await annotationClient.read(target.noteid, (event, data) => logData(event, data, target.diagnosticRequestId));
      if (event.commentId && (result.comments || []).some(c => c.commentId === event.commentId)) {
        windowObject.dispatchEvent(new windowObject.CustomEvent('cardlink:annotation-saved', { detail: { recordId: target.recordId } }));
      }
    } catch (error) { log('annotation.saveCheckFailed', error.message); }
  }
  subscribe('practice', onPractice);
  subscribe('comments', async event => {
    [event.noteid, ...(event.noteids || [])].filter(Boolean).forEach(id => annotationClient.invalidate?.(id));
    const target = annotationTarget;
    if (!target || ![event.noteid, ...(event.noteids || [])].some(id => matchesTarget(target, id))) return;
    try {
      await annotationClient.read(target.noteid);
      windowObject.dispatchEvent(new windowObject.CustomEvent('cardlink:annotation-saved', { detail: { recordId: target.recordId } }));
    } catch (error) { log('annotation.saveCheckFailed', error.message); }
  });
  listen('mn:reviewAnnotationOpen', async event => {
    const { requestId, target } = event.detail || {};
    if (!target || !requestId) return;
    target.diagnosticRequestId = requestId;
    const report = diagnostic(requestId, target);
    if (typeof target.operation === 'string' && target.operation.startsWith('writing-')) {
      try {
        await verify();
        writingClient ||= createWritingSessionClient(api, async () => {
          const response = await fetchImpl('/bridge/v1/guide');
          if (!response.ok) throw new Error('无法读取宿主手写会话运行指南');
          const text = await response.text();
          if (!text.trim()) throw new Error('宿主手写会话运行指南为空');
        }, (event, data) => logData(event, data, requestId));
        const operation = target.operation;
        const result = operation === 'writing-config' ? await writingClient.capabilities()
          : operation === 'writing-open' ? await writingClient.open(target)
          : operation === 'writing-complete' ? await writingClient.complete(target)
          : operation === 'writing-finish' ? await writingClient.finish()
          : (() => { throw new Error('未知手写会话操作'); })();
        await reply( { requestId, result });
      } catch (error) {
        report('writing.operation.error', { operation: target.operation, code: error.code ?? null, message: error.message });
        await reply( { requestId, error: error.message, editorMayBeOpen: target.operation === 'writing-open' && writingClient?.mayBeOpen(target.reviewToken) === true });
      }
      return;
    }
    // Plugin-owned Canvas editor uses the scene only for documented comment
    // reads/folding. It never opens or takes over the host annotation editor.
    if (target.operation === 'ink-read' || target.operation === 'ink-fold') {
      try {
        await verify();
        const caps = await api('/capabilities');
        // The runtime catalogue uses {id}; OpenAPI calls the same segment
        // {noteid}. Compare route structure, not placeholder spelling.
        if (!(caps.routes || []).some(r => r.method === 'POST' && typeof r.path === 'string' &&
          r.path.replace(/\{[^/{}]+\}/g, '{}') === '/notes/{}/comments/fold')) throw new Error('当前宿主未提供评论折叠接口，无法启用插件内批注保存');
        const path = '/notes/' + encodeURIComponent(target.noteid) + '/comments';
        let result = await api(path);
        if (target.operation === 'ink-fold') {
          const comment = (result.comments || []).find(c => c.text === target.marker);
          if (!comment) throw new Error('未读回插件图片评论，不能确认保存');
          const written = await api(path + '/fold', { method: 'POST', body: {
            targets: [{ index: comment.index }], collapsed: true, expectedRevision: result.revision, confirm: true
          } });
          if (written.persisted !== true) throw new Error('评论折叠未确认');
          result = { ...(await api(path)), persisted: true };
          windowObject.dispatchEvent(new windowObject.CustomEvent('cardlink:annotation-saved', { detail: { noteid: target.noteid } }));
        }
        await reply( { requestId, result });
      } catch (error) { await reply( { requestId, error: error.message, editorMayBeOpen: false }); }
      return;
    }
    if (target.operation === 'practice-history') {
      try { await verify(); await reply( { requestId, result: await annotationClient.read(target.noteid, report) }); }
      catch (error) { report('annotation.operation.error', { code: error.code ?? null, operation: target.operation }); await reply( { requestId, error: error.message, editorMayBeOpen: false }); }
      return;
    }
    if (target.operation === 'practice-discard') {
      try {
        if (annotationOpening || annotationTarget || annotationClosed?.reviewToken !== target.reviewToken ||
            annotationClosed.saved !== true || annotationClosed.commentId !== target.commentId || !sameId(annotationClosed.noteid, target.noteid))
          throw new Error('新批注尚未确认保存关闭，不能丢弃');
        await verify();
        const result = await annotationClient.discardFresh(target.noteid, target, verify);
        await reply( { requestId, result });
        windowObject.dispatchEvent(new windowObject.CustomEvent('cardlink:annotation-saved', { detail: { noteid: target.noteid } }));
      } catch (error) { await reply( { requestId, error: error.message, editorMayBeOpen: false }); }
      return;
    }
    if (target.operation === 'practice-config' || target.operation === 'practice-verdict') {
      try {
        await verify();
        const result = target.operation === 'practice-config' ? await annotationClient.practiceConfig(report)
          : await annotationClient.verdict(target.noteid, { ...target, diagnostic: report }, verify);
        if (target.operation === 'practice-config') report('annotation.practice.mode', { mode: result.available === false ? 'blocked' : 'native', reason: result.reason ?? null });
        await reply( { requestId, result });
        if (target.operation === 'practice-verdict') windowObject.dispatchEvent(new windowObject.CustomEvent('cardlink:annotation-saved', { detail: { noteid: target.noteid } }));
      } catch (error) { report('annotation.operation.error', { code: error.code ?? null, operation: target.operation }); await reply( { requestId, error: error.message, editorMayBeOpen: false }); }
      return;
    }
    // Internal reconciliation protocol, not a host API for closing an editor.
    if (target.operation === 'status' || target.operation === 'release') {
      let result;
      if (annotationClosed?.reviewToken === target.reviewToken) result = { state: 'closed', event: annotationClosed };
      else if (target.operation === 'release' && !annotationOpening && (!annotationTarget || annotationTarget.reviewToken === target.reviewToken)) {
        if (annotationTarget?.reviewToken === target.reviewToken) annotationTarget = null;
        result = { state: 'released' };
      } else result = { state: 'unknown' };
      await reply( { requestId, result });
      return;
    }
    if (annotationOpening || annotationTarget?.reviewToken) {
      await reply( { requestId, error: '请先关闭当前批注窗口', editorMayBeOpen: false });
      return;
    }
    annotationOpening = true;
    earlyPracticeEvents = [];
    let writeStarted = false;
    const started = Date.now();
    try {
      annotationTarget = target;
      log('review.annotation.request', 'noteid=' + target.noteid + '; advance=' + target.advance);
      const result = await annotationClient.open(target.noteid, async () => { await verify(); writeStarted = true; }, { advance: target.advance, topicid: target.topicid, commentId: target.commentId, newAttempt: target.newAttempt, reviewToken: target.reviewToken, ordinary: target.ordinary, diagnostic: report });
      target.reusedExisting = result.reusedExisting === true;
      target.hostNoteIds = [result.noteid, result.practice?.card].filter(id => typeof id === 'string');
      if (!target.ordinary && result.advance !== target.advance) throw new Error('宿主未确认批注的下一题按钮，请关闭当前窗口后重试');
      log('review.annotation.opened', 'noteid=' + target.noteid + '; advance=' + result.advance + '; ms=' + (Date.now() - started));
      await reply( { requestId, result });
      if (target.nextNoteid) annotationClient.prefetch?.(target.nextNoteid).catch(error => log('review.annotation.prefetchFailed', error.message));
    } catch (error) {
      // An unconfirmed open may still have presented an editor. Keep its identity
      // until its close event so a late reply cannot open another card over it.
      if (error.code === 'OLD_PRACTICE_SHEET_OPENED' && annotationTarget === target) { target.rejectedOldSheet = true; target.hostNoteIds = [error.openedSheet?.noteid, error.openedSheet?.practice?.card].filter(id => typeof id === 'string'); }
      const editorMayBeOpen = writeStarted && error.editorMayBeOpen !== false;
      report('annotation.operation.error', { code: error.code ?? null, editorMayBeOpen, rejectedOldSheet: !!target.rejectedOldSheet });
      log('review.annotation.failed', 'uncertain=' + editorMayBeOpen + '; ' + error.message);
      if (!editorMayBeOpen && annotationTarget === target) annotationTarget = null;
      await reply( { requestId, error: error.message, editorMayBeOpen });
    } finally {
      annotationOpening = false;
      const early = earlyPracticeEvents; earlyPracticeEvents = [];
      for (const closed of early) if (annotationTarget === target && matchesTarget(target, closed.noteid)) await onPractice(closed);
    }
  });
  const transport = {
    busy: channel.busy,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [name, handler] of listeners) windowObject.removeEventListener(name, handler);
      channel.dispose();
      if (windowObject.__CARDLINK_REVIEW_TRANSPORT__ === transport) delete windowObject.__CARDLINK_REVIEW_TRANSPORT__;
    },
    async send(command, payload) {
      await verify();
      if (command === 'closePanel') return sdk.call('sceneMinimize', {});
      if (command === 'resetPanelFrame') {
        resetSceneWindowSize(windowObject, sdk);
        return { reset: true };
      }
      if (command !== 'openMistakeHandwriting') return nativeRequest(command, payload);
      if (annotationTarget?.reviewToken) throw new Error('请先关闭当前复习批注窗口');
      if (annotationOpening) throw new Error('正在打开批注面板，请稍候');
      annotationOpening = true;
      const previousTarget = annotationTarget;
      let report;
      try {
        const target = await nativeRequest(command, payload);
        await verify();
        annotationTarget = target;
        target.diagnosticRequestId = `ordinary-${Date.now()}-${++sequence}`;
        report = diagnostic(target.diagnosticRequestId, target);
        log('annotation.comments.request', 'mode=ordinary; noteid=' + target.noteid);
        const result = await annotationClient.open(target.noteid, async () => {
          await verify();
          log('annotation.editor.request', 'mode=ordinary; noteid=' + target.noteid);
        }, { diagnostic: report });
        log('annotation.opened', 'editorOpened=' + result.editorOpened);
        // Keep the full workbench available for choosing the next question.
        // The public scene SDK exposes size, but no floating-panel position API.
        if (result.editorOpened === true) sdk.size(360, 600);
        return result;
      } catch (error) { report?.('annotation.operation.error', { code: error.code ?? null, editorMayBeOpen: error.editorMayBeOpen ?? null }); annotationTarget = previousTarget; log('annotation.failed', error.message); throw error; }
      finally { annotationOpening = false; }
    }
  };
  windowObject.__CARDLINK_REVIEW_TRANSPORT__ = transport;
  return transport;
}
