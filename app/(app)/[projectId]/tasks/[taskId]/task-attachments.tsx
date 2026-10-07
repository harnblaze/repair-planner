"use client";

import { Dialog } from "@base-ui/react/dialog";
import { ChevronLeftIcon, ChevronRightIcon, ImagePlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { compressImage } from "@/lib/attachments/compress-image";
import { MAX_SOURCE_BYTES, rememberSignedUrls, urlAfterLoadError } from "@/lib/business/attachments";
import { ATTACHMENT_MESSAGES, formatUploadErrors } from "@/lib/errors";

import {
  confirmTaskAttachmentAction,
  deleteTaskAttachmentAction,
  startTaskAttachmentUploadAction,
} from "./attachment-actions";

export type TaskPhoto = { id: string; url: string | null; width: number; height: number };

export function TaskAttachments({
  projectId,
  taskId,
  photos,
  canEdit,
}: {
  projectId: string;
  taskId: string;
  /** url = null — подписать ссылку не удалось; показывается заглушка. */
  photos: TaskPhoto[];
  /** false — только просмотр: без добавления и удаления. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const current = openIndex === null ? null : (photos[openIndex] ?? null);

  // Ссылки, уже загруженные браузером: новый рендер страницы подписывает фото
  // заново, и без этого кеша любое действие в карточке скачивало бы их снова.
  const [urlCache, setUrlCache] = useState(() => rememberSignedUrls({}, photos));
  const [seenPhotos, setSeenPhotos] = useState(photos);
  if (photos !== seenPhotos) {
    setSeenPhotos(photos);
    setUrlCache((cache) => rememberSignedUrls(cache, photos));
  }

  function displayUrl(photo: TaskPhoto): string | null {
    return urlCache[photo.id] ?? photo.url;
  }

  // Запомненная ссылка истекла — переходим на свежую из последнего рендера.
  // false — свежей нет, показывается заглушка.
  function handleLoadError(photo: TaskPhoto, failedUrl: string): boolean {
    const next = urlAfterLoadError(failedUrl, photo.url);
    if (next) setUrlCache((cache) => ({ ...cache, [photo.id]: next }));
    return next !== null;
  }

  // Ошибка одного фото — текст для пользователя; null — загружено.
  async function uploadOne(file: File): Promise<string | null> {
    if (!file.type.startsWith("image/")) return ATTACHMENT_MESSAGES.unsupported;
    if (file.size > MAX_SOURCE_BYTES) return ATTACHMENT_MESSAGES.tooLarge;

    let compressed;
    try {
      compressed = await compressImage(file);
    } catch {
      return ATTACHMENT_MESSAGES.unsupported;
    }

    try {
      const start = await startTaskAttachmentUploadAction(projectId, taskId);
      if (!start.ok) return start.error;

      const response = await fetch(start.signedUrl, {
        method: "PUT",
        headers: { "content-type": "image/jpeg", "x-upsert": "false" },
        body: compressed.blob,
      });
      if (!response.ok) return ATTACHMENT_MESSAGES.uploadFailed;

      const confirmed = await confirmTaskAttachmentAction(
        projectId,
        taskId,
        start.path,
        compressed.width,
        compressed.height,
      );
      return confirmed.ok ? null : confirmed.error;
    } catch {
      return ATTACHMENT_MESSAGES.uploadFailed;
    }
  }

  // По одному: меньше пиковая память на телефоне и понятный прогресс.
  async function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0) return;

    const errors: string[] = [];
    for (const [index, file] of files.entries()) {
      setProgress({ current: index + 1, total: files.length });
      const error = await uploadOne(file);
      if (error) errors.push(error);
    }
    setProgress(null);
    router.refresh();

    const message = formatUploadErrors(errors, files.length);
    if (message) toast.error(message);
  }

  function showNext(step: 1 | -1) {
    setOpenIndex((index) => (index === null ? null : (index + step + photos.length) % photos.length));
  }

  function handleDelete() {
    if (!current || !window.confirm("Удалить фото?")) return;
    startDelete(async () => {
      const result = await deleteTaskAttachmentAction(projectId, taskId, current.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpenIndex(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Фото</Label>

      {photos.length === 0 ? (
        <EmptyState>Фото пока нет.</EmptyState>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {photos.map((photo, index) => (
            <PhotoThumb
              key={photo.id}
              photo={photo}
              url={displayUrl(photo)}
              index={index}
              onOpen={() => setOpenIndex(index)}
              onLoadError={(failedUrl) => handleLoadError(photo, failedUrl)}
            />
          ))}
        </div>
      )}

      {canEdit ? (
        <div>
          {/* Без capture: на телефоне система предлагает и камеру, и галерею. */}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => void handleFiles(event.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={progress !== null}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlusIcon />
            {progress ? `Загружается ${progress.current} из ${progress.total}` : "Добавить фото"}
          </Button>
        </div>
      ) : null}

      <Dialog.Root
        open={current !== null}
        onOpenChange={(open) => {
          if (!open) setOpenIndex(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/90" />
          <Dialog.Popup
            className="fixed inset-0 z-50 flex flex-col outline-none"
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") showNext(1);
              if (event.key === "ArrowLeft") showNext(-1);
            }}
          >
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <Dialog.Title className="text-[13px] font-semibold text-white">
                Фото {(openIndex ?? 0) + 1} из {photos.length}
              </Dialog.Title>
              <div className="flex items-center gap-2">
                {canEdit ? (
                  <Button type="button" variant="destructive" disabled={isDeleting} onClick={handleDelete}>
                    <Trash2Icon />
                    Удалить
                  </Button>
                ) : null}
                <Dialog.Close aria-label="Закрыть" className={buttonVariants({ variant: "secondary", size: "icon" })}>
                  <XIcon />
                </Dialog.Close>
              </div>
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4">
              {current ? (
                <ViewerImage
                  key={current.id}
                  photo={current}
                  url={displayUrl(current)}
                  onLoadError={(failedUrl) => handleLoadError(current, failedUrl)}
                />
              ) : null}
              {photos.length > 1 ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    aria-label="Предыдущее фото"
                    className="absolute top-1/2 left-3 -translate-y-1/2"
                    onClick={() => showNext(-1)}
                  >
                    <ChevronLeftIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    aria-label="Следующее фото"
                    className="absolute top-1/2 right-3 -translate-y-1/2"
                    onClick={() => showNext(1)}
                  >
                    <ChevronRightIcon />
                  </Button>
                </>
              ) : null}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

const EXPIRED_TEXT = "Обновите страницу";

type PhotoImageProps = {
  photo: TaskPhoto;
  url: string | null;
  /** true — подставлена свежая ссылка; false — показать заглушку. */
  onLoadError: (failedUrl: string) => boolean;
};

function PhotoThumb({
  photo,
  url,
  index,
  onOpen,
  onLoadError,
}: PhotoImageProps & { index: number; onOpen: () => void }) {
  // Подписанная ссылка живёт час: на долго открытой вкладке картинка
  // перестаёт грузиться — показываем подсказку вместо битого изображения.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!url || failedUrl === url) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-md bg-page p-1 text-center text-[11px] text-faint">
        {EXPIRED_TEXT}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Открыть фото ${index + 1}`}
      className="aspect-square overflow-hidden rounded-md bg-page outline-none focus-visible:ring-[3px] focus-visible:ring-brand/12"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка живёт час, оптимизатор next/image её не кеширует */}
      <img
        src={url}
        alt=""
        loading="lazy"
        width={photo.width}
        height={photo.height}
        className="size-full object-cover"
        onError={() => {
          if (!onLoadError(url)) setFailedUrl(url);
        }}
      />
    </button>
  );
}

function ViewerImage({ photo, url, onLoadError }: PhotoImageProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!url || failedUrl === url) {
    return <p className="text-[13px] text-white/70">{EXPIRED_TEXT}</p>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка живёт час, оптимизатор next/image её не кеширует
    <img
      src={url}
      alt=""
      width={photo.width}
      height={photo.height}
      className="max-h-full max-w-full object-contain"
      onError={() => {
        if (!onLoadError(url)) setFailedUrl(url);
      }}
    />
  );
}
