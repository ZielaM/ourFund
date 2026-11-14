import { APP_NAME } from "@/config/app";
import { todayInWarsaw } from "@/domain/portfolio/dates";

/** "ourfund-transakcje-2026-11-14.csv": what the file is, and of which day. */
export function exportFileName(kind: string, extension: string, now: Date = new Date()): string {
  return `${APP_NAME.toLowerCase()}-${kind}-${todayInWarsaw(now)}.${extension}`;
}

/** Headers that make a browser save the response as a file and never cache it. */
export function downloadHeaders(fileName: string, contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "no-store",
  };
}
