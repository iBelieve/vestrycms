/**
 * `virtual:vestry/preview` in tests. Its objects are changed in place by the
 * tests, which is all an ES module's importers can do to its exports.
 */
import type { PreviewAuth } from "../src/integration/preview.js";

export const components: Record<string, unknown> = {};
export const previews: Record<string, unknown> = { pages: "PagePreview" };
export const auth: PreviewAuth = { mode: "none" };
