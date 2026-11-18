/**
 * Vestry's own mark (`assets/logo.svg`): arches and V in the current text
 * colour, so one component serves light and dark backgrounds, with the
 * sparkle in the brand orange. It is decorative: the site name beside it
 * labels the link.
 */
export function VestryMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 256 278" aria-hidden="true">
      <g fill="currentColor">
        <path d="M118 16C72 21 35 57 30 106H56C61 72 86 47 118 42Z" />
        <path d="M138 16C184 21 221 57 226 106H200C195 72 170 47 138 42Z" />
        <path d="M16 126H64L128 228L192 126H240L154 262H102Z" />
      </g>
      <path
        fill="#FF791B"
        d="M128 70Q135 92 139 95Q143 99 164 106Q143 113 139 117Q135 121 128 142Q121 121 117 117Q113 113 92 106Q113 99 117 95Q121 92 128 70Z"
      />
    </svg>
  );
}
