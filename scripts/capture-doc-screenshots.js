const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1244,
    height: 780,
    backgroundColor: "#f3f4ef",
    webPreferences: {
      preload: path.join(__dirname, "visual-qa-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  await window.loadFile(path.join(__dirname, "..", "src", "index.html"));
  await new Promise((resolve) => setTimeout(resolve, 900));

  const outputDir = path.join(__dirname, "..", "docs", "images");
  fs.mkdirSync(outputDir, { recursive: true });

  const overview = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, "app-overview.png"), overview.toPNG());

  const dataUrl = await window.webContents.executeJavaScript(
    "document.querySelector('#epaperCanvas').toDataURL('image/png')",
  );
  fs.writeFileSync(
    path.join(outputDir, "screen-preview.png"),
    Buffer.from(dataUrl.split(",")[1], "base64"),
  );

  console.log(outputDir);
  window.destroy();
  app.quit();
});
