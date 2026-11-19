/**
 * The names of the icons the control panel draws (`Icon.tsx`), so the
 * config check can refuse a name the panel would quietly replace with a
 * file icon.
 */
export const ICON_NAMES = [
  "app-window",
  "book-open",
  "box",
  "clapperboard",
  "columns-2",
  "file",
  "file-question-mark",
  "file-text",
  "files",
  "folder",
  "gallery-horizontal",
  "house",
  "image",
  "images",
  "layout-grid",
  "letter-h",
  "link",
  "list",
  "list-ordered",
  "mail",
  "map",
  "map-pin",
  "menu",
  "mouse-pointer-click",
  "newspaper",
  "palette",
  "quote",
  "rows-3",
  "scroll-text",
  "settings-2",
  "sparkles",
  "table",
  "tag",
  "text-align-start",
  "triangle-alert",
  "users",
  "video",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export function isIconName(name: string): name is IconName {
  return (ICON_NAMES as readonly string[]).includes(name);
}
