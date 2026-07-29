const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
  selectBluetoothDevice: (id) => ipcRenderer.invoke("bluetooth:select", id),
  cancelBluetoothDevice: () => ipcRenderer.invoke("bluetooth:cancel"),
  onBluetoothDevices: (callback) =>
    ipcRenderer.on("bluetooth-devices", (_event, devices) => callback(devices)),
  getFeishuAuthStatus: () => ipcRenderer.invoke("feishu:oauth:status"),
  loginFeishu: (options) => ipcRenderer.invoke("feishu:oauth:start", options),
  logoutFeishu: () => ipcRenderer.invoke("feishu:oauth:logout"),
  getFeishuEvents: (options) => ipcRenderer.invoke("feishu:events", options),
  getFeishuTasks: (options) => ipcRenderer.invoke("feishu:tasks", options),
  sendNativeBle: (options) => ipcRenderer.invoke("native-ble:send", options),
  onNativeBleProgress: (callback) =>
    ipcRenderer.on("native-ble:progress", (_event, payload) => callback(payload)),
  getCodexQuota: () => ipcRenderer.invoke("codex:quota"),
  savePreview: (dataUrl) => ipcRenderer.invoke("preview:save", dataUrl),
  openExternal: (url) => ipcRenderer.invoke("external:open", url),
});
