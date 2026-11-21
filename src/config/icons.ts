/**
 * The names of the icons the control panel draws (`Icon.tsx`), so the
 * config check can refuse a name the panel would quietly replace with a
 * file icon.
 */
export const ICON_NAMES = [
  "app-window",
  "book-down",
  "book-marked",
  "book-open",
  "box",
  "circle-question-mark",
  "clapperboard",
  "columns-2",
  "columns-4",
  "diamond",
  "download",
  "feather",
  "file",
  "file-question-mark",
  "file-text",
  "files",
  "folder",
  "gallery-horizontal",
  "grid-3x3",
  "house",
  "image",
  "images",
  "layout-grid",
  "letter-h",
  "library",
  "link",
  "list",
  "list-indent-increase",
  "list-ordered",
  "mail",
  "map",
  "map-pin",
  "menu",
  "mouse-pointer-click",
  "music",
  "newspaper",
  "notebook-pen",
  "palette",
  "quote",
  "rows-3",
  "scroll-text",
  "settings-2",
  "shopping-cart",
  "sparkles",
  "square",
  "sun",
  "table",
  "tag",
  "tags",
  "text-align-center",
  "text-align-start",
  "triangle-alert",
  "users",
  "video",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export function isIconName(name: string): name is IconName {
  return (ICON_NAMES as readonly string[]).includes(name);
}
