"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AttachIcon, ChatIcon, CloseIcon } from "@/components/common/icons";
import { Button } from "@/components/ui/button";
import {
  CHAT_ATTACHMENT_MESSAGES,
  CHAT_DOCUMENT_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  attachmentKindForFile,
  documentMimeFor,
  firstAttachmentError,
  formatFileSize,
} from "@/lib/business/attachments";
import {
  CHAT_BODY_MAX,
  authorInitials,
  REACTION_EMOJI,
  addReaction,
  applyEmoji,
  attachmentGridClass,
  attachmentsByMessage,
  authorNameOf,
  canSend,
  groupMessagesByDay,
  isEdited,
  isOwnMessage,
  isNearBottom,
  jumboSize,
  mapPresence,
  mergeMessages,
  messageTime,
  normalizeBody,
  splitAttachments,
  removeMessage,
  removeMessageAttachments,
  removeMessageReactions,
  removeReaction,
  shouldShowAuthor,
  summarizeReactions,
  toggleReaction,
  type ChatAttachment,
  type ChatMessage,
  type ChatReaction,
  type OnlineUser,
  type PresenceEntry,
} from "@/lib/business/chat";
import { compressImage } from "@/lib/attachments/compress-image";
import { EMOJI_CATEGORIES, readRecentEmoji, recentEmoji, saveRecentEmoji } from "@/lib/business/emoji";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import {
  deleteMessageAction,
  editMessageAction,
  loadMessagesAction,
  markChatReadAction,
  sendMessageAction,
  sendMessageWithAttachmentsAction,
  startChatAttachmentUploadAction,
  toggleReactionAction,
} from "./actions";
import { useChatOpen } from "./use-chat-open";

// Сколько ждём подтверждения подписки, прежде чем честно сказать «обновление
// недоступно». Молчащий канал выглядит как живой чат, в котором никто не пишет.
const REALTIME_TIMEOUT_MS = 8000;
// Дозапрос, пока Realtime недоступен: сообщения приходят с задержкой, зато не теряются.
const POLL_MS = 15000;
// Страховка при «живой» подписке: сверяемся с сервером редко — молчащая
// подписка (SUBSCRIBED без событий) иначе заморозила бы чат без ошибок.
const POLL_SAFETY_MS = 30000;

/** Файл, выбранный но ещё не отправленный: байты, превью (только у фото) и тип. */
type PendingAttachment = {
  key: string;
  kind: "image" | "document";
  mimeType: string;
  fileName: string;
  blob: Blob;
  /** Только у фото: у документа превью-картинки нет. */
  previewUrl: string | null;
  width: number | null;
  height: number | null;
};

type Props = {
  projectId: string;
  userId: string;
  canPost: boolean;
  initialMessages: ChatMessage[];
  initialReactions: ChatReaction[];
  initialAttachments: ChatAttachment[];
  initialUnread: number;
  /** Имена участников по id (project_member_list). Чужие имена иначе не прочитать. */
  authorNames: Record<string, string | null>;
  timezone: string;
};

export function ChatWidget({
  projectId,
  userId,
  canPost,
  initialMessages,
  initialReactions,
  initialAttachments,
  initialUnread,
  authorNames,
  timezone,
}: Props) {
  const [open, setOpen] = useChatOpen(projectId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [reactions, setReactions] = useState<ChatReaction[]>(initialReactions);
  // Фото отправленных сообщений и фото, выбранные но ещё не отправленные.
  const [attachments, setAttachments] = useState<ChatAttachment[]>(initialAttachments);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  // Сжатие большого фото занимает секунду-две, и без индикатора кажется, что
  // выбор файла ничего не сделал.
  const [preparing, setPreparing] = useState(false);
  // Просмотр фото на весь экран: ссылка выбранного снимка.
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [unread, setUnread] = useState(initialUnread);
  // «Новые сообщения»: сколько пришло, пока читатель листал историю выше.
  const [newCount, setNewCount] = useState(0);
  const atBottomRef = useRef(true);
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  // Меню «…» у своего сообщения: правка и удаление.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [confirmDeleteFor, setConfirmDeleteFor] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState(EMOJI_CATEGORIES[0]?.id ?? "");
  // Читаем при первом рендере: пикер закрыт, поэтому на гидратацию это не влияет.
  const [recent, setRecent] = useState<string[]>(() => readRecentEmoji());
  /**
   * `connecting` — подписка ещё не подтверждена, `live` — события идут,
   * `offline` — Realtime недоступен, работаем дозапросом.
   */
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");

  const openRef = useRef(open);
  const knownIds = useRef(new Set(initialMessages.map((message) => message.id)));
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const persistOpen = useCallback(
    (next: boolean) => {
      // Свернули панель — всплывающие окна не должны ждать следующего открытия.
      if (!next) {
        setEmojiOpen(false);
        setReactionPickerFor(null);
      }
      setOpen(next);
      openRef.current = next;
    },
    [setOpen],
  );

  /** Приём сообщений из любого источника: Realtime или дозапрос. */
  const applyIncoming = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    const fresh = incoming.filter((message) => !knownIds.current.has(message.id));
    for (const message of incoming) knownIds.current.add(message.id);

    setMessages((current) => mergeMessages(current, incoming));

    const fromOthers = fresh.filter((message) => message.author_id !== userId);
    if (fromOthers.length === 0) return;
    if (openRef.current) {
      void markChatReadAction(projectId);
      // Читатель пролистал вверх — не дёргаем ленту, показываем плашку.
      if (!atBottomRef.current) setNewCount((count) => count + fromOthers.length);
    } else {
      setUnread((count) => count + fromOthers.length);
    }
  }, [projectId, userId]);

  const applyRef = useRef(applyIncoming);
  useEffect(() => {
    applyRef.current = applyIncoming;
  }, [applyIncoming]);

  // Подписка на Realtime. Без явного setAuth события не приходят вовсе: канал
  // при этом отвечает SUBSCRIBED и ошибок не даёт — самый неприятный вид поломки.
  useEffect(() => {
    const supabase = createBrowserSupabase();
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof supabase.channel> | undefined;

    const authListener = supabase.auth.onAuthStateChange((_event, session) => {
      // После обновления токена подписка продолжает жить только с новым токеном.
      if (session) supabase.realtime.setAuth(session.access_token);
    });

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (disposed) return;
      if (!data.session) {
        setLive("offline");
        return;
      }

      supabase.realtime.setAuth(data.session.access_token);

      // Один канал на всё: сообщения, реакции и присутствие. Presence требует
      // ключ — им служит id пользователя, чтобы вкладки одного человека
      // схлопывались в одну запись.
      const chatChannel = supabase.channel(`project-messages:${projectId}`, {
        config: { presence: { key: userId } },
      });

      chatChannel
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "project_messages", filter: `project_id=eq.${projectId}` },
          (payload) => applyRef.current([payload.new as ChatMessage]),
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "project_messages", filter: `project_id=eq.${projectId}` },
          (payload) => {
            // Правку сделали в другой вкладке или другим участником: заменяем текст.
            const updated = payload.new as ChatMessage;
            if (!knownIds.current.has(updated.id)) return;
            setMessages((current) => mergeMessages(current, [updated]));
          },
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "project_messages" },
          (payload) => {
            // При DELETE приходит только первичный ключ, то есть id сообщения.
            const id = (payload.old as { id?: string } | undefined)?.id;
            if (!id || !knownIds.current.has(id)) return;
            knownIds.current.delete(id);
            setMessages((current) => removeMessage(current, id));
            setReactions((current) => removeMessageReactions(current, id));
            setAttachments((current) => removeMessageAttachments(current, id));
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "project_message_attachments" },
          () => {
            // У нового фото нет подписанной ссылки в событии — перечитываем ленту.
            // Событие приходит и на своё сообщение: дедуп по id не даст дубля.
            void (async () => {
              const result = await loadMessagesAction(projectId);
              if (!result.ok) return;
              applyRef.current(result.messages);
              setReactions(result.reactions);
              setAttachments(result.attachments);
            })();
          },
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "project_message_attachments" },
          (payload) => {
            const id = (payload.old as { id?: string } | undefined)?.id;
            if (!id) return;
            setAttachments((current) => current.filter((item) => item.id !== id));
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "project_message_reactions" },
          (payload) => {
            const reaction = payload.new as ChatReaction;
            // Фильтра по проекту у таблицы нет — берём только загруженные сообщения.
            if (!knownIds.current.has(reaction.message_id)) return;
            setReactions((current) => addReaction(current, reaction));
          },
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "project_message_reactions" },
          (payload) => {
            // При DELETE приходит только первичный ключ: message_id, user_id, emoji.
            const reaction = payload.old as ChatReaction;
            if (!reaction?.message_id || !knownIds.current.has(reaction.message_id)) return;
            setReactions((current) => removeReaction(current, reaction));
          },
        )
        .on("presence", { event: "sync" }, () => {
          setOnline(mapPresence(chatChannel.presenceState() as Record<string, PresenceEntry[]>));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setLive("live");
            if (timeout) clearTimeout(timeout);
            void chatChannel.track({
              user_id: userId,
              full_name: authorNames[userId] ?? "Участник",
            });
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setLive("offline");
            // Список онлайн без канала недостоверен — не показываем старый.
            setOnline([]);
          }
        });

      channel = chatChannel;

      timeout = setTimeout(() => {
        // Подписка не подтвердилась — не делаем вид, что чат живой.
        setLive((current) => (current === "live" ? current : "offline"));
      }, REALTIME_TIMEOUT_MS);
    })();

    return () => {
      disposed = true;
      if (timeout) clearTimeout(timeout);
      authListener.data.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [authorNames, projectId, userId]);

  // Дозапрос работает всегда, а не только при явном offline: подписка умеет
  // рапортовать SUBSCRIBED и молчать (токен Realtime не применился) — тогда
  // чат тихо замирает без единой ошибки. Пока панель открыта, раз в полминуты
  // сверяемся с сервером; без подписки — чаще.
  useEffect(() => {
    if (!open) return;
    const intervalMs = live === "offline" ? POLL_MS : POLL_SAFETY_MS;
    let cancelled = false;
    const tick = async () => {
      const result = await loadMessagesAction(projectId);
      if (cancelled || !result.ok) return;
      applyRef.current(result.messages);
      // Реакции и фото берём с сервера целиком: при опросе это источник истины.
      setReactions(result.reactions);
      setAttachments(result.attachments);
    };
    const interval = setInterval(() => void tick(), intervalMs);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [live, open, projectId]);

  // Открытие = прочитано. Счётчик не обнуляем состоянием: пока панель открыта,
  // бейджа всё равно не видно, а markChatReadAction сдвигает отметку на сервере.
  useEffect(() => {
    if (!open) return;
    void markChatReadAction(projectId);
  }, [open, projectId]);

  // Лента прилипает к низу, только если читатель внизу: иначе он читает
  // историю, а её выдёргивает к последнему сообщению.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current;
    if (!node) return;
    const lastOwn = messages[messages.length - 1]?.author_id === userId;
    if (atBottomRef.current || lastOwn) node.scrollTop = node.scrollHeight;
  }, [messages, open, userId]);

  const onListScroll = useCallback(() => {
    const node = listRef.current;
    if (!node) return;
    const bottom = isNearBottom(node.scrollTop, node.scrollHeight, node.clientHeight);
    atBottomRef.current = bottom;
    if (bottom) setNewCount(0);
  }, []);

  const scrollToBottom = useCallback(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
    atBottomRef.current = true;
    setNewCount(0);
  }, []);

  const groups = useMemo(
    () => groupMessagesByDay(messages, timezone),
    [messages, timezone],
  );

  // Реакции раскладываем по сообщениям один раз, а не на каждой строке.
  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, ChatReaction[]>();
    for (const reaction of reactions) {
      const list = map.get(reaction.message_id) ?? [];
      list.push(reaction);
      map.set(reaction.message_id, list);
    }
    return map;
  }, [reactions]);

  // Фото раскладываем по сообщениям так же, как реакции, — один раз на рендер.
  const photosByMessage = useMemo(() => attachmentsByMessage(attachments), [attachments]);

  // «Онлайн» — все, кроме себя: свой кружок в списке не нужен.
  const othersOnline = useMemo(() => online.filter((user) => user.userId !== userId), [online, userId]);
  const onlineLabel = useMemo(() => {
    // Пока канал не подтверждён, «никого нет» было бы враньём: список ещё пуст.
    if (live !== "live") return null;
    if (othersOnline.length === 0) return "никого нет";
    const names = othersOnline.slice(0, 3).map((user) => user.fullName);
    const rest = othersOnline.length - names.length;
    return rest > 0 ? `${names.join(", ")} и ещё ${rest}` : names.join(", ");
  }, [live, othersOnline]);

  // Все всплывающие окна (пикер эмодзи, реакции, меню сообщения, подтверждение
  // удаления) закрываются по клику мимо и по Esc. Без этого пикер эмодзи висит
  // поверх поля ввода и после отправки закрывает ленту.
  useEffect(() => {
    if (!emojiOpen && !reactionPickerFor && !menuFor && !confirmDeleteFor && !viewerUrl) return;

    const closeAll = () => {
      setEmojiOpen(false);
      setReactionPickerFor(null);
      setMenuFor(null);
      setConfirmDeleteFor(null);
      setViewerUrl(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-chat-popover], [data-chat-popover-toggle]")) return;
      closeAll();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAll();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [emojiOpen, reactionPickerFor, menuFor, confirmDeleteFor, viewerUrl]);

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      if (!canPost) return;
      setReactionPickerFor(null);
      // Оптимистично: счётчик меняется сразу, ответ экшена только подтверждает.
      const previous = reactions;
      setReactions((current) => toggleReaction(current, messageId, emoji, userId));
      try {
        const result = await toggleReactionAction(projectId, messageId, emoji);
        if (!result.ok) {
          setReactions(previous);
          toast.error(result.error);
        }
      } catch {
        setReactions(previous);
        toast.error("Не удалось поставить реакцию. Проверьте связь.");
      }
    },
    [canPost, projectId, reactions, userId],
  );

  /** Открыть правку: текст берём из сообщения, меню закрываем. */
  const startEdit = useCallback((message: ChatMessage) => {
    setEditingFor(message.id);
    setEditText(message.body);
    setMenuFor(null);
    setConfirmDeleteFor(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingFor(null);
    setEditText("");
    setEditSaving(false);
  }, []);

  /** Сохранить правку. Оптимизма нет: правка ждёт ответа, иначе текст прыгает. */
  const saveEdit = useCallback(async () => {
    if (!editingFor || !canPost) return;
    const body = normalizeBody(editText);
    if (!canSend(body)) {
      toast.error("Сообщение не может быть пустым.");
      return;
    }

    setEditSaving(true);
    try {
      const result = await editMessageAction(projectId, editingFor, body);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setMessages((current) => mergeMessages(current, [result.message]));
      cancelEdit();
    } catch {
      toast.error("Не удалось изменить сообщение. Проверьте связь.");
    } finally {
      setEditSaving(false);
    }
  }, [canPost, cancelEdit, editText, editingFor, projectId]);

  /** Удалить: оптимистично, с откатом. Спрашиваем подтверждение заранее. */
  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!canPost) return;
      setConfirmDeleteFor(null);
      setMenuFor(null);

      const previousMessages = messages;
      const previousReactions = reactions;
      const previousAttachments = attachments;
      knownIds.current.delete(messageId);
      setMessages((current) => removeMessage(current, messageId));
      setReactions((current) => removeMessageReactions(current, messageId));
      setAttachments((current) => removeMessageAttachments(current, messageId));

      try {
        const result = await deleteMessageAction(projectId, messageId);
        if (!result.ok) {
          knownIds.current.add(messageId);
          setMessages(previousMessages);
          setReactions(previousReactions);
          setAttachments(previousAttachments);
          toast.error(result.error);
        }
      } catch {
        knownIds.current.add(messageId);
        setMessages(previousMessages);
        setReactions(previousReactions);
        setAttachments(previousAttachments);
        toast.error("Не удалось удалить сообщение. Проверьте связь.");
      }
    },
    [attachments, canPost, messages, projectId, reactions],
  );

  const send = useCallback(async () => {
    const body = normalizeBody(text);
    const files = pending;
    if ((!canSend(body) && files.length === 0) || sending || !canPost) return;

    // Отправили — всплывающие окна больше не нужны: они закрывали бы ленту.
    setEmojiOpen(false);
    setReactionPickerFor(null);

    const id = crypto.randomUUID();
    const optimistic: ChatMessage = {
      id,
      project_id: projectId,
      author_id: userId,
      body,
      created_at: new Date().toISOString(),
    };

    knownIds.current.add(id);
    setMessages((current) => mergeMessages(current, [optimistic]));
    setText("");
    setSending(true);

    // Превью показываем сразу из локального файла: подписанных ссылок ещё нет.
    // У документа превью нет — карточка рисует имя и размер.
    const previews: ChatAttachment[] = files.map((file) => ({
      id: `pending-${file.key}`,
      message_id: id,
      storage_path: "",
      kind: file.kind,
      mime_type: file.mimeType,
      file_name: file.fileName,
      size_bytes: file.blob.size,
      width: file.width,
      height: file.height,
      url: file.previewUrl,
    }));
    if (previews.length > 0) setAttachments((current) => [...current, ...previews]);
    setPending([]);

    try {
      if (files.length === 0) {
        const result = await sendMessageAction(projectId, { id, body });
        if (!result.ok) throw new Error(result.error);
        setMessages((current) => mergeMessages(current, [result.message]));
        return;
      }

      // Сначала байты в Storage, потом одна транзакция «сообщение + вложения».
      setAttachBusy(true);
      const uploaded: {
        path: string;
        kind: "image" | "document";
        mimeType: string;
        fileName: string;
        sizeBytes: number;
        width: number | null;
        height: number | null;
      }[] = [];
      for (const file of files) {
        const start = await startChatAttachmentUploadAction(projectId, id, {
          kind: file.kind,
          mimeType: file.mimeType,
          fileName: file.fileName,
        });
        if (!start.ok) throw new Error(start.error);

        const response = await fetch(start.signedUrl, {
          method: "PUT",
          headers: { "content-type": file.mimeType, "x-upsert": "false" },
          body: file.blob,
        });
        if (!response.ok) throw new Error(CHAT_ATTACHMENT_MESSAGES.uploadFailed);

        uploaded.push({
          path: start.path,
          kind: file.kind,
          mimeType: file.mimeType,
          fileName: file.fileName,
          sizeBytes: file.blob.size,
          width: file.width,
          height: file.height,
        });
      }

      const result = await sendMessageWithAttachmentsAction(projectId, {
        id,
        body,
        attachments: uploaded,
      });
      if (!result.ok) throw new Error(result.error);

      setMessages((current) => mergeMessages(current, [result.message]));
      setAttachments((current) => [
        ...current.filter((item) => item.message_id !== id),
        ...result.attachments,
      ]);
      for (const file of files) {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      }
    } catch (error) {
      // Откат: сообщения нет на сервере, превью убираем, текст и файлы возвращаем.
      knownIds.current.delete(id);
      setMessages((current) => current.filter((message) => message.id !== id));
      setAttachments((current) => removeMessageAttachments(current, id));
      setText(body);
      setPending((current) => [...files, ...current]);
      // Сетевой сбой браузер отдаёт как «Failed to fetch» — показывать это
      // человеку бессмысленно, переводим в понятную фразу.
      const message =
        error instanceof Error && /failed to fetch|networkerror|load failed/i.test(error.message)
          ? "Нет связи. Проверьте интернет и попробуйте ещё раз."
          : error instanceof Error
            ? error.message
            : "Не удалось отправить сообщение.";
      toast.error(message);
    } finally {
      setSending(false);
      setAttachBusy(false);
    }
  }, [canPost, pending, projectId, sending, text, userId]);

  /**
   * Выбор фото: проверка, сжатие в браузере, превью. На сервер ничего не уходит,
   * пока сообщение не отправлено — иначе получились бы файлы-сироты на каждый
   * отменённый выбор.
   */
  const pickFiles = useCallback(
    async (fileList: FileList | null) => {
      // Сначала копируем список в массив и только потом чистим input: FileList
      // живой, привязан к полю, и обнуление value опустошает его — файлы
      // «терялись» ещё до чтения, без единой ошибки в консоли.
      const files = Array.from(fileList ?? []);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (files.length === 0) return;

      // Ошибки сжатия перехвачены внутри цикла, поэтому снимаем флаг после
      // него, без try/finally: других бросков здесь нет.
      setPreparing(true);
      const accepted: PendingAttachment[] = [];
      let count = pending.length;
      for (const file of files) {
        const error = firstAttachmentError(file, count);
        if (error) {
          toast.error(error);
          continue;
        }

        const kind = attachmentKindForFile(file);
        if (kind === null) {
          toast.error(CHAT_ATTACHMENT_MESSAGES.unsupported);
          continue;
        }

        // Документ не сжимаем: PDF и Excel сжимать нельзя, размер у него свой.
        if (kind === "document") {
          const mime = documentMimeFor(file.name);
          if (!mime) {
            toast.error(CHAT_ATTACHMENT_MESSAGES.documentUnsupported);
            continue;
          }
          accepted.push({
            key: crypto.randomUUID(),
            kind: "document",
            mimeType: mime,
            fileName: file.name,
            blob: file,
            previewUrl: null,
            width: null,
            height: null,
          });
          count += 1;
          continue;
        }

        try {
          const compressed = await compressImage(file);
          accepted.push({
            key: crypto.randomUUID(),
            kind: "image",
            mimeType: "image/jpeg",
            fileName: file.name || "photo.jpg",
            blob: compressed.blob,
            previewUrl: URL.createObjectURL(compressed.blob),
            width: compressed.width,
            height: compressed.height,
          });
          count += 1;
        } catch {
          toast.error(CHAT_ATTACHMENT_MESSAGES.unsupported);
        }
      }
      setPreparing(false);
      if (accepted.length > 0) setPending((current) => [...current, ...accepted]);
    },
    [pending.length],
  );

  const removePending = useCallback((key: string) => {
    setPending((current) => {
      const target = current.find((item) => item.key === key);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  }, []);

  const insertEmoji = useCallback(
    (emoji: string) => {
      const element = textareaRef.current;
      const start = element?.selectionStart ?? text.length;
      const end = element?.selectionEnd ?? text.length;
      const next = applyEmoji(text, start, end, emoji);
      setText(next.value);
      const list = recentEmoji(recent, emoji);
      setRecent(list);
      saveRecentEmoji(list);
      requestAnimationFrame(() => {
        element?.focus();
        element?.setSelectionRange(next.caret, next.caret);
      });
    },
    [recent, text],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => persistOpen(true)}
        aria-label={unread > 0 ? `Чат проекта, непрочитанных: ${unread}` : "Открыть чат проекта"}
        // Toaster живёт снизу по центру — держим кнопку правее и выше safe-area.
        className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex size-12 items-center justify-center rounded-full bg-brand text-white shadow-[0_6px_18px_rgba(20,30,50,0.22)] transition-transform duration-120 hover:scale-[1.04] active:scale-95"
      >
        <ChatIcon size={19} strokeWidth={1.6} />
        {othersOnline.length > 0 ? (
          // Зелёная точка — «в чате есть кто-то ещё». Без цифры: цифра на кнопке
          // уже занята непрочитанным, путать их нельзя.
          <span
            aria-hidden
            className="absolute -bottom-0.5 -left-0.5 size-2.5 rounded-full border-2 border-surface bg-status-done-fg"
          />
        ) : null}
        {unread > 0 ? (
          <span className="absolute -top-1 -right-1 flex min-w-[18px] items-center justify-center rounded-full bg-status-alert-fg px-1 text-[10.5px] leading-[18px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
    );
  }

  const category = EMOJI_CATEGORIES.find((item) => item.id === emojiCategory) ?? EMOJI_CATEGORIES[0];

  return (
    <section
      aria-label="Чат проекта"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[46dvh] flex-col overflow-hidden rounded-t-2xl border border-line-strong bg-surface shadow-[0_-8px_30px_rgba(20,30,50,0.18)] md:inset-x-auto md:right-4 md:bottom-[calc(1rem+env(safe-area-inset-bottom))] md:h-[36dvh] md:max-h-[440px] md:w-[364px] md:rounded-2xl md:shadow-[0_12px_40px_rgba(20,30,50,0.22)]"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line-strong px-3 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-[12.5px] font-semibold text-ink">Чат проекта</span>
          {live === "offline" ? (
            <span className="text-[11px] text-meta" title="Realtime недоступен — сообщения подтягиваются раз в 15 секунд">
              обновление с задержкой · кто онлайн неизвестно
            </span>
          ) : onlineLabel ? (
            <span className="truncate text-[11px] text-meta" title={onlineLabel}>
              онлайн: {onlineLabel}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Свернуть чат"
          onClick={() => persistOpen(false)}
        >
          <CloseIcon size={13} />
        </Button>
      </header>

      <div
        ref={listRef}
        onScroll={onListScroll}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-page/60 px-2.5 py-2"
      >
        {groups.length === 0 ? (
          <p className="m-auto max-w-[220px] text-center text-[12px] text-meta">
            Сообщений пока нет. Напишите первым.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.day} className="flex flex-col gap-1">
              <span className="self-center rounded-full bg-page px-2 py-0.5 text-[10.5px] text-meta">
                {group.label}
              </span>
              {group.messages.map((message, index) => {
                const own = isOwnMessage(message, userId);
                const previous = index > 0 ? group.messages[index - 1] : null;
                // Имя — только над первой репликой подряд от одного человека:
                // иначе в длинной переписке оно повторяется на каждой строке.
                const showAuthor = shouldShowAuthor(previous, message, userId);
                const messageFiles = photosByMessage.get(message.id) ?? [];
                const { images, files: documents } = splitAttachments(messageFiles);
                // Крупный эмодзи — только когда вложений нет: иначе шрифт боролся бы с картинкой.
                const jumbo = messageFiles.length > 0 ? null : jumboSize(message.body);
                const summary = summarizeReactions(reactionsByMessage.get(message.id) ?? [], userId);
                // Время — только у последнего сообщения в серии от одного автора:
                // под каждой строкой оно превращало ленту в столбик отметок.
                const next = index + 1 < group.messages.length ? group.messages[index + 1] : null;
                const lastInRun = !next || next.author_id !== message.author_id;
                // Первое сообщение серии от одного автора: у остальных скругляем
                // верхний угол со своей стороны, чтобы серия читалась блоком.
                const firstInRun = !previous || previous.author_id !== message.author_id;
                return (
                  <div
                    key={message.id}
                    className={cn(
                      "group flex flex-col",
                      own ? "items-end" : "items-start",
                      // Серия от одного автора идёт плотно: отступ только между сериями.
                      firstInRun ? "mt-1.5" : "mt-0",
                    )}
                  >
                    {showAuthor ? (
                      <span className="mb-0.5 flex items-center gap-1 text-[10.5px] font-medium text-meta">
                        {own ? null : (
                          <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-brand/15 text-[8.5px] font-semibold text-brand">
                            {authorInitials(authorNames[message.author_id])}
                          </span>
                        )}
                        {authorNameOf(authorNames[message.author_id])}
                      </span>
                    ) : null}
                    {editingFor === message.id ? (
                      // Правка прямо в ленте: сохранить — Enter, отмена — Esc.
                      <div className="flex w-full max-w-[85%] flex-col gap-1.5 rounded-[12px] border border-line-strong bg-surface p-2">
                        <textarea
                          value={editText}
                          onChange={(event) => setEditText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault();
                              void saveEdit();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              cancelEdit();
                            }
                          }}
                          rows={3}
                          autoFocus
                          disabled={editSaving}
                          aria-label="Изменить сообщение"
                          className="min-h-[56px] w-full resize-none bg-transparent text-[12.5px] text-ink outline-none"
                        />
                        <div className="flex items-center gap-1.5">
                          <Button type="button" size="sm" disabled={editSaving} onClick={() => void saveEdit()}>
                            Сохранить
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={editSaving}
                            onClick={cancelEdit}
                          >
                            Отмена
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "flex flex-col gap-1 break-words whitespace-pre-wrap",
                          // Крупный эмодзи — без пузыря и без ограничения ширины: в
                          // цветной плашке он читается как иконка, а max-w режет глиф.
                          jumbo
                            ? "bg-transparent p-0 text-ink"
                            : own
                              ? cn(
                                  "max-w-[85%] items-end rounded-[14px] rounded-br-[5px] bg-brand px-2.5 py-1.5 text-[12.5px] text-white",
                                  firstInRun ? "" : "rounded-tr-[5px]",
                                )
                              : cn(
                                  "max-w-[85%] items-start rounded-[14px] rounded-bl-[5px] border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-ink",
                                  firstInRun ? "" : "rounded-tl-[5px]",
                                ),
                          // Фото снимают внутренние отступы: картинка должна доходить до края.
                          images.length > 0 && "max-w-[85%] p-1",
                        )}
                      >
                        {images.length > 0 ? (
                          <div
                            className={cn(
                              "grid w-[196px] max-w-full gap-1",
                              attachmentGridClass(images.length),
                            )}
                          >
                            {images.map((photo) => (
                              <button
                                key={photo.id}
                                type="button"
                                disabled={!photo.url}
                                onClick={() => setViewerUrl(photo.url)}
                                aria-label="Открыть фото"
                                className="overflow-hidden rounded-[8px] bg-page"
                              >
                                {photo.url ? (
                                  // eslint-disable-next-line @next/next/no-img-element -- подписанный URL из Storage, next/image тут не нужен
                                  <img
                                    src={photo.url}
                                    alt="Фото в сообщении"
                                    className={cn(
                                      "w-full object-cover",
                                      images.length === 1 ? "max-h-[196px]" : "aspect-square",
                                    )}
                                  />
                                ) : (
                                  <span className="flex aspect-square items-center justify-center text-[10.5px] text-meta">
                                    фото
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {documents.length > 0 ? (
                          <div className="flex w-[240px] max-w-full flex-col gap-1 px-1.5 pt-0.5">
                            {documents.map((doc) => (
                              <a
                                key={doc.id}
                                href={doc.url ?? undefined}
                                download={doc.file_name ?? undefined}
                                target="_blank"
                                rel="noreferrer"
                                className={cn(
                                  "flex items-center gap-2 rounded-[8px] border px-2 py-1.5 text-[11.5px] transition-colors",
                                  own
                                    ? "border-white/30 text-white hover:bg-white/10"
                                    : "border-line-strong bg-surface text-ink hover:bg-page",
                                  !doc.url && "pointer-events-none opacity-60",
                                )}
                              >
                                <span className="shrink-0 text-[14px] leading-none">📄</span>
                                <span className="min-w-0 flex-1 truncate">
                                  {doc.file_name ?? "Документ"}
                                </span>
                                <span className="shrink-0 text-[10.5px] opacity-70">
                                  {formatFileSize(doc.size_bytes)}
                                </span>
                              </a>
                            ))}
                          </div>
                        ) : null}
                        {message.body ? (
                          <span className={jumbo ? `${jumbo} align-middle` : undefined}>
                            {message.body}
                          </span>
                        ) : null}
                        {/* Время — внутри пузыря, как в мессенджерах: строка под
                            пузырём делала ленту выше и «обвешанной». */}
                        {!jumbo && lastInRun ? (
                          <span
                            className={cn(
                              "mt-0.5 self-end text-[9.5px] leading-none",
                              own ? "text-white/70" : "text-meta",
                            )}
                          >
                            {messageTime(message.created_at, timezone)}
                          </span>
                        ) : null}
                      </div>
                    )}
                    <div className={cn("mt-0.5 flex items-center gap-1", own && "flex-row-reverse")}>
                      {summary.map((reaction) => (
                        <button
                          key={reaction.emoji}
                          type="button"
                          disabled={!canPost}
                          onClick={() => void react(message.id, reaction.emoji)}
                          aria-label={`${reaction.emoji}: ${reaction.count}`}
                          aria-pressed={reaction.mine}
                          className={cn(
                            "flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors",
                            reaction.mine
                              ? "border-brand bg-brand/10 text-ink"
                              : "border-line-strong bg-surface text-meta hover:bg-page",
                            !canPost && "cursor-default",
                          )}
                        >
                          <span className="text-[12px] leading-none">{reaction.emoji}</span>
                          <span className="tabular-nums">{reaction.count}</span>
                        </button>
                      ))}
                      {canPost ? (
                        reactionPickerFor === message.id ? (
                          <div
                            data-chat-popover
                            className="flex items-center gap-0.5 rounded-full border border-line-strong bg-surface px-1 py-0.5 shadow-[0_4px_14px_rgba(20,30,50,0.14)]"
                          >
                            {REACTION_EMOJI.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                aria-label={`Реакция ${emoji}`}
                                onClick={() => void react(message.id, emoji)}
                                className="rounded-full px-1 text-[14px] leading-none transition-transform hover:scale-110"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <button
                            type="button"
                            aria-label="Поставить реакцию"
                            data-chat-popover-toggle
                            onClick={() => {
                              setEmojiOpen(false);
                              setReactionPickerFor((current) =>
                                current === message.id ? null : message.id,
                              );
                            }}
                            className="flex size-[18px] items-center justify-center rounded-full border border-line-strong bg-surface text-[12px] leading-none text-meta transition-opacity hover:bg-page md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:group-focus-within:opacity-100"
                          >
                            +
                          </button>
                        )
                      ) : null}
                      {jumbo && lastInRun ? (
                        <span className="text-[10px] text-meta">
                          {messageTime(message.created_at, timezone)}
                        </span>
                      ) : null}
                      {/* Отметку «изменено» ставит триггер (0036), клиент только читает. */}
                      {isEdited(message) ? (
                        <span className="text-[10px] text-meta">изменено</span>
                      ) : null}
                      {own && canPost ? (
                        confirmDeleteFor === message.id ? (
                          <span
                            data-chat-popover
                            className="flex items-center gap-1 rounded-full border border-line-strong bg-surface px-1.5 py-0.5 text-[10.5px] text-meta shadow-[0_4px_14px_rgba(20,30,50,0.14)]"
                          >
                            Удалить?
                            <button
                              type="button"
                              onClick={() => void deleteMessage(message.id)}
                              className="text-status-alert-fg hover:underline"
                            >
                              Да
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteFor(null)}
                              className="hover:underline"
                            >
                              Нет
                            </button>
                          </span>
                        ) : menuFor === message.id ? (
                          <span
                            data-chat-popover
                            className="flex items-center gap-1 rounded-full border border-line-strong bg-surface px-1.5 py-0.5 text-[10.5px] text-meta shadow-[0_4px_14px_rgba(20,30,50,0.14)]"
                          >
                            <button
                              type="button"
                              onClick={() => startEdit(message)}
                              className="hover:underline"
                            >
                              Изменить
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMenuFor(null);
                                setConfirmDeleteFor(message.id);
                              }}
                              className="text-status-alert-fg hover:underline"
                            >
                              Удалить
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            aria-label="Действия с сообщением"
                            data-chat-popover-toggle
                            onClick={() => {
                              // Открывая меню, закрываем остальные всплывающие окна.
                              setEmojiOpen(false);
                              setReactionPickerFor(null);
                              setConfirmDeleteFor(null);
                              setMenuFor((current) => (current === message.id ? null : message.id));
                            }}
                            className="flex size-[18px] items-center justify-center rounded-full border border-line-strong bg-surface text-[11px] leading-none text-meta transition-opacity hover:bg-page md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:group-focus-within:opacity-100"
                          >
                            ⋯
                          </button>
                        )
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Плашка вместо прыжка вниз: сообщения пришли, пока читали историю. */}
      {newCount > 0 ? (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-[64px] left-1/2 z-10 -translate-x-1/2 rounded-full bg-brand px-3 py-1 text-[11px] font-medium text-white shadow-[0_6px_18px_rgba(20,30,50,0.25)]"
        >
          Новые сообщения: {newCount} ↓
        </button>
      ) : null}

      {canPost ? (
        <div className="shrink-0 border-t border-line-strong px-2 py-2">
          {/* Выбранные файлы видны до отправки: можно убрать лишнее, пока не ушло. */}
          {preparing ? (
            <p className="mb-1 text-[11px] text-meta">Готовим файлы…</p>
          ) : null}
          {pending.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {pending.map((file) => (
                <div key={file.key} className="relative">
                  {file.kind === "document" || !file.previewUrl ? (
                    <div className="flex h-12 w-[136px] flex-col justify-center rounded-[6px] border border-line-strong bg-surface px-1.5">
                      <span className="truncate text-[10.5px] text-ink">
                        {file.fileName}
                      </span>
                      <span className="text-[10px] text-meta">{formatFileSize(file.blob.size)}</span>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- локальное превью из object URL
                    <img
                      src={file.previewUrl}
                      alt="Выбранное фото"
                      className="size-12 rounded-[6px] object-cover"
                    />
                  )}
                  <button
                    type="button"
                    aria-label={`Убрать ${file.kind === "document" ? "файл" : "фото"}`}
                    onClick={() => removePending(file.key)}
                    className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-status-alert-fg text-[9px] leading-none text-white"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="relative flex items-end gap-0.5 rounded-[22px] border border-line-strong bg-page px-1 py-0.5 focus-within:border-brand">
          {emojiOpen ? (
            <div
              data-chat-popover
              className="absolute right-2 bottom-[calc(100%-2px)] z-10 w-[286px] rounded-lg border border-line-strong bg-surface p-2 shadow-[0_10px_30px_rgba(20,30,50,0.18)]"
            >
              <div className="mb-1.5 flex flex-wrap gap-1">
                {recent.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setEmojiCategory("recent")}
                    className={`rounded px-1.5 py-0.5 text-[11px] ${emojiCategory === "recent" ? "bg-page text-ink" : "text-meta hover:bg-page"}`}
                  >
                    Частые
                  </button>
                ) : null}
                {EMOJI_CATEGORIES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setEmojiCategory(item.id)}
                    className={`rounded px-1.5 py-0.5 text-[11px] ${emojiCategory === item.id ? "bg-page text-ink" : "text-meta hover:bg-page"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="grid max-h-[168px] grid-cols-8 gap-0.5 overflow-y-auto">
                {(emojiCategory === "recent" ? recent : (category?.items ?? [])).map((emoji, index) => (
                  <button
                    key={`${emoji}-${index}`}
                    type="button"
                    onClick={() => insertEmoji(emoji)}
                    className="rounded p-1 text-[16px] leading-none hover:bg-page"
                    aria-label={`Вставить ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept={`image/*,${CHAT_DOCUMENT_TYPES.map((type) => `.${type.extension}`).join(",")}`}
            multiple
            className="hidden"
            onChange={(event) => void pickFiles(event.target.files)}
          />

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Прикрепить фото"
            disabled={preparing || attachBusy || pending.length >= MAX_ATTACHMENTS_PER_MESSAGE || sending}
            onClick={() => fileInputRef.current?.click()}
          >
            <AttachIcon size={15} />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Эмодзи"
            data-chat-popover-toggle
            onClick={() => {
              // Открывая один, закрываем другой: два окна друг на друге не нужны.
              setReactionPickerFor(null);
              setEmojiOpen((value) => !value);
            }}
          >
            <span className="text-[15px] leading-none">🙂</span>
          </Button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, CHAT_BODY_MAX))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Сообщение…"
            aria-label="Текст сообщения"
            className="max-h-24 min-h-[30px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[12.5px] leading-snug text-ink outline-none placeholder:text-meta"
          />

          <Button
            type="button"
            size="sm"
            className="mb-0.5 shrink-0 rounded-full px-3"
            disabled={(!canSend(text) && pending.length === 0) || sending}
            onClick={() => void send()}
          >
            {attachBusy ? "Грузим…" : "Отправить"}
          </Button>
          </div>
        </div>
      ) : (
        <p className="shrink-0 border-t border-line-strong px-3 py-2 text-[11.5px] text-meta">
          Только просмотр: писать в чат могут владелец и редактор.
        </p>
      )}
      {viewerUrl ? (
        <div
          role="dialog"
          aria-label="Просмотр фото"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setViewerUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- подписанный URL из Storage */}
          <img src={viewerUrl} alt="Фото" className="max-h-full max-w-full rounded-[8px] object-contain" />
          <button
            type="button"
            aria-label="Закрыть фото"
            onClick={(event) => {
              event.stopPropagation();
              setViewerUrl(null);
            }}
            className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-white/90 text-ink"
          >
            <CloseIcon size={15} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
