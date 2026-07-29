const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1244,
    height: 780,
    webPreferences: {
      preload: path.join(__dirname, "visual-qa-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadFile(path.join(__dirname, "..", "src", "index.html"));
  await new Promise((resolve) => setTimeout(resolve, 700));
  const checks = await window.webContents.executeJavaScript(`(() => ({
    midAutumn: dayStatus(new Date(2026, 8, 25)),
    makeupSunday: dayStatus(new Date(2026, 8, 20)),
    nextLongHoliday: nextOfficialHoliday(new Date(2026, 6, 28), 5)?.name,
  }))()`);
  if (!checks.midAutumn.rest || checks.midAutumn.source !== "中秋") {
    throw new Error("中秋节法定休息日验证失败");
  }
  if (checks.makeupSunday.rest || checks.makeupSunday.source !== "法定调休") {
    throw new Error("国庆前周日补班验证失败");
  }
  if (checks.nextLongHoliday !== "国庆") {
    throw new Error("下一次长假验证失败");
  }
  const dataUrl = await window.webContents.executeJavaScript(
    "document.querySelector('#epaperCanvas').toDataURL('image/png')",
  );
  const target = path.join(__dirname, "..", "release", "countdown-preview.png");
  fs.writeFileSync(target, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(target);
  window.destroy();
  app.quit();
});
