import { getCurrentWindow } from "@tauri-apps/api/window";

export const APP_NAME = "KReader";

/** Set the OS window title to `${name} - KReader`, or just the app name when no name is given. */
export function setWindowTitle(name?: string): void {
  getCurrentWindow().setTitle(name ? `${name} - ${APP_NAME}` : APP_NAME);
}
