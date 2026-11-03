"use client";

import { useState } from "react";

import { EyeIcon, EyeOffIcon } from "@/components/common/icons";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Поле пароля с кнопкой «глазик»: даёт проверить набранное, не перепечатывая.
 *
 * Оборачивает Input и принимает те же пропсы, поэтому в формах подставляется
 * вместо него без правок react-hook-form: register() по-прежнему передаёт
 * name, onChange и ref.
 */
export function PasswordInput({ className, disabled, ...props }: React.ComponentProps<"input">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        disabled={disabled}
        // Тип переключаем на самом поле, а не на копии: иначе браузер терял бы
        // курсор и менеджер паролей не узнал бы поле.
        type={visible ? "text" : "password"}
        // Правый отступ — чтобы текст не заезжал под кнопку.
        className={cn("pr-8", className)}
      />
      <button
        type="button"
        // type="button" обязателен: иначе Enter в поле отправлял бы форму.
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
        aria-pressed={visible}
        disabled={disabled}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-[7px] text-meta transition-colors duration-120 hover:text-ink focus-visible:text-ink focus-visible:outline-none disabled:pointer-events-none disabled:text-faint"
      >
        {visible ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
      </button>
    </div>
  );
}
