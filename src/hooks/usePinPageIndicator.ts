import { useEffect, useRef, useState } from "react";
import { getPinPageIndicator, savePinPageIndicator } from "../utils/settingsStore";

export function usePinPageIndicator() {
  const [pinPageIndicator, setPinPageIndicator] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const pinned = await getPinPageIndicator();
      setPinPageIndicator(pinned);
      loadedRef.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    savePinPageIndicator(pinPageIndicator).catch(console.error);
  }, [pinPageIndicator]);

  return [pinPageIndicator, setPinPageIndicator] as const;
}
