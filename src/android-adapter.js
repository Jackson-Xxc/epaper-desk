(() => {
  if (!window.AndroidBridge) return;

  document.documentElement.classList.add("android-app");
  window.isAndroidApp = true;

  const pending = new Map();
  const eventHandlers = new Map();

  function parseJson(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  function invoke(method, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = window.AndroidBridge.call(method, JSON.stringify(payload));
      pending.set(requestId, { resolve, reject });
    });
  }

  function emit(type, payload) {
    (eventHandlers.get(type) || []).forEach((callback) => callback(payload));
  }

  function on(type, callback) {
    const handlers = eventHandlers.get(type) || [];
    handlers.push(callback);
    eventHandlers.set(type, handlers);
  }

  window.__androidResolve = (requestId, success, payloadJson) => {
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    const payload = parseJson(payloadJson);
    if (success) request.resolve(payload);
    else request.reject(new Error(payload?.message || String(payload || "Android 操作失败")));
  };

  window.__androidEvent = (type, payloadJson) => {
    emit(type, parseJson(payloadJson));
  };

  window.desktop = {
    getAppVersion: () => invoke("appVersion"),
    getSettings: () => invoke("settingsGet"),
    setSettings: (settings) => invoke("settingsSet", settings),
    selectBluetoothDevice: () => Promise.resolve(),
    cancelBluetoothDevice: () => Promise.resolve(),
    onBluetoothDevices: () => {},
    connectNativeBle: () => invoke("bleConnect"),
    disconnectNativeBle: () => invoke("bleDisconnect"),
    writeNativeBle: (options) => invoke("bleWrite", options),
    getFeishuAuthStatus: () => invoke("feishuAuthStatus"),
    loginFeishu: (options) => invoke("feishuLogin", options),
    logoutFeishu: () => invoke("feishuLogout"),
    getFeishuEvents: (options) => invoke("feishuEvents", options),
    getFeishuTasks: (options) => invoke("feishuTasks", options),
    sendNativeBle: (options) => invoke("bleSendImage", options),
    onNativeBleProgress: (callback) => on("bleProgress", callback),
    onNativeBleState: (callback) => on("bleState", callback),
    getCodexQuota: () => Promise.reject(new Error("手机版无法读取电脑上的 Codex 登录，请使用手动额度")),
    savePreview: (dataUrl) => invoke("savePreview", { dataUrl }),
    openExternal: (url) => invoke("openExternal", { url }),
  };
})();
