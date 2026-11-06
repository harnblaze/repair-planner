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

export function UserIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="5.4" r="2.6" />
      <path d="M3 13.6a5 5 0 0 1 10 0" />
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

/** Солнце и луна: переключение темы в шапке. */
export function SunIcon({ size = 14, className, strokeWidth = 1.6 }: IconProps) {
  return (
    <svg {...base({ size, className, strokeWidth })}>
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
    </svg>
  );
}

export function MoonIcon({ size = 14, className, strokeWidth = 1.6 }: IconProps) {
  return (
    <svg {...base({ size, className, strokeWidth })}>
      <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z" />
    </svg>
  );
}

/** Шевроны просмотрщика фото: листание ←/→. */
export function ChevronLeftIcon({ size = 11, className, strokeWidth = 1.6 }: IconProps) {
  return (
    <svg {...base({ size, className, strokeWidth })}>
      <path d="M10 2.5l-5.5 5.5 5.5 5.5" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 11, className, strokeWidth = 1.6 }: IconProps) {
  return (
    <svg {...base({ size, className, strokeWidth })}>
      <path d="M6 2.5L11.5 8 6 13.5" />
    </svg>
  );
}

/** Пузырь сообщения — кнопка чата в углу экрана. */
export function ChatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13.5 9.2a1.6 1.6 0 0 1-1.6 1.6H5.2L2.5 13V4.2a1.6 1.6 0 0 1 1.6-1.6h7.8a1.6 1.6 0 0 1 1.6 1.6z" />
    </svg>
  );
}

/** Лупа — поиск по переписке. */
export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 13.6 13.6" />
    </svg>
  );
}

/** Открытый глаз — показать пароль. */
export function EyeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M1.6 8S4 4.4 8 4.4 14.4 8 14.4 8 12 11.6 8 11.6 1.6 8 1.6 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  );
}

/** Перечёркнутый глаз — скрыть пароль. */
export function EyeOffIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.2 2.2l11.6 11.6" />
      <path d="M6.3 4.6A7.1 7.1 0 0 1 8 4.4c4 0 6.4 3.6 6.4 3.6a12.4 12.4 0 0 1-2.3 2.6" />
      <path d="M4.3 5.7A12.4 12.4 0 0 0 1.6 8s2.4 3.6 6.4 3.6c.9 0 1.7-.2 2.4-.5" />
    </svg>
  );
}

/** Стрелка-ответ: ответить на сообщение, вернуться к оригиналу. */
export function ReplyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6.2 4.4 3 7.6l3.2 3.2" />
      <path d="M3.4 7.6h5.4a4.2 4.2 0 0 1 4.2 4.2v.6" />
    </svg>
  );
}

/** Крестик — закрыть панель чата. */
export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

/** Скрепка: прикрепить фото к сообщению. */
export function AttachIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10.6 4.8 5.6 9.8a1.9 1.9 0 0 0 2.7 2.7l5.3-5.3a3.1 3.1 0 0 0-4.4-4.4l-5 5a4.3 4.3 0 0 0 6.1 6.1l4.3-4.3" />
    </svg>
  );
}
