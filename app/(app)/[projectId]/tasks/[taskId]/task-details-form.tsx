"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

import { updateTaskCategoryAction, updateTaskDescriptionAction, updateTaskTitleAction } from "./actions";

type Category = { id: string; name: string };

export function TaskDetailsForm({
  projectId,
  taskId,
  task,
  categories,
}: {
  projectId: string;
  taskId: string;
  task: { title: string; description: string; categoryId: string };
  categories: Category[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <TitleField projectId={projectId} taskId={taskId} initialValue={task.title} />
      <DescriptionField projectId={projectId} taskId={taskId} initialValue={task.description} />
      <CategoryField
        projectId={projectId}
        taskId={taskId}
        initialValue={task.categoryId}
        categories={categories}
      />
    </div>
  );
}

function TitleField({
  projectId,
  taskId,
  initialValue,
}: {
  projectId: string;
  taskId: string;
  initialValue: string;
}) {
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
    <div className="flex flex-col gap-2">
      <Label htmlFor="title">Название</Label>
      <Input
        id="title"
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </div>
  );
}

function DescriptionField({
  projectId,
  taskId,
  initialValue,
}: {
  projectId: string;
  taskId: string;
  initialValue: string;
}) {
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
    <div className="flex flex-col gap-2">
      <Label htmlFor="description">Описание</Label>
      <textarea
        id="description"
        rows={4}
        disabled={pending}
        className="w-full min-w-0 rounded-[7px] border border-control bg-surface px-2.5 py-1.5 text-[12.5px] text-ink transition-[border-color,box-shadow] duration-120 outline-none placeholder:text-placeholder hover:border-control-hover focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/12 disabled:bg-page disabled:text-faint"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
      />
    </div>
  );
}

function CategoryField({
  projectId,
  taskId,
  initialValue,
  categories,
}: {
  projectId: string;
  taskId: string;
  initialValue: string;
  categories: Category[];
}) {
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
    <div className="flex flex-col gap-2">
      <Label htmlFor="categoryId">Категория</Label>
      <NativeSelect
        id="categoryId"
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Без категории</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
