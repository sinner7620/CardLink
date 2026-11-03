// Focus-card sessions use native managed layers, never annotation-editor or comment IDs.
export function createWritingSessionClient(api, guide, report = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let active = null;
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  const fail = message => { throw new Error(message); };
  const post = (path, body = {}) => api(path, { method: 'POST', body });
  const id = () => globalThis.crypto.randomUUID();
  async function context(topicid) {
    const c = await post('/writing/context', { expectedTopicId: topicid });
    if (!same(c.window?.topicid, topicid)) fail('手写会话的学习集已变化，请回到题目所属学习集');
    return c;
  }
  async function capabilities() {
    const caps = await api('/capabilities');
    if (!(caps.routes || []).some(r => r.method === 'GET' && r.path === '/writing/capabilities')) return { available: false, reason: '当前宿主未提供手写会话接口' };
    const w = await api('/writing/capabilities');
    await guide();
    report('writing.capabilities', { bridgeApiVersion: w.bridgeApiVersion, session: w.practiceSessionRecord, layers: w.managedLayerTrial, pencil: w.pencilCommit });
    const s = w.practiceSessionRecord, l = w.managedLayerTrial;
    if (!w.carriers?.includes('focus') || s?.canCreate !== true || s.ready !== true || s.canSwitch !== true ||
        l?.ready !== true || l.canSwitch !== true || !w.pencilCommit?.submit || !w.practicePlan?.save)
      return { available: false, reason: '当前宿主尚未开放可用的焦点卡分层手写会话；请使用脑图或已配置模板的批注模式' };
    return { available: true };
  }
  // Keep every submitted request and its exact body. An uncertain retry only
  // queries the same ID; it must never allocate another attempt or layer.
  async function command(key, path, body, pencil = false) {
    let op = active.commands.get(key);
    if (!op) {
      op = { requestId: id(), body, response: null };
      active.commands.set(key, op);
      report('writing.command', { key, path, requestId: op.requestId, questionId: active.target.noteid });
      op.response = await post(path, { ...body, requestId: op.requestId, confirm: true });
    }
    let r = op.response;
    if (key === 'plan') {
      if (r?.persisted === true) return r;
      const read = await post('/writing/plan-read', { expectedTopicId: body.expectedTopicId });
      if (read.plan?.lastRequestId === op.requestId) return { persisted: true, plan: read.plan };
      fail('手写准备清单保存尚未确认，已保留原请求，未创建会话');
    }
    // These commands persist records, not canvas transitions. Creation is
    // verified by session-read; reserve is subsequently bound by focus-begin;
    // finish is verified by reading the released currentRunId.
    if (r?.persisted === true && (key === 'create' && r.runId || key === 'reserve' && r.attemptId || key === 'finish')) return r;
    for (let i = 0; i < 20; i++) {
      if (r?.layerLeaseUnresolved === true) fail('手写层占用结果未确认，已保留原请求，请先检查当前手写层');
      if (r?.code) fail(`手写会话未完成：${r.code}`);
      if (r?.settled === true) { op.response = r; return r; }
      if (i) await wait(150);
      r = await post(pencil ? '/writing/pencil-result' : '/writing/transition-result', { requestId: op.requestId });
      op.response = r;
    }
    fail('手写操作仍未确认，已保留原请求；再次操作只查询结果');
  }
  async function finish() {
    if (!active || active.finished) return { finished: true };
    if (!active.closed) fail('请先保存退出当前手写尝试');
    const r = await command('finish', '/writing/session-finish', { runId: active.runId, expectedTopicId: active.target.topicid });
    if (r.persisted !== true) fail('宿主未确认手写会话结束记录');
    const read = await post('/writing/session-read', { expectedTopicId: active.target.topicid });
    if (!Object.hasOwn(read, 'currentRunId') || read.currentRunId === active.runId) fail('宿主会话记录仍未确认结束，请保留本轮并重试');
    active.finished = true;
    return { finished: true };
  }
  return {
    capabilities,
    mayBeOpen: token => active?.target.reviewToken === token && active.commands.size > 0 && !active.finished,
    async open(target) {
      if (active && active.target.reviewToken !== target.reviewToken) {
        await finish();
        active = null;
      }
      if (!active) {
        const c = await capabilities();
        if (!c.available) fail(c.reason);
        await context(target.topicid);
        active = { target, commands: new Map(), closed: false, finished: false };
      }
      if (active.opened) return { editorOpened: true, runId: active.runId, attemptId: active.attemptId };
      if (!active.runId) {
        const old = await post('/writing/session-read', { expectedTopicId: target.topicid });
        // Do not replace an existing, possibly recoverable host run.
        if (old.currentRunId && !active.commands.has('create')) fail('宿主仍有未结束的手写会话，请先在原练习中结束或恢复');
        const plan = await post('/writing/plan-read', { expectedTopicId: target.topicid });
        if (!Number.isInteger(plan.plan?.revision)) fail('宿主未返回手写准备清单版本');
        const saved = await command('plan', '/writing/plan-save', { expectedTopicId: target.topicid,
          expectedRevision: plan.plan.revision, questions: [{ questionId: target.noteid, carrier: 'focus' }] });
        if (saved.persisted !== true) fail('宿主未确认手写准备清单');
        const planRead = await post('/writing/plan-read', { expectedTopicId: target.topicid });
        if (!planRead.plan?.questions?.some(q => same(q.questionId, target.noteid) && q.carrier === 'focus')) fail('未读回本题的手写准备选择');
        const created = await command('create', '/writing/session-create', { expectedTopicId: target.topicid });
        const read = await post('/writing/session-read', { expectedTopicId: target.topicid });
        if (!created.runId || read.currentRunId !== created.runId) fail('未读回本次手写会话身份，请保留当前窗口并重试');
        active.runId = created.runId;
      }
      if (!active.attemptId) {
        const reserved = await command('reserve', '/writing/session-reserve', { expectedTopicId: target.topicid,
          runId: active.runId, questionId: target.noteid, carrier: 'focus' });
        if (!reserved.attemptId) fail('宿主未返回本次手写尝试身份');
        active.attemptId = reserved.attemptId;
      }
      const opened = await command('begin', '/writing/session-focus-begin', { expectedTopicId: target.topicid,
        runId: active.runId, attemptId: active.attemptId, questionId: target.noteid, carrier: 'focus' });
      if (opened.ready !== true) fail('焦点卡手写层尚未就绪，请保留当前窗口并重试');
      await post('/writing/session-read', { expectedTopicId: target.topicid });
      active.opened = true;
      return { editorOpened: true, runId: active.runId, attemptId: active.attemptId };
    },
    async complete(target) {
      if (!active || active.target.reviewToken !== target.reviewToken) fail('手写会话身份已变化，未切题');
      if (active.closed) return { state: 'closed', event: active.event };
      const c = await context(active.target.topicid);
      const surface = (c.surfaces || []).find(s => s.kind === 'focus' && s.hiddenByHierarchy !== true &&
        same(s.state?.loadedBinding?.topicid, active.target.topicid) && same(s.state?.loadedBinding?.noteid, active.target.noteid));
      if (!surface?.surfaceId || surface.state?.rootCanvasOwnerMatches !== true ||
          typeof surface.state.activeLayerId !== 'string' || !surface.state.activeLayerId) fail('当前画布与本次专用手写层不匹配，未保存或切题');
      const saved = await command('save', '/writing/pencil-commit', { expectedTopicId: active.target.topicid,
        surfaceId: surface.surfaceId, target: { topicid: active.target.topicid, noteid: active.target.noteid, layerId: surface.state.activeLayerId } }, true);
      if (saved.persistedSnapshotVerified !== true || saved.snapshotCurrent !== true || saved.canSwitch !== true)
        fail('宿主未确认当前笔迹已保存并可切题，已保留本题');
      const exited = await command('exit', '/writing/session-exit', { expectedTopicId: active.target.topicid, runId: active.runId, attemptId: active.attemptId });
      if (exited.persisted !== true || exited.canSwitch !== true) fail('宿主未确认退出手写尝试，已保留本题');
      await post('/writing/session-read', { expectedTopicId: active.target.topicid });
      active.closed = true;
      active.event = { reviewToken: target.reviewToken, noteid: active.target.noteid, action: 'closed', saved: true,
        runId: active.runId, attemptId: active.attemptId };
      report('writing.saved', { runId: active.runId, attemptId: active.attemptId, saved: true });
      return { state: 'closed', event: active.event };
    },
    finish
  };
}
