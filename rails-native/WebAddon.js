var __MNAM_WEB_ADDON_GLOBAL__ = (function () {
  function call(methods, name, args) {
    if (methods && typeof methods[name] === "function") {
      return methods[name].apply(self, args || []);
    }
  }

  function createAddon(mainPath) {
    var core = __MN_ANSWER_CORE_GLOBAL__;
    var methods = {};
    Object.assign(methods, core.lifecycle.instanceMethods, core.handlers, core.instanceMethods);

    // 跨学习集定位跳转后面板恢复时跳过一次自动刷新：跳转不改变错题数据。
    // 时间戳由 Core 的 note-navigation 写入，此处消费并清除。
    methods.shouldSuppressPanelReload = function () {
      try {
        var startedAt = Number(self.mn4LocateJumpStartedAtMs || 0);
        if (!startedAt) return false;
        self.mn4LocateJumpStartedAtMs = 0;
        return Date.now() - startedAt < 6000;
      } catch (error) {
        return false;
      }
    };

    methods.sceneWillConnect = function () {
      call(core.lifecycle.instanceMethods, "sceneWillConnect", arguments);
      self.mainPath = mainPath;
      self.webController = __MNAM_WEB_PANEL_GLOBAL__.createController(mainPath, self);
    };

    methods.notebookWillOpen = function () {
      call(core.lifecycle.instanceMethods, "notebookWillOpen", arguments);
      if (__MNAM_WEB_PANEL_GLOBAL__.shouldRestorePanel()) {
        if (self.webController && self.webController.preserveAcrossNotebookSwitch) {
          __MNAM_WEB_PANEL_GLOBAL__.restorePanelAfterNotebookSwitch(self.webController);
        } else {
          __MNAM_WEB_PANEL_GLOBAL__.showPanel(self.webController);
        }
        try { Application.sharedInstance().studyController(self.window).refreshAddonCommands(); } catch (error) {}
      }
    };

    methods.notebookWillClose = function () {
      if (self.pendingMistakeNavigation && __MNAM_WEB_PANEL_GLOBAL__.isVisible(self.webController)) {
        __MNAM_WEB_PANEL_GLOBAL__.preservePanelForNotebookSwitch(self.webController);
      } else {
        __MNAM_WEB_PANEL_GLOBAL__.hidePanel(self.webController, false);
        try { Application.sharedInstance().studyController(self.window).refreshAddonCommands(); } catch (error) {}
      }
      call(core.lifecycle.instanceMethods, "notebookWillClose", arguments);
    };

    methods.sceneDidDisconnect = function () {
      __MNAM_WEB_PANEL_GLOBAL__.destroyPanel(self.webController);
      self.webController = null;
      call(core.lifecycle.instanceMethods, "sceneDidDisconnect", arguments);
    };

    methods.controllerWillLayoutSubviews = function (controller) {
      if (controller === Application.sharedInstance().studyController(self.window)) {
        __MNAM_WEB_PANEL_GLOBAL__.ensureLayout(self.webController);
        call(core.instanceMethods, "ensureMnutilsEntrance");
      }
    };

    methods.queryAddonCommandStatus = function () {
      return {
        image: "logo.png",
        object: self,
        selector: "toggleWebPanel:",
        checked: __MNAM_WEB_PANEL_GLOBAL__.isVisible(self.webController)
      };
    };

    methods.toggleWebPanel = function () {
      if (__MNAM_WEB_PANEL_GLOBAL__.isVisible(self.webController)) {
        __MNAM_WEB_PANEL_GLOBAL__.hidePanel(self.webController, true);
      } else {
        __MNAM_WEB_PANEL_GLOBAL__.showPanel(self.webController);
      }
      try {
        var study = Application.sharedInstance().studyController(self.window);
        if (study) study.refreshAddonCommands();
      } catch (error) {}
    };

    // 侧边按钮开关不影响更新、提醒或定位生命周期。
    var classMethods = Object.assign({}, core.lifecycle.classMethods);
    classMethods.applicationWillEnterForeground = function () {
      call(core.lifecycle.classMethods, "applicationWillEnterForeground", arguments);
    };

    return JSB.defineClass(
      "MNAnswerMatcherRailsAddon : JSExtension",
      methods,
      classMethods
    );
  }

  return { createAddon: createAddon };
})();
