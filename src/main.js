const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  session,
  safeStorage,
  shell,
  Tray,
} = require("electron");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

let mainWindow;
let tray;
let isQuitting = false;
let bluetoothSelection;
let feishuOAuthCancel;
let feishuRefreshPromise;
let nativeBleSending = false;

const FEISHU_AUTHORIZE_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const FEISHU_TOKEN_URL = "https://accounts.feishu.cn/oauth/v3/token";
const FEISHU_OAUTH_SCOPE = [
  "calendar:calendar:readonly",
  "task:tasklist:read",
  "offline_access",
].join(" ");
const FEISHU_REDIRECT_URI = "http://127.0.0.1:37691/feishu/oauth/callback";
const protectedSettingKeys = [
  "feishuToken",
  "feishuAppSecret",
  "feishuOAuthAccessToken",
  "feishuRefreshToken",
];

const defaults = {
  codexRemaining: 100,
  codexResetAt: "",
  codexAuto: true,
  codexSource: "unset",
  displayMode: "agenda",
  customNote: "专注今天最重要的一件事",
  photoDataUrl: "",
  photoZoom: 100,
  photoX: 0,
  photoY: 0,
  refreshMinutes: 60,
  onlyChanged: true,
  autoDisconnect: true,
  ledEnabled: false,
  feishuToken: "",
  feishuAppId: "",
  feishuAppSecret: "",
  feishuRedirectUri: FEISHU_REDIRECT_URI,
  feishuOAuthAccessToken: "",
  feishuRefreshToken: "",
  feishuTokenExpiresAt: 0,
  feishuRefreshTokenExpiresAt: 0,
  feishuOAuthScope: "",
  calendarId: "",
  taskListGuid: "",
  taskListName: "产品建模需求排期任务清单",
};

function configPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function protect(value) {
  if (!value) return "";
  if (safeStorage.isEncryptionAvailable()) {
    return `encrypted:${safeStorage.encryptString(value).toString("base64")}`;
  }
  return value;
}

function unprotect(value) {
  if (!value || !value.startsWith("encrypted:")) return value || "";
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(10), "base64"));
  } catch {
    return "";
  }
}

function readSettings() {
  try {
    const stored = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const settings = { ...defaults, ...stored };
    protectedSettingKeys.forEach((key) => {
      settings[key] = unprotect(stored[key]);
    });
    settings.feishuRedirectUri = FEISHU_REDIRECT_URI;
    return settings;
  } catch {
    return { ...defaults };
  }
}

function writeSettings(next) {
  const previous = readSettings();
  const merged = { ...previous, ...next, feishuRedirectUri: FEISHU_REDIRECT_URI };
  const disk = { ...merged };
  protectedSettingKeys.forEach((key) => {
    disk[key] = protect(merged[key]);
  });
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(disk, null, 2), "utf8");
  return merged;
}

function sendBluetoothDevices(devices) {
  mainWindow?.webContents.send(
    "bluetooth-devices",
    devices.map((item) => ({
      id: item.deviceId,
      name: item.deviceName || "未命名蓝牙设备",
    })),
  );
}

function configureBluetooth() {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((_webContents, permission) =>
    ["bluetooth", "bluetooth-scanning"].includes(permission),
  );
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(["bluetooth", "bluetooth-scanning"].includes(permission));
  });
}

function createWindow() {
  const icon = path.join(__dirname, "..", "assets", "icon.png");
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 820,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: "#f3f4ef",
    autoHideMenuBar: true,
    icon,
    title: "墨水屏桌面",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.webContents.on("select-bluetooth-device", (event, deviceList, callback) => {
    event.preventDefault();
    bluetoothSelection = callback;
    sendBluetoothDevices(deviceList);
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  const captureArg = process.argv.find((arg) => arg.startsWith("--capture="));
  if (captureArg) {
    mainWindow.webContents.once("did-finish-load", async () => {
      const tabArg = process.argv.find((arg) => arg.startsWith("--capture-tab="));
      if (tabArg) {
        const tabName = JSON.stringify(tabArg.slice("--capture-tab=".length));
        await mainWindow.webContents.executeJavaScript(
          `document.querySelector('[data-tab=' + ${tabName} + ']')?.click()`,
        );
      }
      const modeArg = process.argv.find((arg) => arg.startsWith("--capture-mode="));
      if (modeArg) {
        const modeName = JSON.stringify(modeArg.slice("--capture-mode=".length));
        await mainWindow.webContents.executeJavaScript(`
          (() => {
            const select = document.querySelector("#displayMode");
            if (!select) return;
            select.value = ${modeName};
            window.syncDisplayModeControl?.();
            window.renderPreview?.();
          })()
        `);
      }
      await new Promise((resolve) => setTimeout(resolve, 1800));
      const image = await mainWindow.webContents.capturePage();
      fs.writeFileSync(path.resolve(captureArg.slice("--capture=".length)), image.toPNG());
      isQuitting = true;
      app.quit();
    });
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "assets", "icon.png");
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 });
  tray = new Tray(trayIcon);
  tray.setToolTip("墨水屏桌面");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开墨水屏桌面", click: showMainWindow },
    { type: "separator" },
    {
      label: "彻底退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on("double-click", showMainWindow);
}

async function feishuRequest(url, token, options = {}) {
  const response = await net.fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.code) {
    throw new Error(json.msg || `飞书接口请求失败（HTTP ${response.status}）`);
  }
  return json;
}

function feishuAuthStatus(settings = readSettings()) {
  const now = Date.now();
  const accessValid = Boolean(
    settings.feishuOAuthAccessToken && Number(settings.feishuTokenExpiresAt) > now,
  );
  const refreshValid = Boolean(
    settings.feishuRefreshToken && Number(settings.feishuRefreshTokenExpiresAt) > now,
  );
  return {
    configured: Boolean(settings.feishuAppId && settings.feishuAppSecret),
    connected: accessValid || refreshValid,
    accessValid,
    refreshValid,
    expiresAt: Number(settings.feishuTokenExpiresAt) || 0,
    scope: settings.feishuOAuthScope || "",
  };
}

async function requestFeishuOAuthToken(body) {
  const response = await net.fetch(FEISHU_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code || !payload.access_token) {
    const detail = payload.error_description || payload.msg || payload.error;
    throw new Error(detail || `飞书登录失败（HTTP ${response.status}）`);
  }
  return payload;
}

function storeFeishuOAuthTokens(payload, { refreshing = false } = {}) {
  if (refreshing && !payload.refresh_token) {
    throw new Error("飞书刷新成功但未返回新的 refresh_token，请重新登录授权");
  }
  const now = Date.now();
  const refreshToken = payload.refresh_token || "";
  const next = writeSettings({
    feishuOAuthAccessToken: payload.access_token,
    feishuTokenExpiresAt: now + Math.max(0, Number(payload.expires_in) || 0) * 1000,
    feishuRefreshToken: refreshToken,
    feishuRefreshTokenExpiresAt: refreshToken
      ? now + Math.max(0, Number(payload.refresh_token_expires_in) || 0) * 1000
      : 0,
    feishuOAuthScope: payload.scope || "",
  });
  return next;
}

async function getValidFeishuAccessToken() {
  const settings = readSettings();
  if (
    settings.feishuOAuthAccessToken
    && Number(settings.feishuTokenExpiresAt) > Date.now() + 5 * 60 * 1000
  ) {
    return settings.feishuOAuthAccessToken;
  }
  if (!settings.feishuRefreshToken || Number(settings.feishuRefreshTokenExpiresAt) <= Date.now()) {
    throw new Error("飞书登录已过期，请重新点击“登录飞书”");
  }
  if (!settings.feishuAppId || !settings.feishuAppSecret) {
    throw new Error("缺少飞书 App ID 或 App Secret，无法刷新登录");
  }
  if (!feishuRefreshPromise) {
    feishuRefreshPromise = (async () => {
      const payload = await requestFeishuOAuthToken({
        grant_type: "refresh_token",
        client_id: settings.feishuAppId,
        client_secret: settings.feishuAppSecret,
        refresh_token: settings.feishuRefreshToken,
      });
      storeFeishuOAuthTokens(payload, { refreshing: true });
      return payload.access_token;
    })().finally(() => {
      feishuRefreshPromise = null;
    });
  }
  return feishuRefreshPromise;
}

function oauthResultPage(success, message) {
  const title = success ? "飞书登录成功" : "飞书登录失败";
  const color = success ? "#1e654c" : "#b63b34";
  const safeMessage = String(message)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title>
    <body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#f3f4ef;
    color:#17201d;font-family:'Segoe UI','Microsoft YaHei UI',sans-serif">
    <main style="width:min(420px,calc(100% - 48px));padding:32px;background:white;border-radius:18px;
    box-shadow:0 18px 50px rgba(27,46,39,.12);text-align:center">
    <div style="font-size:42px;color:${color}">${success ? "✓" : "!"}</div>
    <h1 style="font-size:24px">${title}</h1><p style="color:#69736f;line-height:1.7">${safeMessage}</p>
    <p style="font-size:13px;color:#69736f">现在可以关闭此页面并返回墨水屏桌面。</p>
    </main></body></html>`;
}

async function startFeishuOAuth({ appId, appSecret }) {
  const clientId = String(appId || "").trim();
  const clientSecret = String(appSecret || "").trim();
  if (!/^cli_[a-z0-9]+$/i.test(clientId)) {
    throw new Error("请先填写有效的飞书 App ID（以 cli_ 开头）");
  }
  if (clientSecret.length < 8) {
    throw new Error("请先填写飞书 App Secret");
  }

  feishuOAuthCancel?.(new Error("已开始新的飞书登录，上一登录请求已取消"));
  writeSettings({ feishuAppId: clientId, feishuAppSecret: clientSecret });

  const redirectUrl = new URL(FEISHU_REDIRECT_URI);
  const state = crypto.randomBytes(32).toString("base64url");
  const authorizeUrl = new URL(FEISHU_AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: FEISHU_REDIRECT_URI,
    scope: FEISHU_OAUTH_SCOPE,
    state,
    prompt: "consent",
  }).toString();

  return new Promise((resolve, reject) => {
    let completed = false;
    let timeout;
    const server = http.createServer(async (request, response) => {
      const requestUrl = new URL(request.url || "/", redirectUrl.origin);
      if (requestUrl.pathname !== redirectUrl.pathname) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not Found");
        return;
      }
      if (completed) {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(oauthResultPage(
          true,
          "授权请求正在处理，请不要刷新页面，稍后返回墨水屏桌面查看结果。",
        ));
        return;
      }
      if (requestUrl.searchParams.get("state") !== state) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(oauthResultPage(false, "登录状态校验失败，请返回应用重新发起登录。"));
        return;
      }
      completed = true;
      const oauthError = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      if (oauthError || !code) {
        const error = new Error(oauthError === "access_denied" ? "你取消了飞书授权" : "飞书未返回授权码");
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(oauthResultPage(false, error.message));
        finish(error);
        return;
      }
      try {
        const payload = await requestFeishuOAuthToken({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: FEISHU_REDIRECT_URI,
        });
        if (!payload.refresh_token) {
          throw new Error("未获得 refresh_token，请在飞书后台开通 offline_access 后重新授权");
        }
        const settings = storeFeishuOAuthTokens(payload);
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(oauthResultPage(true, "授权凭证已安全保存，日历会在过期前自动续期。"));
        finish(null, feishuAuthStatus(settings));
      } catch (error) {
        response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        response.end(oauthResultPage(false, error.message));
        finish(error);
      }
    });

    const finish = (error, value) => {
      if (timeout) clearTimeout(timeout);
      if (feishuOAuthCancel === finish) feishuOAuthCancel = null;
      server.close();
      if (error) reject(error);
      else resolve(value);
    };
    feishuOAuthCancel = finish;
    server.once("error", (error) => finish(
      new Error(error.code === "EADDRINUSE"
        ? `本机回调端口 ${redirectUrl.port} 已被占用，请关闭占用程序后重试`
        : `无法启动飞书登录回调：${error.message}`),
    ));
    server.listen(Number(redirectUrl.port), redirectUrl.hostname, async () => {
      timeout = setTimeout(() => {
        finish(new Error("飞书登录等待超时，请重新点击登录"));
      }, 5 * 60 * 1000);
      try {
        await shell.openExternal(authorizeUrl.toString());
      } catch (error) {
        finish(new Error(`无法打开飞书授权页面：${error.message}`));
      }
    });
  });
}

async function fetchCodexQuota() {
  const authPath = path.join(os.homedir(), ".codex", "auth.json");
  let auth;
  try {
    auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("未找到本机 Codex 登录，请先在这台电脑登录 Codex");
    }
    throw new Error("无法读取本机 Codex 登录状态");
  }
  if (auth.auth_mode && auth.auth_mode !== "chatgpt") {
    throw new Error("当前 Codex 使用 API Key 登录，无法读取 ChatGPT 订阅周限额");
  }
  const accessToken = auth.tokens?.access_token;
  if (!accessToken) throw new Error("Codex 登录凭证中没有 ChatGPT OAuth 会话");

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": "codex-cli",
  };
  if (auth.tokens?.account_id) headers["ChatGPT-Account-Id"] = auth.tokens.account_id;
  const response = await net.fetch("https://chatgpt.com/backend-api/wham/usage", { headers });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Codex 登录已过期，请重新登录 Codex");
  }
  if (!response.ok) throw new Error(`Codex 配额读取失败（HTTP ${response.status}）`);

  const payload = await response.json();
  const rateLimit = payload.rate_limit || {};
  const windows = [rateLimit.primary_window, rateLimit.secondary_window].filter(Boolean);
  const weekly = windows.find((item) => Number(item.limit_window_seconds) === 604800)
    || rateLimit.secondary_window;
  if (!weekly || !Number.isFinite(Number(weekly.used_percent))) {
    throw new Error("Codex 返回的数据中没有 7 天配额窗口");
  }
  return {
    remaining: Math.max(0, Math.min(100, 100 - Number(weekly.used_percent))),
    resetAt: weekly.reset_at ? Number(weekly.reset_at) * 1000 : 0,
    source: "local-codex-oauth",
  };
}

ipcMain.handle("settings:get", () => readSettings());
ipcMain.handle("settings:set", (_event, next) => writeSettings(next));
ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("feishu:oauth:status", () => feishuAuthStatus());
ipcMain.handle("feishu:oauth:start", (_event, options) => startFeishuOAuth(options || {}));
ipcMain.handle("feishu:oauth:logout", () => {
  feishuOAuthCancel?.(new Error("飞书登录已取消"));
  const settings = writeSettings({
    feishuOAuthAccessToken: "",
    feishuRefreshToken: "",
    feishuTokenExpiresAt: 0,
    feishuRefreshTokenExpiresAt: 0,
    feishuOAuthScope: "",
  });
  return feishuAuthStatus(settings);
});
ipcMain.handle("bluetooth:select", (_event, deviceId) => {
  bluetoothSelection?.(deviceId || "");
  bluetoothSelection = null;
});
ipcMain.handle("bluetooth:cancel", () => {
  bluetoothSelection?.("");
  bluetoothSelection = null;
});
ipcMain.handle("external:open", (_event, url) => {
  const target = new URL(String(url));
  if (target.protocol !== "https:") throw new Error("只允许打开 HTTPS 链接");
  return shell.openExternal(target.toString());
});
ipcMain.handle("codex:quota", () => fetchCodexQuota());
ipcMain.handle("preview:save", async (_event, dataUrl) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出墨水屏预览",
    defaultPath: `墨水屏预览-${new Date().toISOString().slice(0, 10)}.png`,
    filters: [{ name: "PNG 图片", extensions: ["png"] }],
  });
  if (result.canceled || !result.filePath) return "";
  const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(result.filePath, Buffer.from(base64, "base64"));
  return result.filePath;
});
ipcMain.handle("native-ble:send", async (event, { black, red, prefix }) => {
  if (nativeBleSending) throw new Error("Windows 原生 BLE 正在传输");
  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, "native", "NativeBleHelper.exe")
    : path.join(__dirname, "..", "native", "bin", "NativeBleHelper.exe");
  if (!fs.existsSync(helperPath)) throw new Error("未找到 Windows 原生 BLE 辅助程序");

  nativeBleSending = true;
  const tempRoot = path.resolve(os.tmpdir());
  let tempDir = "";
  try {
    tempDir = fs.mkdtempSync(path.join(tempRoot, "epaper-native-ble-"));
    const blackPath = path.join(tempDir, "black.bin");
    const redPath = path.join(tempDir, "red.bin");
    fs.writeFileSync(blackPath, Buffer.from(black));
    fs.writeFileSync(redPath, Buffer.from(red));
    return await new Promise((resolve, reject) => {
      const child = spawn(helperPath, [
        "send",
        "--prefix",
        String(prefix || "NRF_EPD"),
        "--black",
        blackPath,
        "--red",
        redPath,
      ], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdoutBuffer = "";
      let stderr = "";
      let finalPayload;

      const handleLine = (line) => {
        if (!line.trim()) return;
        try {
          const payload = JSON.parse(line);
          finalPayload = payload;
          if (!event.sender.isDestroyed()) event.sender.send("native-ble:progress", payload);
        } catch {
          stderr += `${line}\n`;
        }
      };

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop();
        lines.forEach(handleLine);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        handleLine(stdoutBuffer);
        if (code === 0) {
          resolve(finalPayload || { type: "complete", percent: 100, message: "原生 BLE 传输完成" });
        } else {
          reject(new Error(finalPayload?.message || stderr.trim() || `原生 BLE 进程退出（${code}）`));
        }
      });
    });
  } finally {
    const resolved = tempDir ? path.resolve(tempDir) : "";
    if (resolved.startsWith(`${tempRoot}${path.sep}`)
      && path.basename(resolved).startsWith("epaper-native-ble-")) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
    nativeBleSending = false;
  }
});
ipcMain.handle("feishu:events", async (_event, { token, calendarId, from, to }) => {
  const accessToken = String(token || "").trim() || await getValidFeishuAccessToken();
  const manualCalendarId = String(calendarId || "").trim();
  const calendarResult = await feishuRequest(
    "https://open.feishu.cn/open-apis/calendar/v4/calendars?page_size=1000",
    accessToken,
  );
  const calendars = calendarResult.data?.calendar_list
    || calendarResult.data?.items
    || calendarResult.data?.calendars
    || [];
  const calendarName = (calendar) => calendar.summary || calendar.alias || calendar.name || "未命名日历";
  const calendarKey = (calendar) => calendar.calendar_id || calendar.calendar?.calendar_id || "";
  const isScheduleCalendar = (calendar) => /排班|班表|值班|轮班/.test(calendarName(calendar));

  let targets;
  if (manualCalendarId) {
    const matched = calendars.find((calendar) => calendarKey(calendar) === manualCalendarId);
    targets = [matched || { calendar_id: manualCalendarId, summary: "指定日历" }];
  } else {
    let primary = calendars.find((calendar) => calendar.type === "primary");
    if (!primary) {
      const primaryResult = await feishuRequest(
        "https://open.feishu.cn/open-apis/calendar/v4/calendars/primary",
        accessToken,
        { method: "POST" },
      );
      primary = primaryResult.data?.calendars?.[0]?.calendar
        || primaryResult.data?.calendars?.[0];
    }
    targets = [primary, ...calendars.filter(isScheduleCalendar)].filter(Boolean);
  }
  targets = targets.filter((calendar, index, list) => {
    const id = calendarKey(calendar);
    return id && list.findIndex((item) => calendarKey(item) === id) === index;
  });
  if (!targets.length) throw new Error("未找到可读取的飞书日历");

  async function getCalendarEvents(calendar) {
    const id = calendarKey(calendar);
    const items = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({
        start_time: String(from),
        end_time: String(to),
        page_size: "50",
      });
      if (pageToken) query.set("page_token", pageToken);
      const result = await feishuRequest(
        `https://open.feishu.cn/open-apis/calendar/v4/calendars/${encodeURIComponent(id)}/events?${query}`,
        accessToken,
      );
      items.push(...(result.data?.items || []));
      pageToken = result.data?.has_more ? String(result.data?.page_token || "") : "";
    } while (pageToken);
    return items.map((event) => ({ event, calendar, id }));
  }

  const items = (await Promise.all(targets.map(getCalendarEvents))).flat();
  const eventTime = (value) => {
    if (value?.timestamp) return Number(value.timestamp) * 1000;
    if (value?.date) {
      const date = new Date(`${value.date}T00:00:00`);
      return date.getTime();
    }
    return 0;
  };
  return {
    calendarId: manualCalendarId,
    resolvedCalendarId: calendarKey(targets[0]),
    calendarNames: targets.map(calendarName),
    scheduleCalendarNames: targets.filter(isScheduleCalendar).map(calendarName),
    events: items.map(({ event, calendar, id }) => {
      const start = eventTime(event.start_time);
      const rawEnd = eventTime(event.end_time);
      return {
        id: event.event_id,
        title: event.summary || "未命名日程",
        description: event.description || "",
        start,
        end: rawEnd > start ? rawEnd : start + 24 * 60 * 60 * 1000,
        allDay: Boolean(event.start_time?.date),
        status: event.status,
        calendarId: id,
        calendarName: calendarName(calendar),
        isSchedule: isScheduleCalendar(calendar),
      };
    }),
  };
});

ipcMain.handle("feishu:tasks", async (_event, { token, taskListGuid, taskListName }) => {
  const accessToken = String(token || "").trim() || await getValidFeishuAccessToken();
  const requestedName = String(taskListName || "").trim() || "产品建模需求排期任务清单";
  let targetGuid = String(taskListGuid || "").trim();
  let targetList;

  if (!targetGuid) {
    const lists = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({ page_size: "100" });
      if (pageToken) query.set("page_token", pageToken);
      const result = await feishuRequest(
        `https://open.feishu.cn/open-apis/task/v2/tasklists?${query}`,
        accessToken,
      );
      lists.push(...(result.data?.items || []));
      pageToken = result.data?.has_more ? String(result.data?.page_token || "") : "";
    } while (pageToken);
    targetList = lists.find((item) => item.name === requestedName)
      || lists.find((item) => String(item.name || "").includes(requestedName));
    targetGuid = targetList?.guid || "";
  }
  if (!targetGuid) throw new Error(`未找到飞书任务清单“${requestedName}”`);

  const tasks = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (pageToken) query.set("page_token", pageToken);
    const result = await feishuRequest(
      `https://open.feishu.cn/open-apis/task/v2/tasklists/${encodeURIComponent(targetGuid)}/tasks?${query}`,
      accessToken,
    );
    tasks.push(...(result.data?.items || []));
    pageToken = result.data?.has_more ? String(result.data?.page_token || "") : "";
  } while (pageToken);

  return {
    taskListGuid: targetGuid,
    taskListName: targetList?.name || requestedName,
    taskListUrl: targetList?.url || "",
    tasks: tasks.map((task) => ({
      guid: task.guid,
      summary: task.summary || "未命名任务",
      completed: String(task.completed_at || "0") !== "0",
      completedAt: task.completed_at || "0",
      createdAt: Number(task.created_at || 0),
      due: task.due || null,
    })).sort((a, b) => b.createdAt - a.createdAt),
  };
});

app.commandLine.appendSwitch("enable-features", "WebBluetooth");
app.commandLine.appendSwitch("disable-gpu");
app.disableHardwareAcceleration();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.whenReady().then(() => {
    configureBluetooth();
    createWindow();
    createTray();
    app.on("activate", showMainWindow);
  });
}

app.on("window-all-closed", () => {
  // The tray owns the app lifetime. Use its "彻底退出" item to end the process.
});
app.on("before-quit", () => {
  isQuitting = true;
  feishuOAuthCancel?.(new Error("应用正在退出"));
});
