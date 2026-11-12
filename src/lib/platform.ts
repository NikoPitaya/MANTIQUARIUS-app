import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export const isNativeApp = (): boolean => isTauri();

export const isAndroidRuntime = (): boolean => /android/i.test(navigator.userAgent);

export const supportsWindowMirroring = (): boolean => !isAndroidRuntime();

export const openExternalUrl = async (url: string): Promise<void> => {
  if (isTauri()) {
    await openUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener");
};
