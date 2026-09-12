"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (value === savedValue) return;
    setError(null);
    startTransition(async () => {
      const result = await updateTaskTitleAction(projectId, taskId, value);
      if (!result.ok) {
        setError(result.error);
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
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (value === savedValue) return;
    setError(null);
    startTransition(async () => {
      const result = await updateTaskDescriptionAction(projectId, taskId, value);
      if (!result.ok) {
        setError(result.error);
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
        className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onChange = (next: string) => {
    setError(null);
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await updateTaskCategoryAction(projectId, taskId, next || null);
      if (!result.ok) {
        setValue(previous);
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="categoryId">Категория</Label>
      <select
        id="categoryId"
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="">Без категории</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
