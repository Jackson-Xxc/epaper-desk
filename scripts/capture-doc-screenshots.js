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
  window.setOpacity(0);
  window.showInactive();

  const outputDir = path.join(__dirname, "..", "docs", "images");
  fs.mkdirSync(outputDir, { recursive: true });

  const wait = (milliseconds = 250) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const captureWindow = async (filename) => {
    window.webContents.invalidate();
    await wait();
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(outputDir, filename), image.toPNG());
  };
  const captureCanvas = async (filename) => {
    const dataUrl = await window.webContents.executeJavaScript(
      "document.querySelector('#epaperCanvas').toDataURL('image/png')",
    );
    fs.writeFileSync(
      path.join(outputDir, filename),
      Buffer.from(dataUrl.split(",")[1], "base64"),
    );
  };
  const selectMode = async (mode) => {
    await window.webContents.executeJavaScript(`
      (() => {
        const select = document.querySelector("#displayMode");
        select.value = ${JSON.stringify(mode)};
        syncDisplayModeControl();
        document.querySelector("#customNoteLabel").style.display = select.value === "note" ? "block" : "none";
        document.querySelector("#photoControls").hidden = select.value !== "photo";
        document.querySelector("#countdownHint").hidden = select.value !== "countdown";
        closeDisplayModeMenu();
        renderPreview();
      })()
    `);
    await wait();
  };

  const overview = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, "app-overview.png"), overview.toPNG());

  await captureCanvas("screen-preview.png");

  await window.webContents.executeJavaScript(`
    (() => {
      const now = Date.now();
      state.events = [
        {
          title: "项目晨会",
          start: now + 45 * 60 * 1000,
          end: now + 75 * 60 * 1000,
          allDay: false,
          status: "confirmed",
          isSchedule: false
        },
        {
          title: "设计评审",
          start: now + 3 * 60 * 60 * 1000,
          end: now + 4 * 60 * 60 * 1000,
          allDay: false,
          status: "confirmed",
          isSchedule: false
        },
        {
          title: "整理本周计划",
          start: now + 5 * 60 * 60 * 1000,
          end: now + 6 * 60 * 60 * 1000,
          allDay: false,
          status: "confirmed",
          isSchedule: false
        }
      ];
      state.tasks = [
        { summary: "完成首页方案", completed: false, createdAt: now + 8000 },
        { summary: "校对产品文案", completed: false, createdAt: now + 7000 },
        { summary: "整理演示素材", completed: false, createdAt: now + 6000 },
        { summary: "确认交付清单", completed: false, createdAt: now + 5000 },
        { summary: "导出三色预览", completed: false, createdAt: now + 4000 },
        { summary: "记录测试结果", completed: false, createdAt: now + 3000 },
        { summary: "更新项目进度", completed: false, createdAt: now + 2000 },
        { summary: "准备明日计划", completed: false, createdAt: now + 1000 }
      ];
      document.querySelector("#customNote").value =
        "今天只做三件事：完成方案、检查细节、按时休息。";
      renderPreview();
    })()
  `);

  await selectMode("agenda");
  await captureCanvas("mode-agenda.png");
  await selectMode("tasks");
  await captureCanvas("mode-tasks.png");
  await selectMode("countdown");
  await captureCanvas("mode-countdown.png");
  await selectMode("note");
  await captureCanvas("mode-note.png");

  const photoSample = fs.readFileSync(path.join(outputDir, "photo-sample-anime.png"));
  const photoSampleDataUrl = `data:image/png;base64,${photoSample.toString("base64")}`;
  await window.webContents.executeJavaScript(
    `loadPhotoDataUrl(${JSON.stringify(photoSampleDataUrl)})`,
  );
  await selectMode("photo");
  await wait(500);
  await window.webContents.executeJavaScript("renderPreview()");
  await captureCanvas("mode-photo.png");

  await window.webContents.executeJavaScript(`
    (() => {
      document.querySelector('[data-tab="content"]').click();
      const page = document.querySelector('[data-page="content"]');
      page.scrollTop = 0;
      document.querySelector("#displayModeMenu").hidden = false;
      document.querySelector("#displayModeButton").setAttribute("aria-expanded", "true");
    })()
  `);
  await captureWindow("content-mode-menu.png");

  await window.webContents.executeJavaScript(`
    (() => {
      closeDisplayModeMenu();
      const select = document.querySelector("#displayMode");
      select.value = "agenda";
      syncDisplayModeControl();
      document.querySelector("#customNoteLabel").style.display = "none";
      document.querySelector("#photoControls").hidden = true;
      document.querySelector("#countdownHint").hidden = true;
      renderPreview();
      const page = document.querySelector('[data-page="content"]');
      const cards = page.querySelectorAll(":scope > .card");
      page.scrollTop = Math.max(0, cards[1].offsetTop - page.offsetTop - 8);
    })()
  `);
  await captureWindow("content-feishu.png");

  await window.webContents.executeJavaScript(`
    (() => {
      const page = document.querySelector('[data-page="content"]');
      const cards = page.querySelectorAll(":scope > .card");
      page.scrollTop = Math.max(0, cards[2].offsetTop - page.offsetTop - 8);
    })()
  `);
  await captureWindow("content-codex.png");

  console.log(outputDir);
  window.destroy();
  app.quit();
});
