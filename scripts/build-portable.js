const { Arch, build, Platform } = require("electron-builder");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function main() {
  const projectDir = path.resolve(__dirname, "..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
  const temporaryOutput = path.join(
    os.tmpdir(),
    `epaper-desk-portable-build-${packageJson.version}`,
  );
  const releaseDir = path.join(projectDir, "release");
  const installedElectronDist = path.join(projectDir, "node_modules", "electron", "dist");
  await build({
    targets: Platform.WINDOWS.createTarget(["portable"], Arch.x64),
    projectDir,
    config: {
      directories: { output: temporaryOutput },
      // The portable artifact is unsigned. Skipping rcedit avoids electron-builder's
      // winCodeSign bundle, whose unused macOS symlinks require Windows Developer Mode.
      win: { signAndEditExecutable: false },
      // Reuse the verified Electron installed by pnpm. This keeps portable builds
      // working when GitHub release downloads are slow or blocked.
      ...(fs.existsSync(path.join(installedElectronDist, "electron.exe"))
        ? { electronDist: installedElectronDist }
        : {}),
    },
  });
  const fileName = `EPaper-Desk-${packageJson.version}-portable.exe`;
  const source = path.join(temporaryOutput, fileName);
  const destination = path.join(releaseDir, fileName);
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.copyFileSync(source, destination);
  console.log(`Portable build: ${destination}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
