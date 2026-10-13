import "server-only";
import { DEFAULT_ACCENT, type Branding } from "@/data/settings";

/**
 * What the sample workspace's Branding shows. Server only: the browser is given the result (as the verified workspace's Settings), never
 * this module.
 *
 * Branding is not stored yet (a logo needs file storage), so the sample business keeps its reference crest and every other business
 * starts plain (src/server/workspace.ts). When logos are stored, this goes away and the crest is a stored file like any other.
 */
export const SAMPLE_WORKSPACE_BRANDING: Branding = {
  logo: { fileName: "apex-climate-crest-revised.svg" },
  accent: DEFAULT_ACCENT,
};
