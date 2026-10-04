import { useMediaQuery } from "@/hooks/use-media-query";

const MOBILE_BREAKPOINT = 768;

/** Used by the shadcn sidebar: true below 768px (drawer mode). */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}
