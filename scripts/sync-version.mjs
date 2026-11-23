import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Использование: node scripts/sync-version.mjs <X.Y.Z>");
  process.exit(1);
}

const root = process.cwd();

function updateJson(relPath) {
  const fullPath = resolve(root, relPath);
  const parsed = JSON.parse(readFileSync(fullPath, "utf8"));
  parsed.version = version;
  writeFileSync(fullPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

updateJson("package.json");
updateJson("src-tauri/tauri.conf.json");

const cargoPath = resolve(root, "src-tauri/Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8");
const updatedCargo = cargo.replace(
  /(\[package\][\s\S]*?\bversion\s*=\s*")[^"]+(")/,
  `$1${version}$2`,
);
if (cargo === updatedCargo && !cargo.includes(`version = "${version}"`)) {
  console.error("Не удалось обновить version в src-tauri/Cargo.toml");
  process.exit(1);
}
writeFileSync(cargoPath, updatedCargo);

console.log(`Версия синхронизирована: ${version}`);
