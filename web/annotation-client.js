(function (root) {
  // The host owns the editor and persistence; opening it never means saved.
  root.createCardLinkAnnotationClient = function (mn) {
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
      if (result && result.error) throw new Error(result.error.message || result.error.code);
      if (!result) throw new Error('MarginNote 未返回结果');
      return result;
    }
    async function read(noteid) {
      const result = await request('/notes/' + encodeURIComponent(noteid) + '/comments');
      if (typeof result.revision !== 'string' || !result.revision) throw new Error('未取得批注版本，请刷新后重试');
      return result;
    }
    return {
      read,
      async open(noteid, beforeWrite) {
        if (!noteid) throw new Error('未取得详情原题的题卡身份');
        const before = await read(noteid);
        if (beforeWrite) await beforeWrite();
        // The documented ordinary annotation mode omits practice entirely;
        // it addresses the card by ID and needs no study-set navigation.
        const body = { expectedRevision: before.revision, confirm: true };
        const result = await request('/notes/' + encodeURIComponent(noteid) + '/annotation-editor', { method: 'POST', body }, 30000);
        if (result.editorOpened !== true) throw new Error('未确认作答编辑器已打开，请检查当前卡片');
        return result;
      }
    };
  };
})(globalThis);
