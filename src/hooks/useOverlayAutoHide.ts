import { useCallback, useEffect, useRef, useState } from "react";

const HIDE_DELAY_MS = 1500;

export function useOverlayAutoHide(showMoreInfo: boolean) {
  const [showOverlay, setShowOverlay] = useState(false);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = useCallback(() => {
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = setTimeout(() => setShowOverlay(false), HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    const handleMouseMove = () => {
      setShowOverlay(true);
      if (!showMoreInfo) scheduleHide();
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [showMoreInfo, scheduleHide]);

  // Cleanup only on unmount — sharing it with the mousemove effect's cleanup
  // canceled the hide timer set by the I-key handler when showMoreInfo flipped.
  useEffect(() => () => {
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
  }, []);

  return { showOverlay, setShowOverlay, scheduleHide, overlayTimerRef };
}
