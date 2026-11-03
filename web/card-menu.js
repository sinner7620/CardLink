(function (global) {
  var queue = [], consumer = null, onIdle = null, pending = Object.create(null), installed = false, lane = Promise.resolve(), failed = false;
  function normalize(event) {
    if (!event || (event.id !== 'findAnswer' && event.id !== 'markMistake')) return null;
    var lower = typeof event.noteid === 'string' ? event.noteid.trim() : '';
    var upper = typeof event.noteID === 'string' ? event.noteID.trim() : '';
    if (lower && upper && lower !== upper) return null;
    return lower || upper ? {id:event.id, noteID:lower || upper} : null;
  }
  function flush() {
    if (!consumer) return;
    var next = queue.splice(0);
    next.forEach(function (event) {
      var key = event.id + ':' + event.noteID;
      if (pending[key]) return;
      pending[key] = true;
      lane = lane.then(function () { return consumer && consumer(event); }).catch(function () { failed = true; }).then(function () {
        delete pending[key];
        if (Object.keys(pending).length === 0) {
          var shouldClose = !failed; failed = false;
          if (shouldClose && onIdle) return Promise.resolve(onIdle()).catch(function () {});
        }
      });
    });
  }
  global.CardLinkCardMenu = {
    install: function (sdk) {
      if (installed || !sdk || typeof sdk.on !== 'function') return;
      installed = true;
      sdk.on('cardCommand', function (event) {
        var command = normalize(event);
        if (!command) {
          if (event && (event.id === 'findAnswer' || event.id === 'markMistake')) {
            if (sdk.call) Promise.resolve(sdk.call('sceneLog',{event:'cardMenu.invalidTarget',detail:'keys='+Object.keys(event).join(',')})).catch(function () {});
          }
          return;
        }
        try { if (sdk.call) Promise.resolve(sdk.call('sceneLog', {event:'cardMenu.received',detail:'id='+event.id+' keys='+Object.keys(event).join(',')})).catch(function () {}); } catch (_) {}
        queue.push(command); flush();
      });
    },
    listen: function (handler, idle) {
      consumer = handler; onIdle = idle || null; flush();
      return function () { if (consumer === handler) { consumer = null; onIdle = null; } };
    }
  };
})(typeof window !== 'undefined' ? window : this);
