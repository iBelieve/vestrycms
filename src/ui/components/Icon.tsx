import {
  AppWindow,
  BookOpen,
  Box,
  Clapperboard,
  Columns2,
  File,
  FileQuestionMark,
  FileText,
  Files,
  Folder,
  GalleryHorizontal,
  House,
  Image,
  Images,
  LayoutGrid,
  LetterH,
  Link,
  List,
  ListOrdered,
  Mail,
  Map,
  MapPin,
  Menu,
  MousePointerClick,
  Newspaper,
  Palette,
  Quote,
  Rows3,
  ScrollText,
  Settings2,
  Sparkles,
  Table,
  Tag,
  TextAlignStart,
  TriangleExclamationPoint,
  Users,
  Video,
  type LucideProps,
} from "lucide-react";
import type { IconName } from "../../config/icons.js";

type IconComponent = React.ComponentType<LucideProps>;

/**
 * Icons available by name in config (`icon: "book-open"`). A curated set
 * keeps the control panel bundle small; unknown names fall back to a file.
 * Its names are `ICON_NAMES`, which the config check reads.
 */
const ICONS: Record<IconName, IconComponent> = {
  "app-window": AppWindow,
  "book-open": BookOpen,
  box: Box,
  clapperboard: Clapperboard,
  "columns-2": Columns2,
  file: File,
  "file-question-mark": FileQuestionMark,
  "file-text": FileText,
  files: Files,
  folder: Folder,
  "gallery-horizontal": GalleryHorizontal,
  house: House,
  image: Image,
  images: Images,
  "layout-grid": LayoutGrid,
  "letter-h": LetterH,
  link: Link,
  list: List,
  "list-ordered": ListOrdered,
  mail: Mail,
  map: Map,
  "map-pin": MapPin,
  menu: Menu,
  "mouse-pointer-click": MousePointerClick,
  newspaper: Newspaper,
  palette: Palette,
  quote: Quote,
  "rows-3": Rows3,
  "scroll-text": ScrollText,
  "settings-2": Settings2,
  sparkles: Sparkles,
  table: Table,
  tag: Tag,
  "text-align-start": TextAlignStart,
  // Lucide's old name for it, which Vestry's defaults and docs use.
  "triangle-alert": TriangleExclamationPoint,
  users: Users,
  video: Video,
};

export function Icon({ name, ...props }: { name?: string } & LucideProps) {
  const Cmp = (name && ICONS[name as IconName]) || File;
  return <Cmp strokeWidth={1.9} {...props} />;
}
