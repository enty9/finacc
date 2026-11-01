import { isTauri } from "@tauri-apps/api/core";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { version } from "../package.json";

export type AppUpdate = { version: string; url: string };

function releaseVersion(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/(?:^|\s)v?(\d+)\.(\d+)(?:\.(\d+))?(?=$|\s)/i);
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export async function checkForUpdate(
  signal: AbortSignal,
): Promise<AppUpdate | null> {
  const response = await (isTauri() ? nativeFetch : fetch)(
    "https://api.github.com/repos/enty9/finacc/releases/latest",
    {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      headers: { Accept: "application/vnd.github+json" },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub недоступен (${response.status}).`);
  const release: unknown = await response.json();
  if (!release || typeof release !== "object") return null;
  const r = release as Record<string, unknown>;
  if (r.draft !== false || r.prerelease !== false) return null;
  const latest = releaseVersion(r.tag_name) ?? releaseVersion(r.name);
  const current = releaseVersion(version)!;
  if (!latest) return null;
  const difference = latest.findIndex((part, index) => part !== current[index]);
  if (difference < 0 || latest[difference] < current[difference]) return null;
  if (
    typeof r.html_url !== "string" ||
    !r.html_url.startsWith("https://github.com/enty9/finacc/releases/tag/")
  )
    return null;
  return { version: latest.join("."), url: r.html_url };
}
