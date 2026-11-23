import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const androidRoot = resolve(root, "src-tauri/gen/android");

if (!existsSync(androidRoot)) {
  console.log("src-tauri/gen/android не найден, патч пропущен.");
  process.exit(0);
}

const mainActivityPath = resolve(
  androidRoot,
  "app/src/main/java/app/potok/finance/MainActivity.kt",
);
if (existsSync(mainActivityPath)) {
  let kt = readFileSync(mainActivityPath, "utf8");
  if (!kt.includes("import android.graphics.Color")) {
    kt = kt.replace(
      "import android.os.Bundle\n",
      "import android.graphics.Color\nimport android.os.Bundle\n",
    );
  }
  if (!kt.includes("import androidx.activity.SystemBarStyle")) {
    kt = kt.replace(
      "import androidx.activity.enableEdgeToEdge\n",
      "import androidx.activity.SystemBarStyle\nimport androidx.activity.enableEdgeToEdge\n",
    );
  }
  if (!kt.includes("SystemBarStyle.dark")) {
    kt = kt.replace(
      "    enableEdgeToEdge()",
      `    enableEdgeToEdge(\n      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),\n      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),\n    )`,
    );
  }
  writeFileSync(mainActivityPath, kt);
}

const themeFiles = [
  resolve(androidRoot, "app/src/main/res/values/themes.xml"),
  resolve(androidRoot, "app/src/main/res/values-night/themes.xml"),
];
for (const themePath of themeFiles) {
  if (!existsSync(themePath)) continue;
  let xml = readFileSync(themePath, "utf8");
  if (!xml.includes('name="android:windowBackground"')) {
    xml = xml.replace(
      "    </style>",
      '        <item name="android:windowBackground">#050914</item>\n    </style>',
    );
    writeFileSync(themePath, xml);
  }
}

const manifestPath = resolve(
  androidRoot,
  "app/src/main/AndroidManifest.xml",
);
if (existsSync(manifestPath)) {
  let manifest = readFileSync(manifestPath, "utf8");
  if (!manifest.includes("android:allowBackup=")) {
    manifest = manifest.replace(
      "<application\n",
      '<application\n        android:allowBackup="false"\n',
    );
  }
  if (!manifest.includes("android.permission.CAMERA")) {
    manifest = manifest.replace(
      '<uses-permission android:name="android.permission.INTERNET" />',
      '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />',
    );
  }
  writeFileSync(manifestPath, manifest);
}

console.log("Android-конфигурация обновлена (edge-to-edge, windowBackground, manifest).");
