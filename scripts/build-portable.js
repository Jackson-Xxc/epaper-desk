const { Arch, build, Platform } = require("electron-builder");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function verifyPortableArchive(filePath) {
  const electronBuilderDir = path.dirname(require.resolve("electron-builder/package.json"));
  const sevenZipModule = require.resolve("7zip-bin", { paths: [electronBuilderDir] });
  const { path7za } = require(sevenZipModule);
  const result = spawnSync(path7za, ["t", filePath], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `Portable archive verification failed:\n${result.stdout || ""}\n${result.stderr || ""}`,
    );
  }
}

async function main() {
  const projectDir = path.resolve(__dirname, "..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
  const temporaryOutput = path.join(
    os.tmpdir(),
    `epaper-desk-portable-build-${packageJson.version}`,
  );
  const releaseDir = path.join(projectDir, "release");
  const installedElectronDist = path.join(projectDir, "node_modules", "electron", "dist");
  // A reused electron-builder output can retain a partially written NSIS/7z
  // artifact after an interrupted build. Always start from an empty directory.
  fs.rmSync(temporaryOutput, { recursive: true, force: true });
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
  verifyPortableArchive(source);
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.copyFileSync(source, destination);
  const sourceHash = sha256(source);
  const destinationHash = sha256(destination);
  if (sourceHash !== destinationHash) {
    throw new Error("Portable copy verification failed: SHA-256 mismatch");
  }
  console.log(`Portable build: ${destination}`);
  console.log(`Portable SHA-256: ${destinationHash.toUpperCase()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
