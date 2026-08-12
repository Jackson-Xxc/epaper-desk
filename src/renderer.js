const SERVICE_UUID = "62750001-d828-918d-fb46-b6c11c675aec";
const CHARACTERISTIC_UUID = "62750002-d828-918d-fb46-b6c11c675aec";
const VERSION_UUID = "62750003-d828-918d-fb46-b6c11c675aec";
const COMMAND = {
  SET_PINS: 0x00,
  INIT: 0x01,
  CLEAR: 0x02,
  REFRESH: 0x05,
  SLEEP: 0x06,
  SET_TIME: 0x20,
  WRITE_IMAGE: 0x30,
  SET_CONFIG: 0x90,
  SYS_RESET: 0x91,
  SYS_SLEEP: 0x92,
};
const LED_CONFIG = {
  on: [0x90, 0x14, 0x13, 0x06, 0x05, 0x04, 0x03, 0x02, 0x02, 0xff, 0x12, 0x07, 0x01, 0x00],
  off: [0x90, 0x14, 0x13, 0x06, 0x05, 0x04, 0x03, 0x02, 0x02, 0xff, 0xff, 0x07, 0x01, 0x00],
};
const TRANSFER_PRESETS = {
  auto: {
    label: "自动",
    dataBytes: 160,
    intervalMs: 25,
    confirmEvery: 6,
    confirmPauseMs: 150,
    hint: "Windows 受控窗口：连续 6 包后确认，防止数据塞满蓝牙队列。",
  },
  fast: {
    label: "快速",
    dataBytes: 198,
    intervalMs: 8,
    confirmEvery: 20,
    confirmPauseMs: 60,
    hint: "198 字节分包，连续 20 包后确认；只适合稳定的蓝牙环境。",
  },
  balanced: {
    label: "均衡",
    dataBytes: 160,
    intervalMs: 25,
    confirmEvery: 6,
    confirmPauseMs: 150,
    hint: "160 字节分包，连续 6 包后确认；默认推荐。",
  },
  stable: {
    label: "稳定",
    dataBytes: 120,
    intervalMs: 40,
    confirmEvery: 3,
    confirmPauseMs: 200,
    hint: "120 字节分包，连续 3 包后确认；用于偶发断链。",
  },
  extreme: {
    label: "极稳",
    dataBytes: 80,
    intervalMs: 70,
    confirmEvery: 1,
    confirmPauseMs: 250,
    hint: "80 字节分包，无响应与确认写入交替；速度最慢、队列最短。",
  },
};
const AUTO_TRANSFER_SEQUENCE = ["balanced", "stable", "extreme", "extreme"];

// 国务院办公厅国办发明电〔2025〕7号公布的 2026 年放假调休安排。
// Future years stay deliberately absent until the official notice is published.
const CHINA_HOLIDAYS = [
  { name: "元旦", start: "2026-01-01", end: "2026-01-03", days: 3 },
  { name: "春节", start: "2026-02-15", end: "2026-02-23", days: 9 },
  { name: "清明", start: "2026-04-04", end: "2026-04-06", days: 3 },
  { name: "劳动节", start: "2026-05-01", end: "2026-05-05", days: 5 },
  { name: "端午", start: "2026-06-19", end: "2026-06-21", days: 3 },
  { name: "中秋", start: "2026-09-25", end: "2026-09-27", days: 3 },
  { name: "国庆", start: "2026-10-01", end: "2026-10-07", days: 7 },
];
const CHINA_MAKEUP_WORK_DAYS = new Set([
  "2026-01-04",
  "2026-02-14",
  "2026-02-28",
  "2026-05-09",
  "2026-09-20",
  "2026-10-10",
]);

const state = {
  settings: null,
  events: [],
  tasks: [],
  taskListName: "",
  device: null,
  characteristic: null,
  bluetoothDevices: [],
  sending: false,
  lastImageHash: "",
  autoTimer: null,
  photoImage: null,
  mtu: 244,
  connecting: false,
};

const $ = (selector) => document.querySelector(selector);
const canvas = $("#epaperCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

function sizePreview() {
  const shell = $(".canvas-shell");
  const maxWidth = Math.max(240, shell.clientWidth - 52);
  const maxHeight = Math.max(180, shell.clientHeight - 52);
  const scale = Math.min(maxWidth / 400, maxHeight / 300);
  canvas.style.width = `${Math.floor(400 * scale)}px`;
  canvas.style.height = `${Math.floor(300 * scale)}px`;
}

function log(message, type = "") {
  const row = document.createElement("div");
  row.className = type;
  row.textContent = `${new Date().toLocaleTimeString("zh-CN", { hour12: false })}  ${message}`;
  $("#log").append(row);
  $("#log").scrollTop = $("#log").scrollHeight;
}

function setConnected(connected, name = "") {
  $("#connectionPill").classList.toggle("online", connected);
  $("#connectionPill span").textContent = connected ? `${name || "墨水屏"} 已连接` : "设备未连接";
  ["#sendImage", "#clearScreen", "#sleepDevice", "#disconnectButton", "#syncTime", "#toggleLed"].forEach(
    (id) => ($(id).disabled = !connected),
  );
  $("#connectButton").disabled = connected;
  document.querySelectorAll(".debug-command").forEach((button) => {
    button.disabled = !connected;
  });
  $("#debugDeviceName").textContent = connected ? (name || "NRF_EPD") : "未连接";
  if (!connected) $("#debugFirmware").textContent = "—";
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll(".tab-page").forEach((page) => page.classList.toggle("active", page.dataset.page === name));
}

const displayModeLabels = {
  agenda: "今日日程",
  tasks: "任务清单",
  countdown: "休假倒数",
  note: "自定义便签",
  photo: "图片展示",
};

function syncDisplayModeControl() {
  const value = $("#displayMode").value;
  $("#displayModeButton span").textContent = displayModeLabels[value] || displayModeLabels.agenda;
  document.querySelectorAll("#displayModeMenu [data-value]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.value === value);
  });
}

function closeDisplayModeMenu() {
  $("#displayModeMenu").hidden = true;
  $("#displayModeButton").setAttribute("aria-expanded", "false");
}

function getTransferPreset(key = $("#transferPreset")?.value) {
  return TRANSFER_PRESETS[key] || TRANSFER_PRESETS.auto;
}

function updateTransferPresetHint() {
  const preset = getTransferPreset();
  $("#transferPresetHint").textContent = preset.hint;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fitText(text, max = 19) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function localDateKey(value) {
  const date = startOfLocalDay(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function localDateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function daysUntil(value, from = new Date()) {
  return Math.max(0, Math.round(
    (startOfLocalDay(value).getTime() - startOfLocalDay(from).getTime()) / 86400000,
  ));
}

function holidayForDate(value) {
  const key = localDateKey(value);
  return CHINA_HOLIDAYS.find((holiday) => key >= holiday.start && key <= holiday.end) || null;
}

function nextOfficialHoliday(from = new Date(), minimumDays = 1) {
  const today = startOfLocalDay(from);
  return CHINA_HOLIDAYS
    .filter((holiday) => holiday.days >= minimumDays)
    .map((holiday) => ({
      ...holiday,
      startDate: localDateFromKey(holiday.start),
      endDate: localDateFromKey(holiday.end),
    }))
    .find((holiday) => holiday.endDate >= today) || null;
}

function nextRestDay(from = new Date()) {
  const today = startOfLocalDay(from);
  for (let offset = 0; offset <= 60; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    const status = dayStatus(date);
    if (status.rest) return { date, days: offset, status };
  }
  return null;
}

function formatMonthDay(value) {
  const date = new Date(value);
  return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function formatQuotaReset(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "未获取";
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return `${month}.${day} ${hour}:${minute}`;
}

function dayStatus(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const dayEvents = state.events.filter(
    (event) => event.start < end.getTime() && event.end > start.getTime(),
  );
  const eventText = (event) => `${event.title || ""} ${event.description || ""}`;
  const restPattern = /休息|休假|放假|假期|节假日|请假|调休|休$/;
  const scheduleEvents = dayEvents.filter((event) => event.isSchedule);
  const scheduleRest = scheduleEvents.some((event) => restPattern.test(eventText(event)));
  const scheduleWork = scheduleEvents.some((event) => !restPattern.test(eventText(event)));
  if (scheduleRest) return { label: "休", rest: true, source: "飞书排班" };
  if (scheduleWork) return { label: "班", rest: false, source: "飞书排班" };
  const titles = dayEvents.map(eventText);
  const explicitWork = titles.some((title) => /(补班|调休上班|上班|工作日|值班|白班|夜班|早班|晚班|T\d+)/i.test(title));
  const explicitRest = titles.some((title) => restPattern.test(title));
  if (explicitWork) return { label: "班", rest: false, source: "飞书" };
  if (explicitRest) return { label: "休", rest: true, source: "飞书" };
  const dateKey = localDateKey(start);
  if (CHINA_MAKEUP_WORK_DAYS.has(dateKey)) {
    return { label: "班", rest: false, source: "法定调休" };
  }
  const holiday = holidayForDate(start);
  if (holiday) {
    return { label: "休", rest: true, source: holiday.name, holiday };
  }
  const rest = start.getDay() === 0 || start.getDay() === 6;
  return { label: rest ? "休" : "班", rest, source: "星期" };
}

function roundRect(x, y, width, height, radius, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function fillTextSpaced(text, x, y, spacing = 1) {
  let cursor = x;
  for (const character of text) {
    ctx.fillText(character, cursor, y);
    cursor += ctx.measureText(character).width + spacing;
  }
}

function fillTextVisualBottom(text, x, bottomY) {
  const previousBaseline = ctx.textBaseline;
  ctx.textBaseline = "alphabetic";
  const metrics = ctx.measureText(text);
  const descent = Number.isFinite(metrics.actualBoundingBoxDescent)
    ? metrics.actualBoundingBoxDescent
    : 0;
  ctx.fillText(text, x, bottomY - descent);
  ctx.textBaseline = previousBaseline;
}

function fillTextVisualBottomRight(text, rightX, bottomY) {
  fillTextVisualBottom(text, rightX - ctx.measureText(text).width, bottomY);
}

function loadPhotoDataUrl(dataUrl) {
  state.photoImage = null;
  if (!dataUrl) {
    renderPreview();
    return;
  }
  const image = new Image();
  image.onload = () => {
    state.photoImage = image;
    $("#photoState").textContent = `${image.naturalWidth} × ${image.naturalHeight}，已转换为三色预览`;
    renderPreview();
  };
  image.onerror = () => {
    $("#photoState").textContent = "图片无法读取，请重新选择";
    renderPreview();
  };
  image.src = dataUrl;
}

function drawPhotoRegion(x, y, width, height) {
  if (!state.photoImage) {
    ctx.strokeStyle = "#151515";
    ctx.setLineDash([4, 4]);
    roundRect(x + 2, y + 2, width - 4, height - 4, 5, false, true);
    ctx.setLineDash([]);
    ctx.fillStyle = "#151515";
    ctx.font = "700 16px 'Microsoft YaHei UI'";
    ctx.textAlign = "center";
    ctx.fillText("请选择一张图片", x + width / 2, y + height / 2);
    ctx.textAlign = "left";
    return;
  }

  const source = state.photoImage;
  const zoom = Number($("#photoZoom").value) / 100;
  const scale = Math.max(width / source.naturalWidth, height / source.naturalHeight) * zoom;
  const drawWidth = source.naturalWidth * scale;
  const drawHeight = source.naturalHeight * scale;
  const horizontal = (Number($("#photoX").value) + 100) / 200;
  const vertical = (Number($("#photoY").value) + 100) / 200;
  const drawX = (width - drawWidth) * horizontal;
  const drawY = (height - drawHeight) * vertical;

  const photoCanvas = document.createElement("canvas");
  photoCanvas.width = width;
  photoCanvas.height = height;
  const photoContext = photoCanvas.getContext("2d", { willReadFrequently: true });
  photoContext.fillStyle = "#fff";
  photoContext.fillRect(0, 0, width, height);
  photoContext.drawImage(source, drawX, drawY, drawWidth, drawHeight);

  const imageData = photoContext.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const bayer = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  for (let pixel = 0; pixel < pixels.length; pixel += 4) {
    const index = pixel / 4;
    const px = index % width;
    const py = Math.floor(index / width);
    const red = pixels[pixel];
    const green = pixels[pixel + 1];
    const blue = pixels[pixel + 2];
    const isRed = red > 105 && red > green * 1.3 && red > blue * 1.2;
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
    const threshold = 98 + bayer[py % 4][px % 4] * 7;
    const color = isRed ? [181, 38, 43] : luminance < threshold ? [21, 21, 21] : [255, 255, 255];
    pixels[pixel] = color[0];
    pixels[pixel + 1] = color[1];
    pixels[pixel + 2] = color[2];
    pixels[pixel + 3] = 255;
  }
  photoContext.putImageData(imageData, 0, 0);
  ctx.drawImage(photoCanvas, x, y);
}

function drawCountdownRegion(now) {
  const rest = nextRestDay(now);
  const holiday = nextOfficialHoliday(now);
  const longHoliday = nextOfficialHoliday(now, 5);
  const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  // The rest countdown deliberately breaks the two-column grid: one oversized
  // number anchors the left, while compact "tickets" carry official dates.
  ctx.fillStyle = "#b5262b";
  ctx.fillRect(18, 134, 6, 87);

  ctx.textBaseline = "top";

  const restDays = rest?.days ?? "--";
  ctx.fillStyle = "#b5262b";
  ctx.font = "800 74px 'Bahnschrift SemiCondensed', 'Arial Narrow', sans-serif";
  ctx.fillText(String(restDays), 30, 127);
  const numberWidth = ctx.measureText(String(restDays)).width;
  ctx.fillStyle = "#151515";
  ctx.font = "800 19px 'Microsoft YaHei UI'";
  ctx.fillText(rest?.days === 0 ? "今天" : "天", 36 + numberWidth, 166);
  ctx.font = "800 14px 'Microsoft YaHei UI'";
  const restLabel = rest
    ? `${weekdayNames[rest.date.getDay()]} ${formatMonthDay(rest.date)}`
    : "等待排班";
  ctx.fillText(restLabel, 34, 201);

  const ticketX = 145;
  const ticketWidth = 237;
  ctx.strokeStyle = "#151515";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(ticketX, 106, ticketWidth, 55);
  ctx.setLineDash([]);
  ctx.fillStyle = "#b5262b";
  ctx.fillRect(ticketX + 8, 115, 6, 36);
  ctx.fillStyle = "#151515";
  ctx.font = "800 12px 'Microsoft YaHei UI'";
  ctx.fillText("法定假日", ticketX + 22, 115);
  ctx.font = "800 20px 'Microsoft YaHei UI'";
  ctx.fillText(holiday?.name || "待公布", ticketX + 22, 134);
  ctx.font = "800 13px 'Bahnschrift SemiCondensed', 'Microsoft YaHei UI', sans-serif";
  const holidayMeta = holiday
    ? `${formatMonthDay(holiday.startDate)} · 放${holiday.days}天`
    : "下一年度安排";
  ctx.fillText(holidayMeta, ticketX + 82, 139);
  ctx.textAlign = "right";
  ctx.fillStyle = "#b5262b";
  ctx.font = "800 25px 'Bahnschrift SemiCondensed', 'Microsoft YaHei UI', sans-serif";
  ctx.fillText(holiday ? `${daysUntil(holiday.startDate, now)}天` : "--", 374, 129);
  ctx.textAlign = "left";

  ctx.fillStyle = "#b5262b";
  ctx.fillRect(ticketX, 166, ticketWidth, 55);
  ctx.fillStyle = "#fff";
  ctx.font = "800 12px 'Microsoft YaHei UI'";
  ctx.fillText("下一次长假", ticketX + 11, 175);
  ctx.font = "800 20px 'Microsoft YaHei UI'";
  ctx.fillText(longHoliday?.name || "待公布", ticketX + 11, 195);
  ctx.font = "800 13px 'Bahnschrift SemiCondensed', 'Microsoft YaHei UI', sans-serif";
  const longMeta = longHoliday
    ? `${formatMonthDay(longHoliday.startDate)}—${formatMonthDay(longHoliday.endDate)} · ${longHoliday.days}天`
    : "等待官方安排";
  ctx.fillText(longMeta, ticketX + 69, 201);
  ctx.textAlign = "right";
  ctx.fillStyle = "#fff";
  ctx.font = "800 25px 'Bahnschrift SemiCondensed', 'Microsoft YaHei UI', sans-serif";
  ctx.fillText(longHoliday ? `${daysUntil(longHoliday.startDate, now)}天` : "--", 374, 190);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
}

function renderPreview() {
  const now = new Date();
  const remaining = Number($("#codexRemaining").value);
  const quotaKnown = state.settings?.codexSource && state.settings.codexSource !== "unset";
  const resetAt = $("#codexResetAt").value ? new Date($("#codexResetAt").value) : null;
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const events = state.events
    .filter((event) => !event.isSchedule
      && event.status !== "cancelled"
      && event.end >= now.getTime()
      && event.start <= todayEnd.getTime())
    .sort((a, b) => a.start - b.start)
    .slice(0, 4);

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 400, 300);
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#151515";
  ctx.textBaseline = "top";
  ctx.font = "700 14px 'Bahnschrift SemiCondensed', 'Arial Narrow', sans-serif";
  ctx.fillText(`${now.getFullYear()} / ${String(now.getMonth() + 1).padStart(2, "0")}`, 18, 14);
  ctx.fillStyle = "#b5262b";
  ctx.font = "800 56px 'Bahnschrift SemiCondensed', 'Arial Narrow', sans-serif";
  fillTextVisualBottom(String(now.getDate()).padStart(2, "0"), 16, 80);
  ctx.fillStyle = "#151515";
  ctx.font = "800 13px 'Microsoft YaHei UI'";
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];
  const todayStatus = dayStatus(now);
  fillTextVisualBottom(`${weekday} ·`, 82, 80);
  ctx.fillStyle = todayStatus.rest ? "#b5262b" : "#151515";
  ctx.font = "800 15px 'Microsoft YaHei UI'";
  fillTextVisualBottomRight(todayStatus.label, 138, 80);
  ctx.textBaseline = "middle";

  ctx.strokeStyle = "#151515";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(154, 14);
  ctx.lineTo(154, 88);
  ctx.stroke();

  ctx.fillStyle = "#151515";
  ctx.textBaseline = "top";
  ctx.font = "800 13px 'Bahnschrift SemiCondensed', 'Arial Narrow', sans-serif";
  ctx.fillText("CODEX WEEKLY", 171, 14);
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#b5262b";
  ctx.font = "800 31px 'Bahnschrift SemiCondensed', 'Arial Narrow', sans-serif";
  ctx.fillText(quotaKnown ? `${remaining}%` : "--%", 170, 51);
  ctx.fillStyle = "#151515";
  ctx.textBaseline = "top";
  ctx.textAlign = "right";
  ctx.font = "800 11px 'Microsoft YaHei UI', sans-serif";
  ctx.fillText("下次重置", 376, 31);
  ctx.font = "800 14px 'Bahnschrift SemiCondensed', 'Microsoft YaHei UI', sans-serif";
  ctx.fillText(quotaKnown ? formatQuotaReset(resetAt) : "未获取", 376, 48);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "#151515";
  ctx.lineWidth = 2;
  ctx.strokeRect(170, 70, 209, 10);
  ctx.fillStyle = quotaKnown && remaining <= 20 ? "#b5262b" : "#151515";
  ctx.fillRect(172, 72, quotaKnown ? Math.round(205 * remaining / 100) : 0, 6);

  ctx.fillStyle = "#151515";
  ctx.fillRect(16, 100, 368, 2);
  const displayMode = $("#displayMode").value;
  const sectionTitles = {
    agenda: "今日日程",
    tasks: "任务清单",
    countdown: "休假倒数",
    note: "今日便签",
  };
  if (displayMode !== "photo") {
    ctx.font = "800 14px 'Microsoft YaHei UI'";
    fillTextSpaced(sectionTitles[displayMode] || sectionTitles.agenda, 18, 119, 0.8);
  }

  if (displayMode === "agenda") {
    ctx.fillStyle = "#b5262b";
    ctx.font = "800 14px 'Bahnschrift SemiCondensed', 'Microsoft YaHei UI', sans-serif";
    ctx.fillText(`${events.length} 项`, 344, 119);
    if (events.length === 0) {
      ctx.strokeStyle = "#151515";
      ctx.setLineDash([4, 4]);
      roundRect(18, 138, 364, 80, 5, false, true);
      ctx.setLineDash([]);
      ctx.fillStyle = "#151515";
      ctx.font = "700 18px 'Microsoft YaHei UI'";
      ctx.textAlign = "center";
      ctx.fillText("今天没有后续日程", 200, 173);
      ctx.font = "12px 'Microsoft YaHei UI'";
      ctx.fillText("给自己留一点空白", 200, 199);
      ctx.textAlign = "left";
    } else {
      events.forEach((event, index) => {
        const y = 144 + index * 25;
        ctx.fillStyle = index === 0 ? "#b5262b" : "#151515";
        ctx.fillRect(18, y - 7, 4, 16);
        ctx.font = "800 13px 'Bahnschrift SemiCondensed', 'Microsoft YaHei UI', sans-serif";
        ctx.fillText(event.allDay ? "全天" : formatTime(event.start), 31, y);
        ctx.fillStyle = "#151515";
        ctx.font = "700 13px 'Microsoft YaHei UI'";
        ctx.fillText(fitText(event.title, 22), 89, y);
        if (index < events.length - 1) {
          ctx.fillStyle = "#d8d8d8";
          ctx.fillRect(31, y + 12, 348, 1);
        }
      });
    }
  } else if (displayMode === "tasks") {
    const openTasks = state.tasks
      .filter((task) => !task.completed)
      .sort((a, b) => b.createdAt - a.createdAt);
    const visibleTasks = openTasks.slice(0, 8);
    ctx.fillStyle = "#b5262b";
    ctx.font = "800 12px 'Bahnschrift SemiCondensed', 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${visibleTasks.length}/${openTasks.length}`, 380, 119);
    ctx.textAlign = "left";
    if (visibleTasks.length === 0) {
      ctx.strokeStyle = "#151515";
      ctx.setLineDash([4, 4]);
      roundRect(18, 138, 364, 80, 5, false, true);
      ctx.setLineDash([]);
      ctx.fillStyle = "#151515";
      ctx.font = "700 17px 'Microsoft YaHei UI'";
      ctx.textAlign = "center";
      ctx.fillText("暂无未完成任务", 200, 178);
      ctx.textAlign = "left";
    } else {
      visibleTasks.forEach((task, index) => {
        const column = Math.floor(index / 4);
        const row = index % 4;
        const x = 18 + column * 184;
        const y = 143 + row * 20;
        ctx.strokeStyle = index === 0 ? "#b5262b" : "#151515";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y - 5, 9, 9);
        ctx.fillStyle = "#151515";
        ctx.font = "700 11px 'Microsoft YaHei UI'";
        ctx.fillText(fitText(task.summary, 13), x + 15, y);
      });
    }
  } else if (displayMode === "countdown") {
    drawCountdownRegion(now);
  } else if (displayMode === "note") {
    const note = ($("#customNote").value.trim() || "专注今天最重要的一件事").slice(0, 80);
    const lines = [];
    for (let offset = 0; offset < note.length; offset += 16) lines.push(note.slice(offset, offset + 16));
    ctx.fillStyle = "#b5262b";
    ctx.fillRect(18, 139, 5, 78);
    ctx.fillStyle = "#151515";
    ctx.font = "700 18px 'Microsoft YaHei UI'";
    lines.slice(0, 3).forEach((line, index) => {
      fillTextSpaced(line, 38, 154 + index * 29, 2);
    });
  } else if (displayMode === "photo") {
    drawPhotoRegion(16, 104, 368, 118);
  }

  ctx.fillStyle = "#151515";
  ctx.fillRect(16, 225, 368, 2);
  const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + index);
    const status = dayStatus(date);
    const centerX = 38 + index * 54;
    if (index === 0) {
      ctx.strokeStyle = "#151515";
      ctx.lineWidth = 1;
      ctx.strokeRect(centerX - 24, 231, 48, 57);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#151515";
    ctx.font = "800 14px 'Microsoft YaHei UI'";
    ctx.fillText(dayNames[date.getDay()], centerX, 242);
    ctx.font = "800 18px 'Bahnschrift SemiCondensed', 'Arial Narrow', sans-serif";
    ctx.fillText(String(date.getDate()), centerX, 261);
    ctx.fillStyle = status.rest ? "#b5262b" : "#151515";
    ctx.font = "800 14px 'Microsoft YaHei UI'";
    ctx.fillText(status.label, centerX, 281);
  }
  ctx.textAlign = "left";
}

async function saveSettings() {
  state.settings = await window.desktop.setSettings({
    feishuAppId: $("#feishuAppId").value.trim(),
    feishuAppSecret: $("#feishuAppSecret").value.trim(),
    feishuToken: $("#feishuToken").value.trim(),
    calendarId: $("#calendarId").value.trim(),
    taskListGuid: state.settings?.taskListGuid || "",
    taskListName: $("#taskListName").value.trim(),
    codexRemaining: Number($("#codexRemaining").value),
    codexResetAt: $("#codexResetAt").value,
    codexAuto: $("#codexAuto").checked,
    codexSource: state.settings?.codexSource || "unset",
    displayMode: $("#displayMode").value,
    customNote: $("#customNote").value.trim(),
    photoDataUrl: state.settings?.photoDataUrl || "",
    photoZoom: Number($("#photoZoom").value),
    photoX: Number($("#photoX").value),
    photoY: Number($("#photoY").value),
    refreshMinutes: Math.max(15, Number($("#refreshMinutes").value) || 60),
    onlyChanged: $("#onlyChanged").checked,
    autoDisconnect: $("#autoDisconnect").checked,
    transferPreset: TRANSFER_PRESETS[$("#transferPreset").value]
      ? $("#transferPreset").value
      : "auto",
    ledEnabled: state.settings?.ledEnabled === true,
  });
  scheduleAutoSync();
  log("设置已保存");
}

function applySettings(settings) {
  state.settings = settings;
  $("#feishuAppId").value = settings.feishuAppId || "";
  $("#feishuAppSecret").value = settings.feishuAppSecret || "";
  $("#feishuRedirectUri").value = settings.feishuRedirectUri
    || "http://127.0.0.1:37691/feishu/oauth/callback";
  $("#feishuToken").value = settings.feishuToken || "";
  $("#calendarId").value = settings.calendarId || "";
  $("#taskListName").value = settings.taskListName || "产品建模需求排期任务清单";
  $("#codexRemaining").value = settings.codexRemaining ?? 100;
  $("#quotaValue").textContent = settings.codexSource === "unset" ? "--%" : `${settings.codexRemaining ?? 100}%`;
  $("#codexResetAt").value = settings.codexResetAt || "";
  $("#codexAuto").checked = settings.codexAuto !== false;
  $("#displayMode").value = ["agenda", "tasks", "countdown", "note", "photo"].includes(settings.displayMode)
    ? settings.displayMode
    : "agenda";
  syncDisplayModeControl();
  $("#customNote").value = settings.customNote || "专注今天最重要的一件事";
  $("#customNoteLabel").style.display = $("#displayMode").value === "note" ? "block" : "none";
  $("#photoControls").hidden = $("#displayMode").value !== "photo";
  $("#countdownHint").hidden = $("#displayMode").value !== "countdown";
  $("#photoZoom").value = settings.photoZoom || 100;
  $("#photoZoomValue").textContent = `${settings.photoZoom || 100}%`;
  $("#photoX").value = settings.photoX || 0;
  $("#photoY").value = settings.photoY || 0;
  loadPhotoDataUrl(settings.photoDataUrl || "");
  $("#refreshMinutes").value = settings.refreshMinutes || 60;
  $("#onlyChanged").checked = settings.onlyChanged !== false;
  $("#autoDisconnect").checked = settings.autoDisconnect !== false;
  $("#transferPreset").value = TRANSFER_PRESETS[settings.transferPreset]
    ? settings.transferPreset
    : "auto";
  updateTransferPresetHint();
  $("#toggleLed").textContent = `指示灯：${settings.ledEnabled ? "开" : "关"}`;
}

function updateFeishuAuthUi(status) {
  const connected = status?.connected === true;
  $("#feishuLogin").textContent = connected ? "重新授权飞书" : "登录飞书";
  $("#feishuLogout").hidden = !connected;
  if (connected && $("#calendarState").textContent === "尚未读取日历") {
    $("#calendarState").textContent = status.refreshValid
      ? "飞书已登录，授权凭证会自动续期"
      : "飞书已登录";
  }
}

async function loadCalendar({ quiet = false } = {}) {
  const token = $("#feishuToken").value.trim();
  const now = new Date();
  const until = new Date(now);
  until.setDate(until.getDate() + 45);
  try {
    $("#calendarState").textContent = "正在读取飞书日历…";
    const result = await window.desktop.getFeishuEvents({
      token,
      calendarId: $("#calendarId").value.trim(),
      from: Math.floor(now.getTime() / 1000),
      to: Math.floor(until.getTime() / 1000),
    });
    state.events = result.events;
    let taskMessage = "";
    try {
      const taskResult = await window.desktop.getFeishuTasks({
        token,
        taskListGuid: state.settings?.taskListGuid || "",
        taskListName: $("#taskListName").value.trim(),
      });
      state.tasks = taskResult.tasks || [];
      state.taskListName = taskResult.taskListName;
      state.settings.taskListGuid = taskResult.taskListGuid;
      $("#taskListName").value = taskResult.taskListName;
      const openCount = state.tasks.filter((task) => !task.completed).length;
      taskMessage = `，${openCount} 项未完成任务`;
      log(`飞书任务读取成功，共 ${state.tasks.length} 项，未完成 ${openCount} 项`);
    } catch (taskError) {
      taskMessage = "；任务读取失败";
      log(`飞书任务读取失败：${taskError.message}`, "error");
    }
    const scheduleNames = result.scheduleCalendarNames || [];
    const scheduleMessage = scheduleNames.length ? `，排班：${scheduleNames.join("、")}` : "";
    $("#calendarState").textContent = `已读取 ${result.events.length} 项日程${scheduleMessage}${taskMessage}`;
    await saveSettings();
    renderPreview();
    log(`飞书日历读取成功，共 ${result.events.length} 项`);
    return true;
  } catch (error) {
    $("#calendarState").textContent = error.message;
    log(error.message, "error");
    return false;
  }
}

function localDateTimeValue(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

async function loadCodexQuota({ quiet = false } = {}) {
  try {
    $("#codexState").textContent = "正在读取本机 Codex 登录与周限额…";
    const result = await window.desktop.getCodexQuota();
    const remaining = Math.round(result.remaining * 10) / 10;
    state.settings.codexSource = "auto";
    $("#codexRemaining").value = String(Math.round(remaining));
    $("#quotaValue").textContent = `${remaining}%`;
    if (result.resetAt) $("#codexResetAt").value = localDateTimeValue(result.resetAt);
    $("#codexState").textContent = "已从本机 Codex 自动读取真实 7 天窗口";
    await saveSettings();
    renderPreview();
    log(`Codex 周限额读取成功，剩余 ${remaining}%`);
    return true;
  } catch (error) {
    const hasFallback = state.settings?.codexSource && state.settings.codexSource !== "unset";
    $("#codexState").textContent = hasFallback
      ? `${error.message}；显示上次成功或手动数据`
      : `${error.message}；当前不显示虚假百分比`;
    renderPreview();
    if (!quiet) log(error.message, "error");
    return false;
  }
}

function handleNotifications(event) {
  const value = event.target.value;
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  log(`设备通知：${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`);
  const message = new TextDecoder().decode(bytes).replace(/\0/g, "").trim();
  const mtuMatch = message.match(/^mtu=(\d+)$/i);
  if (mtuMatch) {
    state.mtu = Math.max(20, Math.min(512, Number(mtuMatch[1])));
    log(`设备协商 MTU：${state.mtu}，图像分包不会超过 ${state.mtu - 2} 字节`);
  }
}

function handleGattDisconnected(event) {
  if (event?.target !== state.device) return;
  state.characteristic = null;
  state.mtu = 244;
  setConnected(false);
  log("蓝牙连接已断开");
}

function bindDeviceDisconnectListener(device) {
  // requestDevice() may return the same BluetoothDevice object each time.
  // Replacing the named listener prevents one disconnect from being handled
  // repeatedly after several reconnects.
  device.removeEventListener("gattserverdisconnected", handleGattDisconnected);
  device.addEventListener("gattserverdisconnected", handleGattDisconnected);
}

async function enableNotifications(characteristic) {
  await characteristic.startNotifications();
  characteristic.removeEventListener("characteristicvaluechanged", handleNotifications);
  characteristic.addEventListener("characteristicvaluechanged", handleNotifications);
}

async function connectGattWithRetry(device, context = "连接") {
  const retryDelays = [0, 1800, 3500, 6000];
  let lastError;
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (retryDelays[attempt]) {
      log(`${context}将在 ${retryDelays[attempt] / 1000} 秒后进行第 ${attempt + 1} 次尝试`);
      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
    }
    try {
      if (device.gatt.connected) return device.gatt;
      return await device.gatt.connect();
    } catch (error) {
      lastError = error;
      log(`${context}第 ${attempt + 1}/${retryDelays.length} 次失败：${error.message}`, "error");
      if (device.gatt.connected) device.gatt.disconnect();
    }
  }
  throw lastError || new Error("蓝牙 GATT 连接失败");
}

async function connectDevice() {
  if (state.connecting || state.characteristic) {
    log(state.connecting ? "蓝牙正在连接，请稍候" : "设备已经连接");
    return;
  }
  if (window.isAndroidApp) {
    state.connecting = true;
    $("#connectButton").disabled = true;
    $("#connectButton").textContent = "正在扫描…";
    try {
      log("Android 原生 BLE：正在扫描 NRF_EPD");
      const result = await window.desktop.connectNativeBle();
      state.device = {
        name: result?.name || "NRF_EPD",
        gatt: {
          connected: true,
          disconnect: () => window.desktop.disconnectNativeBle(),
        },
      };
      state.characteristic = { nativeAndroid: true };
      state.mtu = Number(result?.firmwareMtu || result?.mtu || 244);
      $("#debugFirmware").textContent = result?.firmware || "EPD-nRF5";
      setConnected(true, state.device.name);
      log(`Android 原生 BLE 连接成功，图像数据 ${Math.max(18, state.mtu - 2)} 字节/包`);
    } catch (error) {
      state.device = null;
      state.characteristic = null;
      setConnected(false);
      log(`连接失败：${error.message}`, "error");
    } finally {
      state.connecting = false;
      $("#connectButton").textContent = "选择并连接设备";
      $("#connectButton").disabled = Boolean(state.characteristic);
    }
    return;
  }
  if (!navigator.bluetooth) {
    log("当前桌面运行时不支持蓝牙，请确认 Windows 蓝牙已开启", "error");
    return;
  }
  state.connecting = true;
  $("#connectButton").disabled = true;
  $("#connectButton").textContent = "正在连接…";
  try {
    $("#bluetoothDialog").showModal();
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "NRF_EPD" }],
      optionalServices: [SERVICE_UUID],
    });
    $("#bluetoothDialog").close();
    log(`正在连接 ${device.name || device.id}`);
    state.device = device;
    bindDeviceDisconnectListener(device);
    const server = await connectGattWithRetry(device, "设备连接");
    const service = await server.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    state.characteristic = characteristic;
    try {
      await enableNotifications(characteristic);
    } catch {
      log("设备不支持通知，仍可继续发送");
    }
    // Keep the connection handshake identical to the firmware's working web UI:
    // INIT after notifications makes the device report config and negotiated MTU.
    await write([COMMAND.INIT]);
    setConnected(true, device.name);
    try {
      const versionCharacteristic = await service.getCharacteristic(VERSION_UUID);
      const versionValue = await versionCharacteristic.readValue();
      const versionBytes = new Uint8Array(
        versionValue.buffer,
        versionValue.byteOffset,
        versionValue.byteLength,
      );
      const printable = new TextDecoder()
        .decode(versionBytes)
        .replace(/[^\x20-\x7e]/g, "")
        .trim();
      $("#debugFirmware").textContent = printable
        || Array.from(versionBytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
    } catch {
      $("#debugFirmware").textContent = "设备未提供";
    }
    log("蓝牙连接成功");
  } catch (error) {
    if (error.name === "NotFoundError" && $("#bluetoothDialog").open) {
      $("#bluetoothDevices").innerHTML =
        '<div class="scanning error">扫描已停止，请确认蓝牙已开启后取消并重试。</div>';
      log("蓝牙设备扫描被系统停止，未选择任何设备", "error");
    } else {
      if ($("#bluetoothDialog").open) $("#bluetoothDialog").close();
      if (error.name !== "NotFoundError") log(`连接失败：${error.message}`, "error");
    }
  } finally {
    state.connecting = false;
    $("#connectButton").textContent = "连接设备";
    $("#connectButton").disabled = Boolean(state.characteristic);
  }
}

async function reconnectKnownDevice() {
  if (state.characteristic) return true;
  if (window.isAndroidApp) {
    try {
      const result = await window.desktop.connectNativeBle();
      state.device = {
        name: result?.name || "NRF_EPD",
        gatt: {
          connected: true,
          disconnect: () => window.desktop.disconnectNativeBle(),
        },
      };
      state.characteristic = { nativeAndroid: true };
      state.mtu = Number(result?.firmwareMtu || result?.mtu || 244);
      setConnected(true, state.device.name);
      return true;
    } catch (error) {
      log(`自动更新：手机 BLE 重连失败，将在下个周期重试：${error.message}`, "error");
      return false;
    }
  }
  if (!state.device || state.connecting) return false;
  state.connecting = true;
  $("#connectButton").disabled = true;
  $("#connectButton").textContent = "后台重连中…";
  try {
    log(`自动更新：正在重新连接 ${state.device.name || state.device.id}`);
    const server = await connectGattWithRetry(state.device, "后台重连");
    const service = await server.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    state.characteristic = characteristic;
    try {
      await enableNotifications(characteristic);
    } catch {
      log("自动重连成功，但设备通知不可用");
    }
    setConnected(true, state.device.name);
    log("自动更新：蓝牙重连成功");
    return true;
  } catch (error) {
    state.characteristic = null;
    setConnected(false);
    log(`自动更新：本次重连失败，将在下个周期重试：${error.message}`, "error");
    return false;
  } finally {
    state.connecting = false;
    $("#connectButton").textContent = "连接设备";
    $("#connectButton").disabled = Boolean(state.characteristic);
  }
}

async function write(bytes, { withoutResponse = false } = {}) {
  if (!state.characteristic) throw new Error("设备尚未连接");
  const payload = Uint8Array.from(bytes);
  if (window.isAndroidApp) {
    await window.desktop.writeNativeBle({
      bytes: Array.from(payload),
      withoutResponse,
    });
    return;
  }
  if (withoutResponse && state.characteristic.properties.writeWithoutResponse) {
    await state.characteristic.writeValueWithoutResponse(payload);
  } else if (state.characteristic.properties.write) {
    await state.characteristic.writeValueWithResponse(payload);
  } else {
    await state.characteristic.writeValueWithoutResponse(payload);
  }
}

function canvasToPlanes() {
  const pixels = ctx.getImageData(0, 0, 400, 300).data;
  const black = new Uint8Array(15000).fill(0xff);
  const red = new Uint8Array(15000).fill(0xff);
  for (let y = 0; y < 300; y += 1) {
    for (let x = 0; x < 400; x += 1) {
      const pixel = (y * 400 + x) * 4;
      const r = pixels[pixel];
      const g = pixels[pixel + 1];
      const b = pixels[pixel + 2];
      const isRed = r > 105 && r - g > 24 && r - b > 20;
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      const isBlack = !isRed && luminance < 205;
      const byteIndex = Math.floor((y * 400 + x) / 8);
      const mask = 0x80 >> (x % 8);
      if (isBlack) black[byteIndex] &= ~mask;
      if (isRed) red[byteIndex] &= ~mask;
    }
  }
  return { black, red };
}

async function sendPlane(data, firstFlag, planeIndex, preset) {
  // The negotiated ATT MTU remains controlled by Windows and the peripheral.
  // This setting only reduces the application payload carried by each GATT
  // write, which lowers sustained write pressure on unstable adapters.
  const dataPerPacket = Math.max(18, Math.min(preset.dataBytes, state.mtu - 2));
  let packetIndex = 0;
  let noResponseRemaining = preset.confirmEvery;
  for (let offset = 0; offset < data.length; offset += dataPerPacket) {
    const first = offset === 0;
    const flag = first ? firstFlag : (firstFlag | 0xf0);
    const planeName = planeIndex === 0 ? "黑白层" : "红色层";
    const packet = [COMMAND.WRITE_IMAGE, flag, ...data.slice(offset, offset + dataPerPacket)];
    const withoutResponse = noResponseRemaining > 0;
    try {
      await write(packet, { withoutResponse });
    } catch (error) {
      // The stream protocol has no packet sequence number. Retrying one packet
      // could duplicate data if the peripheral accepted it but the response was
      // lost, so failures restart the complete image after reconnecting.
      throw new Error(`${planeName}第 ${packetIndex + 1} 包失败：${error.message}`);
    }
    if (withoutResponse) noResponseRemaining -= 1;
    else noResponseRemaining = preset.confirmEvery;
    packetIndex += 1;
    // Without-response writes only mean that Chromium accepted data into its
    // local queue. Move the visible progress after a confirmed packet so a
    // fast-growing percentage cannot be mistaken for device-side delivery.
    if (!withoutResponse) {
      const percent = Math.round(((planeIndex * data.length + offset) / (data.length * 2)) * 100);
      $("#sendImage").textContent = `传输中 ${percent}%`;
    }
    const pauseMs = withoutResponse ? preset.intervalMs : preset.confirmPauseMs;
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
}

async function transferImagePlanes(black, red, presetKey = $("#transferPreset")?.value) {
  if (window.isAndroidApp) {
    log(`Android 原生传输：${black.length + red.length} 字节，按 EPD-nRF5 官方分包协议发送`);
    await window.desktop.sendNativeBle({
      prefix: "NRF_EPD",
      black: Array.from(black),
      red: Array.from(red),
    });
    return;
  }
  await write([COMMAND.INIT]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const preset = getTransferPreset(presetKey === "auto" ? "balanced" : presetKey);
  const dataBytes = Math.max(18, Math.min(preset.dataBytes, state.mtu - 2));
  log(
    `Windows ${preset.label}传输：设备 MTU ${state.mtu}，`
      + `单包 ${dataBytes + 2} 字节（图像 ${dataBytes} 字节），`
      + `连续 ${preset.confirmEvery} 包无响应写入后确认 1 包，`
      + `包间隔 ${preset.intervalMs}ms，确认后等待 ${preset.confirmPauseMs}ms`,
  );
  await sendPlane(black, 0x0f, 0, preset);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await sendPlane(red, 0x00, 1, preset);
  $("#sendImage").textContent = "正在刷新屏幕…";
  await new Promise((resolve) => setTimeout(resolve, 500));
  await write([COMMAND.REFRESH]);
}

function planeHash(black, red) {
  let hash = 2166136261;
  for (const plane of [black, red]) {
    for (const byte of plane) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16);
}

async function sendImage({ onlyIfChanged = false } = {}) {
  if (state.sending) return;
  state.sending = true;
  $("#sendImage").disabled = true;
  try {
    renderPreview();
    const { black, red } = canvasToPlanes();
    const hash = planeHash(black, red);
    if (onlyIfChanged && $("#onlyChanged").checked && hash === state.lastImageHash) {
      log("内容没有变化，已跳过本次墨水屏刷新");
      return;
    }
    log("开始传输 400×300 三色图像");
    if (window.isAndroidApp) {
      await transferImagePlanes(black, red);
    } else {
      const selectedKey = $("#transferPreset").value;
      const attemptKeys = selectedKey === "auto"
        ? AUTO_TRANSFER_SEQUENCE
        : [selectedKey, selectedKey];
      let lastError;
      let completed = false;
      for (let attempt = 0; attempt < attemptKeys.length; attempt += 1) {
        const presetKey = attemptKeys[attempt];
        if (attempt > 0) {
          const preset = getTransferPreset(presetKey);
          log(
            `自动恢复：正在重新连接，随后使用${preset.label}档从头重传 `
              + `${attempt + 1}/${attemptKeys.length}`,
            "error",
          );
          state.characteristic = null;
          if (state.device?.gatt?.connected) state.device.gatt.disconnect();
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const reconnected = await reconnectKnownDevice();
          if (!reconnected) throw lastError;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        try {
          await transferImagePlanes(black, red, presetKey);
          completed = true;
          break;
        } catch (error) {
          lastError = error;
          log(
            `第 ${attempt + 1}/${attemptKeys.length} 次完整传输中断：${error.message}`,
            "error",
          );
        }
      }
      if (!completed) throw lastError || new Error("图像完整传输失败");
    }
    state.lastImageHash = hash;
    log("图像发送完成，墨水屏正在刷新");
    if ($("#autoDisconnect").checked) {
      log("省电模式：发送完成后自动断开蓝牙");
      setTimeout(() => {
        if (window.isAndroidApp) window.desktop.disconnectNativeBle();
        else if (state.device?.gatt?.connected) state.device.gatt.disconnect();
      }, 5000);
    }
  } catch (error) {
    log(`发送失败：${error.message}`, "error");
  } finally {
    state.sending = false;
    $("#sendImage").disabled = !state.characteristic;
    $("#sendImage").textContent = "发送到墨水屏";
  }
}

async function sendNativeImage() {
  if (state.sending) return;
  state.sending = true;
  const button = $("#nativeSendImage");
  button.disabled = true;
  $("#sendImage").disabled = true;
  try {
    if (state.device?.gatt?.connected) {
      log("原生 BLE：正在释放 Web Bluetooth 连接");
      state.device.gatt.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    renderPreview();
    const { black, red } = canvasToPlanes();
    log("原生 BLE：开始扫描并传输 400×300 三色图像");
    await window.desktop.sendNativeBle({
      prefix: "NRF_EPD",
      black: Array.from(black),
      red: Array.from(red),
    });
    state.lastImageHash = planeHash(black, red);
    log("原生 BLE：刷新命令已确认发送，请观察墨水屏");
  } catch (error) {
    log(`原生 BLE 发送失败：${error.message}`, "error");
  } finally {
    state.sending = false;
    button.disabled = false;
    button.textContent = "Windows 原生 BLE 发送（实验）";
    $("#sendImage").disabled = !state.characteristic;
  }
}

async function sendSimple(command, successMessage) {
  try {
    await write(command);
    log(successMessage);
  } catch (error) {
    log(error.message, "error");
  }
}

function scheduleAutoSync() {
  clearInterval(state.autoTimer);
  const minutes = Math.max(15, Number($("#refreshMinutes").value) || 60);
  $("#nextSync").textContent = `每 ${minutes} 分钟检查`;
  state.autoTimer = setInterval(async () => {
    await loadCalendar({ quiet: true });
    if ($("#codexAuto").checked) await loadCodexQuota({ quiet: true });
    renderPreview();
    const previewPlanes = canvasToPlanes();
    const previewHash = planeHash(previewPlanes.black, previewPlanes.red);
    if ($("#onlyChanged").checked && previewHash === state.lastImageHash) {
      log("自动更新：内容没有变化，无需连接蓝牙");
      return;
    }
    const wasDisconnected = !state.characteristic;
    const connected = state.characteristic ? true : await reconnectKnownDevice();
    if (connected) {
      await sendImage({ onlyIfChanged: true });
      if (wasDisconnected && $("#autoDisconnect").checked) {
        setTimeout(
          () => state.device?.gatt?.connected && state.device.gatt.disconnect(),
          3500,
        );
      }
    }
  }, minutes * 60 * 1000);
}

window.desktop.onBluetoothDevices((devices) => {
  state.bluetoothDevices = devices;
  const list = $("#bluetoothDevices");
  list.innerHTML = "";
  if (!devices.length) {
    list.innerHTML = '<div class="scanning">正在扫描附近设备…</div>';
    return;
  }
  devices.forEach((device) => {
    const button = document.createElement("button");
    const name = document.createElement("strong");
    const id = document.createElement("span");
    button.className = "device-item";
    name.textContent = device.name;
    id.textContent = device.id;
    button.append(name, id);
    button.addEventListener("click", async () => {
      document.querySelectorAll(".device-item").forEach((item) => {
        item.disabled = true;
      });
      button.querySelector("span").textContent = "正在连接…";
      await window.desktop.selectBluetoothDevice(device.id);
    });
    list.append(button);
  });
});

window.desktop.onNativeBleProgress((payload) => {
  if (payload.type === "progress" && payload.percent >= 0) {
    if (window.isAndroidApp) {
      $("#sendImage").textContent = `传输中 ${payload.percent}%`;
    } else {
      $("#nativeSendImage").textContent = `原生传输 ${payload.percent}%`;
    }
    return;
  }
  if (payload.message) {
    log(`原生 BLE：${payload.message}`, payload.type === "error" ? "error" : "");
  }
});

window.desktop.onNativeBleState?.((payload) => {
  if (!window.isAndroidApp) return;
  if (payload?.connected) {
    if (!state.characteristic) state.characteristic = { nativeAndroid: true };
    if (!state.device) {
      state.device = {
        name: payload.name || "NRF_EPD",
        gatt: {
          connected: true,
          disconnect: () => window.desktop.disconnectNativeBle(),
        },
      };
    }
    setConnected(true, payload.name || state.device.name);
  } else {
    state.characteristic = null;
    state.device = null;
    setConnected(false);
    if (payload?.message) log(payload.message);
  }
});

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
$("#connectButton").addEventListener("click", connectDevice);
$("#disconnectButton").addEventListener("click", () => {
  if (window.isAndroidApp) window.desktop.disconnectNativeBle();
  else state.device?.gatt?.disconnect();
});
$("#sendImage").addEventListener("click", sendImage);
$("#nativeSendImage").addEventListener("click", sendNativeImage);
$("#refreshPreview").addEventListener("click", renderPreview);
$("#clearScreen").addEventListener("click", () => sendSimple([COMMAND.CLEAR], "已发送清屏命令"));
$("#sleepDevice").addEventListener("click", () => sendSimple([COMMAND.SYS_SLEEP], "设备已进入休眠"));
$("#syncTime").addEventListener("click", () => {
  const now = Math.floor(Date.now() / 1000);
  sendSimple([COMMAND.SET_TIME, now & 255, (now >>> 8) & 255, (now >>> 16) & 255, (now >>> 24) & 255], "设备时间已同步");
});
$("#toggleLed").addEventListener("click", async () => {
  const enable = state.settings?.ledEnabled !== true;
  try {
    await write(enable ? LED_CONFIG.on : LED_CONFIG.off);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await write([COMMAND.SYS_RESET]);
    state.settings = await window.desktop.setSettings({ ledEnabled: enable });
    $("#toggleLed").textContent = `指示灯：${enable ? "开" : "关"}`;
    log(`指示灯已${enable ? "开启" : "关闭"}，设备正在重启`);
  } catch (error) {
    log(`指示灯设置失败：${error.message}`, "error");
  }
});
$("#debugInit").addEventListener("click", () => sendSimple([COMMAND.INIT], "已发送屏幕初始化命令"));
$("#debugRefresh").addEventListener("click", () => sendSimple([COMMAND.REFRESH], "已发送强制刷新命令"));
$("#debugPanelSleep").addEventListener("click", () => sendSimple([COMMAND.SLEEP], "屏幕面板已进入休眠"));
$("#debugReset").addEventListener("click", () => sendSimple([COMMAND.SYS_RESET], "设备正在重启"));
$("#sendRawHex").addEventListener("click", async () => {
  const compact = $("#rawHex").value
    .replace(/0x/gi, "")
    .replace(/[\s,;:-]/g, "");
  if (!compact || !/^[0-9a-f]+$/i.test(compact) || compact.length % 2 !== 0) {
    log("原始命令格式错误：请输入偶数位十六进制，例如 9100", "error");
    return;
  }
  if (compact.length > 1024) {
    log("单条原始命令不能超过 512 字节", "error");
    return;
  }
  const bytes = compact.match(/.{2}/g).map((part) => Number.parseInt(part, 16));
  try {
    await write(bytes);
    log(`已发送原始命令：${compact.toLowerCase()}`);
  } catch (error) {
    log(`原始命令发送失败：${error.message}`, "error");
  }
});
$("#exportPreview").addEventListener("click", async () => {
  const filePath = await window.desktop.savePreview(canvas.toDataURL("image/png"));
  if (filePath) log(`预览已导出：${filePath}`);
});
$("#clearLog").addEventListener("click", () => ($("#log").innerHTML = ""));
$("#closeBluetooth").addEventListener("click", () => {
  window.desktop.cancelBluetoothDevice();
  $("#bluetoothDialog").close();
});
$("#loadCalendar").addEventListener("click", () => loadCalendar());
$("#feishuLogin").addEventListener("click", async () => {
  const button = $("#feishuLogin");
  button.disabled = true;
  button.textContent = "等待浏览器授权…";
  $("#calendarState").textContent = "已打开飞书授权页面，请在浏览器中完成授权…";
  try {
    const status = await window.desktop.loginFeishu({
      appId: $("#feishuAppId").value.trim(),
      appSecret: $("#feishuAppSecret").value.trim(),
    });
    updateFeishuAuthUi(status);
    $("#calendarState").textContent = "飞书登录成功，正在读取日历…";
    log("飞书 OAuth 登录成功，授权凭证已加密保存");
    await loadCalendar();
  } catch (error) {
    $("#calendarState").textContent = error.message;
    log(`飞书登录失败：${error.message}`, "error");
  } finally {
    button.disabled = false;
    const status = await window.desktop.getFeishuAuthStatus();
    updateFeishuAuthUi(status);
  }
});
$("#feishuLogout").addEventListener("click", async () => {
  const status = await window.desktop.logoutFeishu();
  updateFeishuAuthUi(status);
  $("#calendarState").textContent = "已退出飞书登录；手动 Token 后备方式不受影响";
  log("已清除本机保存的飞书 OAuth 登录凭证");
});
$("#loadCodexQuota").addEventListener("click", () => loadCodexQuota());
$("#feishuHelp").addEventListener("click", () =>
  window.desktop.openExternal("https://open.feishu.cn/document/sso/web-application-end-user-consent/guide"),
);
$("#saveSettings").addEventListener("click", saveSettings);
$("#transferPreset").addEventListener("change", async () => {
  updateTransferPresetHint();
  await saveSettings();
});
$("#codexRemaining").addEventListener("input", (event) => {
  state.settings.codexSource = "manual";
  $("#quotaValue").textContent = `${event.target.value}%`;
  renderPreview();
});
$("#codexResetAt").addEventListener("change", renderPreview);
$("#displayMode").addEventListener("change", async () => {
  syncDisplayModeControl();
  $("#customNoteLabel").style.display = $("#displayMode").value === "note" ? "block" : "none";
  $("#photoControls").hidden = $("#displayMode").value !== "photo";
  $("#countdownHint").hidden = $("#displayMode").value !== "countdown";
  renderPreview();
  await saveSettings();
});
$("#displayModeButton").addEventListener("click", (event) => {
  event.stopPropagation();
  const willOpen = $("#displayModeMenu").hidden;
  $("#displayModeMenu").hidden = !willOpen;
  $("#displayModeButton").setAttribute("aria-expanded", String(willOpen));
});
document.querySelectorAll("#displayModeMenu [data-value]").forEach((button) => {
  button.addEventListener("click", () => {
    $("#displayMode").value = button.dataset.value;
    $("#displayMode").dispatchEvent(new Event("change"));
    closeDisplayModeMenu();
  });
});
document.addEventListener("click", (event) => {
  if (!$("#displayModeControl").contains(event.target)) closeDisplayModeMenu();
});
$("#customNote").addEventListener("input", renderPreview);
$("#customNote").addEventListener("change", saveSettings);
$("#photoFile").addEventListener("change", () => {
  const file = $("#photoFile").files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    $("#photoState").textContent = "请选择 JPG、PNG 或 WebP 图片";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const source = new Image();
    source.onload = async () => {
      const scale = Math.min(1, 1200 / Math.max(source.naturalWidth, source.naturalHeight));
      const normalized = document.createElement("canvas");
      normalized.width = Math.max(1, Math.round(source.naturalWidth * scale));
      normalized.height = Math.max(1, Math.round(source.naturalHeight * scale));
      const normalizedContext = normalized.getContext("2d");
      normalizedContext.fillStyle = "#fff";
      normalizedContext.fillRect(0, 0, normalized.width, normalized.height);
      normalizedContext.drawImage(source, 0, 0, normalized.width, normalized.height);
      const dataUrl = normalized.toDataURL("image/jpeg", 0.86);
      state.settings.photoDataUrl = dataUrl;
      loadPhotoDataUrl(dataUrl);
      await saveSettings();
      log(`已载入图片：${file.name}`);
    };
    source.onerror = () => {
      $("#photoState").textContent = "图片解码失败，请换一张图片";
    };
    source.src = reader.result;
  };
  reader.readAsDataURL(file);
});
["#photoZoom", "#photoX", "#photoY"].forEach((selector) => {
  $(selector).addEventListener("input", () => {
    $("#photoZoomValue").textContent = `${$("#photoZoom").value}%`;
    renderPreview();
  });
  $(selector).addEventListener("change", saveSettings);
});

(async function init() {
  const version = await window.desktop.getAppVersion();
  $("#appVersion").textContent = `v${version}`;
  $("#aboutAppVersion").textContent = `v${version}`;
  applySettings(await window.desktop.getSettings());
  updateFeishuAuthUi(await window.desktop.getFeishuAuthStatus());
  renderPreview();
  sizePreview();
  new ResizeObserver(sizePreview).observe($(".canvas-shell"));
  scheduleAutoSync();
  setConnected(false);
  log(`墨水屏桌面 v${version} 已就绪，请选择蓝牙设备`);
  if ($("#codexAuto").checked) await loadCodexQuota({ quiet: true });
})();
