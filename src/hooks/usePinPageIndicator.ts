import { useEffect, useRef, useState } from "react";
import { Store } from "@tauri-apps/plugin-store";

const SETTINGS_FILE = ".settings.dat";
const KEY = "pin-page-indicator";

export function usePinPageIndicator() {
  const [pinPageIndicator, setPinPageIndicator] = useState(false);
  const storeRef = useRef<Store | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const s = await Store.load(SETTINGS_FILE);
      storeRef.current = s;
      const pinned = await s.get<boolean>(KEY);
      if (pinned !== undefined) setPinPageIndicator(pinned);
      loadedRef.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    const s = storeRef.current;
    if (s) { s.set(KEY, pinPageIndicator); s.save(); }
  }, [pinPageIndicator]);

  return [pinPageIndicator, setPinPageIndicator] as const;
}
