"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

import {
  updateTaskCategoryAction,
  updateTaskDescriptionAction,
  updateTaskQueueAction,
  updateTaskTitleAction,
} from "./actions";
import { PropertyField } from "./property-field";

type Option = { id: string; name: string };

type FieldProps = {
  projectId: string;
  taskId: string;
  initialValue: string;
  /** Режим только просмотра. */
  disabled?: boolean;
};

/** Название — заголовок карточки, который редактируется на месте. */
export function TaskTitleField({ projectId, taskId, initialValue, disabled = false }: FieldProps) {
  const [value, setValue] = useState(initialValue);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (value === savedValue) return;
    startTransition(async () => {
      const result = await updateTaskTitleAction(projectId, taskId, value);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        setSavedValue(value);
      }
    });
  };

  return (
    <div className="min-w-0 flex-1">
      <Label htmlFor="title" className="sr-only">
        Название
      </Label>
      {/* textarea, чтобы длинное название переносилось, а не обрезалось; Enter — сохранить, не перенос строки. */}
      <textarea
        id="title"
        rows={1}
        value={value}
        disabled={pending || disabled}
        className="field-sizing-content -mx-1.5 block w-[calc(100%+0.75rem)] resize-none rounded-[7px] border border-transparent bg-transparent px-1.5 py-1 text-[17px] leading-snug font-semibold text-ink transition-[border-color,box-shadow] duration-120 outline-none hover:border-control focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/12 disabled:text-ink"
        onChange={(e) => setValue(e.target.value.replace(/\n/g, " "))}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

export function TaskDescriptionField({ projectId, taskId, initialValue, disabled = false }: FieldProps) {
  const [value, setValue] = useState(initialValue);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (value === savedValue) return;
    startTransition(async () => {
      const result = await updateTaskDescriptionAction(projectId, taskId, value);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        setSavedValue(value);
      }
    });
  };

  return (
    <div>
      <Label htmlFor="description" className="sr-only">
        Описание
      </Label>
      {/* field-sizing-content растягивает поле по тексту; где не поддерживается — 2 строки и ручное растягивание. */}
      <textarea
        id="description"
        rows={2}
        placeholder="Описание"
        disabled={pending || disabled}
        className="field-sizing-content block max-h-80 min-h-[52px] w-full min-w-0 rounded-[7px] border border-control bg-surface px-2.5 py-1.5 text-[12.5px] leading-relaxed text-ink transition-[border-color,box-shadow] duration-120 outline-none placeholder:text-placeholder hover:border-control-hover focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/12 disabled:bg-page disabled:text-faint"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
      />
    </div>
  );
}

export function TaskCategoryField({
  projectId,
  taskId,
  initialValue,
  categories,
  disabled = false,
}: FieldProps & { categories: Option[] }) {
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  const onChange = (next: string) => {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await updateTaskCategoryAction(projectId, taskId, next || null);
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error);
      }
    });
  };

  return (
    <PropertyField label="Категория" htmlFor="categoryId">
      <NativeSelect
        id="categoryId"
        value={value}
        disabled={pending || disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Без категории</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </NativeSelect>
    </PropertyField>
  );
}

/** Нужно, только когда кроме «Текущих заявок» есть другие очереди — решает страница. */
export function TaskQueueField({
  projectId,
  taskId,
  initialValue,
  queues,
  disabled = false,
}: FieldProps & { queues: Option[] }) {
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  const onChange = (next: string) => {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await updateTaskQueueAction(projectId, taskId, next || null);
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error);
      }
    });
  };

  return (
    <PropertyField label="Очередь" htmlFor="queueId">
      <NativeSelect
        id="queueId"
        value={value}
        disabled={pending || disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Текущие заявки</option>
        {queues.map((queue) => (
          <option key={queue.id} value={queue.id}>
            {queue.name}
          </option>
        ))}
      </NativeSelect>
    </PropertyField>
  );
}
