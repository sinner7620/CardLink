JSB.require("AnswerMatcherCore");
JSB.require("host-policy");
JSB.require("ui-constants");
JSB.require("WebBridgeCommands");
JSB.require("WebPanelController");
JSB.require("SceneMedia");
JSB.require("SceneWorkbench");
JSB.require("WebAddon");

JSB.newAddon = function (mainPath) {
  return __MNAM_WEB_ADDON_GLOBAL__.createAddon(mainPath);
};
