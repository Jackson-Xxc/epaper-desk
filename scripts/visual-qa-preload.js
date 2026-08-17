const { contextBridge } = require("electron");

let settings = {
  codexRemaining: 71,
  codexResetAt: "2026-08-03T14:20",
  codexAuto: false,
  codexSource: "manual",
  displayMode: "countdown",
  customNote: "专注今天最重要的一件事",
  photoDataUrl: "",
  photoZoom: 100,
  photoX: 0,
  photoY: 0,
  refreshMinutes: 60,
  onlyChanged: true,
  autoDisconnect: true,
  transferPreset: "auto",
  ledEnabled: false,
  feishuToken: "",
  feishuAppId: "",
  feishuAppSecret: "",
  feishuRedirectUri: "http://127.0.0.1:37691/feishu/oauth/callback",
  calendarId: "",
  taskListGuid: "",
  taskListName: "产品建模需求排期任务清单",
};

contextBridge.exposeInMainWorld("desktop", {
  getAppVersion: async () => "0.6.20",
  getSettings: async () => settings,
  setSettings: async (patch) => {
    settings = { ...settings, ...patch };
    return settings;
  },
  getFeishuAuthStatus: async () => ({ connected: false }),
  getCodexQuota: async () => {
    throw new Error("visual QA");
  },
  onBluetoothDevices: () => {},
  onNativeBleProgress: () => {},
  selectBluetoothDevice: async () => {},
  cancelBluetoothDevice: async () => {},
  loginFeishu: async () => ({ connected: false }),
  logoutFeishu: async () => ({ connected: false }),
  getFeishuEvents: async () => ({ events: [], scheduleCalendarNames: [] }),
  getFeishuTasks: async () => ({ tasks: [] }),
  sendNativeBle: async () => {},
  savePreview: async () => "",
  openExternal: async () => {},
});
