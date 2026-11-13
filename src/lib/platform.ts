import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export const isNativeApp = (): boolean => isTauri();

export const isAndroidRuntime = (): boolean => /android/i.test(navigator.userAgent);

export const supportsWindowMirroring = (): boolean => !isAndroidRuntime();

export const openSiteWindow = async (
  url: string,
  label: string,
  title: string,
  onClose?: () => void
): Promise<Window | null> => {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("use um endereço http ou https.");
  }

  if (isTauri()) {
    const { supportsMultipleWindows } = await import("@tauri-apps/api/app");
    if (!(await supportsMultipleWindows())) {
      throw new Error("janelas de sites no app exigem Android 12L ou superior.");
    }

    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      if (onClose) void existing.once("tauri://destroyed", onClose);
      await existing.setFocus();
      return null;
    }

    const siteWindow = new WebviewWindow(label, {
      url: parsed.toString(),
      title,
      width: 1280,
      height: 860,
      center: true,
    });
    if (onClose) void siteWindow.once("tauri://destroyed", onClose);

    await new Promise<void>((resolve, reject) => {
      void siteWindow.once("tauri://created", () => resolve());
      void siteWindow.once("tauri://error", (event) => reject(new Error(String(event.payload))));
    });
    await siteWindow.setFocus();
    return null;
  }

  const siteWindow = window.open(parsed.toString(), label, "popup,width=1280,height=860");
  if (!siteWindow) {
    throw new Error("o navegador bloqueou o pop-up — permita pop-ups e tente de novo.");
  }
  siteWindow.focus();
  return siteWindow;
};

export const openExternalUrl = async (url: string): Promise<void> => {
  if (isTauri()) {
    await openUrl(url);
    return;
  }

  const opened = window.open(url, "_blank");
  if (!opened) throw new Error("o navegador bloqueou a abertura do site.");
  opened.opener = null;
};
