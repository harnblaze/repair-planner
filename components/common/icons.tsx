// Инлайновые line-иконки визуального слоя (docs/redesign.md → Assets):
// viewBox 16×16, stroke 1.4–1.6, скруглённые концы. Размер и цвет задаются
// пропсами, чтобы не плодить варианты одной и той же иконки.

type IconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

function base({ size = 13, className, strokeWidth = 1.4 }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2" y="3.2" width="12" height="10.5" rx="1.6" />
      <path d="M2 6.4h12M5.4 1.8v2.6M10.6 1.8v2.6" />
    </svg>
  );
}

export function BookmarkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 2.5h8v11l-4-2.4-4 2.4z" />
    </svg>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 5.2a1.2 1.2 0 0 1 1.2-1.2h1.9l1.1-1.6h3.6l1.1 1.6h1.9A1.2 1.2 0 0 1 14 5.2v6.6a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 11.8z" />
      <circle cx="8" cy="8.4" r="2.4" />
    </svg>
  );
}

export function BoxIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 5.5L8 2.5l5.5 3v5L8 13.5l-5.5-3z" />
      <path d="M2.5 5.5L8 8.5l5.5-3M8 8.5v5" />
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2.2a4 4 0 0 1 4 4v3l1.2 2H2.8L4 9.2v-3a4 4 0 0 1 4-4z" />
      <path d="M6.6 13.4a1.6 1.6 0 0 0 2.8 0" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.6V8l2.3 1.4" />
    </svg>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.6 4.5h.01M2.6 8h.01M2.6 11.5h.01" />
    </svg>
  );
}

export function PlusIcon({ size = 11, className, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base({ size, className, strokeWidth })}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 11, className, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...base({ size, className, strokeWidth })}>
      <path d="M3 8h9M9 5l3 3-3 3" />
    </svg>
  );
}

export function CheckIcon({ size = 11, className, strokeWidth = 1.6 }: IconProps) {
  return (
    <svg {...base({ size, className, strokeWidth })}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function UndoIcon({ size = 11, className, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...base({ size, className, strokeWidth })}>
      <path d="M6 4L3 7l3 3M3 7h6.5a3.5 3.5 0 010 7H8" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 11, className, strokeWidth = 1.6 }: IconProps) {
  return (
    <svg {...base({ size, className, strokeWidth })}>
      <path d="M4 6.5l4 4 4-4" />
    </svg>
  );
}
