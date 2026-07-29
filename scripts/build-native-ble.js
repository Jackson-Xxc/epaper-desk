const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "native", "NativeBleHelper.cs");
const outputDir = path.join(root, "native", "bin");
const output = path.join(outputDir, "NativeBleHelper.exe");
const csc = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
const winmd = "C:\\Program Files (x86)\\Windows Kits\\10\\UnionMetadata\\10.0.26100.0\\Windows.winmd";
const windowsRuntime = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\System.Runtime.WindowsRuntime.dll";
const systemRuntime = "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\System.Runtime\\v4.0_4.0.0.0__b03f5f7f11d50a3a\\System.Runtime.dll";
const interopWindowsRuntime = "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\System.Runtime.InteropServices.WindowsRuntime\\v4.0_4.0.0.0__b03f5f7f11d50a3a\\System.Runtime.InteropServices.WindowsRuntime.dll";

for (const required of [source, csc, winmd, windowsRuntime, systemRuntime, interopWindowsRuntime]) {
  if (!fs.existsSync(required)) throw new Error(`Native BLE build dependency not found: ${required}`);
}

fs.mkdirSync(outputDir, { recursive: true });
execFileSync(csc, [
  "/nologo",
  "/target:exe",
  "/platform:x64",
  `/out:${output}`,
  `/reference:${winmd}`,
  `/reference:${windowsRuntime}`,
  `/reference:${systemRuntime}`,
  `/reference:${interopWindowsRuntime}`,
  source,
], { stdio: "inherit" });
console.log(`Native BLE helper: ${output}`);
