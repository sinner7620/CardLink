(function (root) {
  // The host owns the editor and persistence; opening it never means saved.
  root.createCardLinkAnnotationClient = function (mn) {
    const revisions = new Map(), preparing = new Map();
    let freshAttempt;
    const key = id => String(id || '').toLowerCase();
    // Diagnostics only receive protocol metadata, never comment text or media.
    // A broken logger must not alter editor, retry, or persistence behavior.
    function emit(diagnostic, event, data) {
      try { diagnostic?.(event, data)?.catch?.(() => {}); } catch (_) {}
    }
    function practice(value) {
      if (!value) return null;
      return { addon: value.addon ?? null, topic: value.topic ?? null, card: value.card ?? null,
        self: value.self ?? null, reason: value.reason ?? null, at: value.at ?? null };
    }
    function snapshot(diagnostic, noteid, value, source) {
      if (!diagnostic) return;
      emit(diagnostic, 'annotation.comments.snapshot', { noteid, source, revision: value.revision, count: (value.comments || []).length });
      for (const c of value.comments || []) if (c.commentId) emit(diagnostic, 'annotation.comments.paper', {
        noteid, revision: value.revision, commentId: c.commentId, cardAnnotation: c.cardAnnotation ?? null, practice: practice(c.practice)
      });
    }
    function invalidate(noteid) { revisions.delete(key(noteid)); preparing.delete(key(noteid)); }
    async function request(path, options, timeout = 15000) {
      let timer;
      try {
        return checked(await Promise.race([
          mn.api(path, options),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('请求超时，结果尚未确认；请检查书写窗口，不要连续新建')), timeout); })
        ]));
      } finally { clearTimeout(timer); }
    }
    function checked(result) {
      if (result && result.error) throw Object.assign(new Error(result.error.message || result.error.code), { code: result.error.code, editorMayBeOpen: false });
      if (!result) throw new Error('MarginNote 未返回结果');
      return result;
    }
    async function read(noteid, diagnostic) {
      const result = await request('/notes/' + encodeURIComponent(noteid) + '/comments');
      if (typeof result.revision !== 'string' || !result.revision) throw new Error('未取得批注版本，请刷新后重试');
      if (diagnostic) snapshot(diagnostic, noteid, result, 'fresh-read');
      return result;
    }
    return {
      read,
      invalidate,
      async discardFresh(noteid, options, beforeWrite) {
        const attempt = freshAttempt;
        if (!attempt || key(attempt.noteid) !== key(noteid) || attempt.reviewToken !== options.reviewToken ||
            !options.commentId || attempt.commentIds.has(options.commentId)) throw new Error('未确认本次新批注身份，未丢弃任何批注');
        const before = await read(noteid);
        const paper = (before.comments || []).find(c => c.commentId === options.commentId);
        if (!paper?.cardAnnotation || paper.practice?.addon !== 'marginnote.extension.mn4-answer-matcher' ||
            key(paper.practice.topic) !== key(attempt.topicid) || (paper.practice.card && key(paper.practice.card) !== key(noteid)) ||
            !Number.isInteger(paper.index) || paper.index < 1) throw new Error('新批注身份不匹配，未丢弃历史批注');
        if (beforeWrite) await beforeWrite();
        await request('/notes/' + encodeURIComponent(noteid) + '/comments/' + paper.index + '/delete', {
          method: 'POST', body: { expectedPrefix: String(paper.text || '').slice(0, 32), confirm: true }
        });
        invalidate(noteid);
        const after = await read(noteid);
        if ((after.comments || []).some(c => c.commentId === options.commentId)) throw new Error('宿主未确认新批注已丢弃，请重试');
        if (freshAttempt === attempt) freshAttempt = undefined;
        return { discarded: true, commentId: options.commentId };
      },
      async practiceConfig(diagnostic) {
        const caps = await request('/capabilities');
        emit(diagnostic, 'annotation.practice.capabilities', { bridgeApiVersion: caps.bridgeApiVersion ?? null,
          verdictRoute: (caps.routes || []).some(r => r.method === 'POST' && typeof r.path === 'string' && r.path.replace(/\{[^/{}]+\}/g, '{}') === '/notes/{}/practice-verdict') });
        if (!(caps.routes || []).some(r => r.method === 'POST' && typeof r.path === 'string' && r.path.replace(/\{[^/{}]+\}/g, '{}') === '/notes/{}/practice-verdict')) return { available: false, reason: '当前宿主未提供作答判定接口' };
        const template = await request('/immersive/template');
        const mine = (template.plugins || []).find(p => p.addon === 'marginnote.extension.mn4-answer-matcher' && p.allowed === true);
        emit(diagnostic, 'annotation.practice.config', { allowed: !!mine, tagPrefix: mine?.config?.tagPrefix ?? null,
          reasonsConfigured: Array.isArray(mine?.config?.reasons), reasonCount: Array.isArray(mine?.config?.reasons) ? mine.config.reasons.length : null });
        if (!mine?.config?.tagPrefix || !Array.isArray(mine.config.reasons)) return { available: false, reason: '当前场景未配置原生作答判定' };
        return { available: true, reasons: mine.config.reasons.filter(r => typeof r.key === 'string' && typeof r.label === 'string') };
      },
      async verdict(noteid, options, beforeWrite) {
        if (!options.commentId || !options.topicid || !['got', 'again'].includes(options.self)) throw new Error('缺少本次作答身份，不能提交判定');
        const diagnostic = options.diagnostic;
        const before = await read(noteid, diagnostic);
        const paper = (before.comments || []).find(c => c.commentId === options.commentId);
        if (!paper || paper.practice?.addon !== 'marginnote.extension.mn4-answer-matcher' || key(paper.practice.topic) !== key(options.topicid)) throw new Error('本次作答纸身份不匹配，未修改历史批注');
        if (beforeWrite) await beforeWrite();
        emit(diagnostic, 'annotation.verdict.request', { noteid, commentId: options.commentId, expectedRevision: before.revision,
          topic: options.topicid, self: options.self, reason: options.self === 'got' ? null : options.reason || null });
        const result = await request('/notes/' + encodeURIComponent(noteid) + '/practice-verdict', { method: 'POST', body: {
          commentId: options.commentId, expectedRevision: before.revision, practice: { topic: options.topicid }, self: options.self, reason: options.self === 'got' ? null : options.reason || null, confirm: true
        } });
        emit(diagnostic, 'annotation.verdict.response', { noteid: result.noteid ?? null, commentId: result.commentId ?? null,
          persisted: result.persisted ?? null, commentsRevision: result.commentsRevision ?? null,
          bridgeApiVersion: result.bridgeApiVersion ?? null, practice: practice(result.practice), source: 'host-response' });
        if (result.persisted !== true || result.commentId !== options.commentId ||
            result.practice?.addon !== 'marginnote.extension.mn4-answer-matcher' || key(result.practice?.topic) !== key(options.topicid) || result.practice?.self !== options.self ||
            (result.practice?.reason ?? null) !== (options.self === 'got' ? null : options.reason || null))
          throw new Error('宿主未确认这份作答的官方反馈状态，未推进下一题');
        invalidate(noteid);
        return result;
      },
      async prefetch(noteid) {
        if (!noteid || revisions.has(key(noteid))) return;
        if (preparing.has(key(noteid))) return preparing.get(key(noteid));
        const task = read(noteid).then(value => {
          if (preparing.get(key(noteid)) !== task) return;
          revisions.set(key(noteid), { revision: value.revision, comments: value.comments });
          if (revisions.size > 2) revisions.delete(revisions.keys().next().value);
        }).finally(() => { if (preparing.get(key(noteid)) === task) preparing.delete(key(noteid)); });
        preparing.set(key(noteid), task);
        return task;
      },
      async open(noteid, beforeWrite, options = {}) {
        if (!noteid) throw new Error('未取得详情原题的题卡身份');
        const advancing = options.ordinary !== true && (options.advance === 'next' || options.advance === 'finish');
        const topic = typeof options.topicid === 'string' ? options.topicid.trim() : '';
        if (advancing && !topic) throw Object.assign(new Error('未取得复习题卡的来源学习集，无法打开连续批注'), { editorMayBeOpen: false });
        const canPrefetch = advancing || options.ordinary === true;
        if (canPrefetch && preparing.has(key(noteid))) await preparing.get(key(noteid)).catch(() => {});
        const cached = canPrefetch && revisions.get(key(noteid));
        invalidate(noteid);
        let before = cached || await read(noteid);
        freshAttempt = options.newAttempt && options.reviewToken && advancing ? {
          noteid, topicid: topic, reviewToken: options.reviewToken, commentIds: new Set((before.comments || []).map(c => c.commentId))
        } : undefined;
        const diagnostic = options.diagnostic;
        snapshot(diagnostic, noteid, before, cached ? 'prefetch-cache' : 'fresh-read');
        if (beforeWrite) await beforeWrite();
        // The documented ordinary annotation mode omits practice entirely;
        // it addresses the card by ID and needs no study-set navigation.
        const body = { expectedRevision: before.revision, confirm: true };
        if (!options.newAttempt && typeof options.commentId === 'string' && options.commentId) body.commentId = options.commentId;
        // The host requires advance and practice together. Panel identity supplies
        // addon; the topic belongs to the queued source card, never the UI focus.
        if (advancing) { body.advance = options.advance; body.practice = { topic }; }
        let result;
        const send = async attempt => {
          emit(diagnostic, 'annotation.editor.request', { noteid, attempt, newAttempt: options.newAttempt ?? null,
            commentIdPresent: Object.prototype.hasOwnProperty.call(body, 'commentId'), commentId: body.commentId ?? null,
            expectedRevision: body.expectedRevision, advance: body.advance ?? null, practice: body.practice || null, confirm: body.confirm });
          try {
            const value = await request('/notes/' + encodeURIComponent(noteid) + '/annotation-editor', { method: 'POST', body }, 30000);
            emit(diagnostic, 'annotation.editor.response', { attempt, noteid: value.noteid ?? null, editorOpened: value.editorOpened ?? null,
              commentId: value.commentId ?? null, continued: value.continued ?? null, persisted: value.persisted ?? null,
              advance: value.advance ?? null, bridgeApiVersion: value.bridgeApiVersion ?? null, practice: practice(value.practice),
              comparisonRevision: before.revision, knownCommentId: value.commentId ? (before.comments || []).some(c => c.commentId === value.commentId) : null });
            return value;
          } catch (error) {
            emit(diagnostic, 'annotation.editor.error', { attempt, noteid, code: error.code ?? null, editorMayBeOpen: error.editorMayBeOpen ?? null });
            throw error;
          }
        };
        try { result = await send(1); }
        catch (error) {
          if (!cached || error.code !== 'COMMENT_CHANGED') throw error;
          // Only a definite revision rejection permits one fresh retry. Never
          // retry an unconfirmed editor open or a generic transport failure.
          try {
            before = await read(noteid, diagnostic);
            body.expectedRevision = before.revision;
            if (freshAttempt && freshAttempt.reviewToken === options.reviewToken) freshAttempt.commentIds = new Set((before.comments || []).map(c => c.commentId));
            if (beforeWrite) await beforeWrite();
          } catch (preflightError) {
            // The previous POST was definitely rejected, and no retry was sent.
            throw Object.assign(preflightError, { editorMayBeOpen: false });
          }
          result = await send(2);
        }
        if (result.editorOpened !== true) throw new Error('未确认作答编辑器已打开，请检查当前卡片');
        if (!body.commentId && (result.continued === true || (result.commentId && (before.comments || []).some(c => c.commentId === result.commentId)))) {
          // A host may resume its current practice sheet instead of creating one.
          // Accept only an identified sheet owned by this addon and source topic.
          const paper = (before.comments || []).find(c => c.commentId === result.commentId)
            || (result.commentId ? (await read(noteid)).comments?.find(c => c.commentId === result.commentId) : null);
          const identity = paper?.practice;
          if (advancing && result.commentId && identity?.addon === 'marginnote.extension.mn4-answer-matcher' && key(identity.topic) === key(topic)) {
            freshAttempt = undefined;
            return { ...result, reusedExisting: true };
          }
          throw Object.assign(new Error('已打开的旧批注身份未确认，请先保存并关闭；本题未推进'), { code: 'OLD_PRACTICE_SHEET_OPENED', editorMayBeOpen: true, openedSheet: result });
        }
        return result;
      }
    };
  };
})(globalThis);
