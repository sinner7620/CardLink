(function (root) {
  function versionAtLeast450(version) {
    const match = String(version || '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) return false;
    const major = Number(match[1]), minor = Number(match[2]);
    return major > 4 || (major === 4 && minor >= 5);
  }
  root.CardLinkHostPolicy = {
    versionAtLeast450,
    sceneEnabled: (version, ui) => !!(versionAtLeast450(version) && ui && !ui.error && ui.state && ui.state.immersive === true)
  };
})(globalThis);
