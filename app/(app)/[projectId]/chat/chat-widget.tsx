"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AttachIcon,
  ChatIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ReplyIcon,
  SearchIcon,
} from "@/components/common/icons";
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
  CHAT_PAGE_SIZE,
  activeMentionQuery,
  applyMention,
  authorInitials,
  REACTION_EMOJI,
  addReaction,
  applyEmoji,
  attachmentGridClass,
  attachmentsByMessage,
  authorNameOf,
  canSend,
  groupMessagesByDay,
  highlightParts,
  mergeAttachments,
  mergeOlderMessages,
  mergeReactions,
  replacePageAttachments,
  replacePageReactions,
  isEdited,
  isOwnMessage,
  isNearBottom,
  jumboSize,
  mapPresence,
  mentionParts,
  mergeMessages,
  photoGallery,
  stepPhotoIndex,
  fromChatRow,
  quotePreview,
  messageTime,
  normalizeBody,
  searchSnippet,
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
  type ChatMessageRow,
  type ChatReaction,
  type OnlineUser,
  type PresenceEntry,
} from "@/lib/business/chat";
import { compressImage } from "@/lib/attachments/compress-image";
import { formatDateNumeric } from "@/lib/business/dates";
import { EMOJI_CATEGORIES, readRecentEmoji, recentEmoji, saveRecentEmoji } from "@/lib/business/emoji";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import {
  deleteMessageAction,
  editMessageAction,
  loadMessagesAction,
  markChatReadAction,
  searchMessagesAction,
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
const POLL_SAFETY_MS = 15000;
// Свёрнутый чат: только чтобы не пропустить новые сообщения и обновить бейдж.
const POLL_CLOSED_MS = 30000;

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
  /** Упомянули ли вас среди непрочитанных — бейдж покажет «@» сразу, без ожидания. */
  initialMentioned: boolean;
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
  initialMentioned,
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
  // Фокус в поле ввода — для подсказки про Enter.
  const [composerFocused, setComposerFocused] = useState(false);
  // Просмотрщик: выбранное фото хранится по id, а не по индексу. Так дозагрузка
  // старых сообщений сверху не подменяет открытый снимок соседним.
  const [viewerPhotoId, setViewerPhotoId] = useState<string | null>(null);
  // Свайп по фото: запоминаем точку нажатия, чтобы отличить листание от тапа.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  // После свайпа браузер всё равно шлёт click — его нельзя считать «закрыть».
  const swipeAteClick = useRef(false);
  const [unread, setUnread] = useState(initialUnread);
  // Ответ на сообщение: полоса над полем ввода и цитата в будущем пузыре.
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  // Есть ли ещё более ранние сообщения: пока сервер не сказал иначе, считаем,
  // что полная страница значит «возможно, дальше что-то есть».
  const [hasMore, setHasMore] = useState(initialMessages.length >= CHAT_PAGE_SIZE);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  // «Новые сообщения»: сколько пришло, пока читатель листал историю выше.
  const [newCount, setNewCount] = useState(0);
  const atBottomRef = useRef(true);
  /** Позиция до вставки истории: высоту компенсируем сразу после рендера. */
  const restoreRef = useRef<{ height: number; top: number } | null>(null);
  // Была ли панель открыта в прошлом проходе: при открытии лента должна
  // оказаться внизу, даже если новых сообщений не пришло.
  const wasOpenRef = useRef(false);
  const lastIdRef = useRef<string | null>(initialMessages.at(-1)?.id ?? null);
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
  // Поиск по переписке: под шапкой строка ввода, результаты заменяют ленту.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<ChatMessage[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  // Долистываем историю к найденному сообщению — это заметно дольше запроса.
  const [jumpBusy, setJumpBusy] = useState(false);
  // Сообщение, к которому только что прыгнули: подсветка гаснет сама.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Упоминания: что набрано после «@» и какой пункт списка подсвечен.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  // Среди непрочитанных есть сообщение с упоминанием вас — бейдж показывает «@».
  const [mentionUnread, setMentionUnread] = useState(initialMentioned);

  const openRef = useRef(open);
  const knownIds = useRef(new Set(initialMessages.map((message) => message.id)));
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  /**
   * Имена всех участников, включая себя: разбор упоминаний должен узнавать и
   * своё имя, иначе «упомянули вас» не определить. Себя убирает только список
   * подсказок — приглашать в чат самого себя незачем.
   */
  const myName = authorNames[userId] ?? null;
  const memberNames = useMemo(
    () =>
      Object.entries(authorNames)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
        .map(([, name]) => name.trim()),
    [authorNames],
  );
  const mentionsMe = useCallback(
    (body: string) =>
      myName !== null &&
      mentionParts(body, memberNames, myName).some((part) => part.mention && part.isMe),
    [memberNames, myName],
  );

  const persistOpen = useCallback(
    (next: boolean) => {
      // Свернули панель — всплывающие окна не должны ждать следующего открытия.
      if (!next) {
        setEmojiOpen(false);
        setReactionPickerFor(null);
        // Поиск тоже закрываем: иначе при следующем открытии чата вместо
        // переписки покажутся старые результаты.
        setSearchOpen(false);
        setSearchText("");
        setSearchResults(null);
        setSearchError(null);
        setSearching(false);
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
      // Прочитали, пока чат открыт: сообщаем значку сразу, иначе число
      // на иконке висело до перехода на другую страницу.
      void markChatReadAction(projectId).then((result) => {
        if (!result.ok) return;
        window.dispatchEvent(new Event("planner:chat-read"));
      });
      // Читатель пролистал вверх — не дёргаем ленту, показываем плашку.
      if (!atBottomRef.current) setNewCount((count) => count + fromOthers.length);
    } else {
      setUnread((count) => count + fromOthers.length);
      // Упомянули — бейдж покажет «@» вместо числа: адресное сообщение важнее.
      if (fromOthers.some((message) => mentionsMe(message.body))) setMentionUnread(true);
    }
  }, [mentionsMe, projectId, userId]);

  const applyRef = useRef(applyIncoming);
  useEffect(() => {
    applyRef.current = applyIncoming;
  }, [applyIncoming]);

  /** Пересчитать «@фрагмент» под кареткой: список обновляется и при движении каретки. */
  const syncMention = useCallback((value: string, caret: number | null) => {
    setMentionQuery(activeMentionQuery(value, caret ?? value.length));
    setMentionIndex(0);
  }, []);

  /** Кого предложить: имя начинается с набранного, себя в списке нет. */
  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.trim().toLowerCase();
    const self = myName?.trim().toLowerCase() ?? "";
    return memberNames
      .filter((name) => name.toLowerCase() !== self && name.toLowerCase().startsWith(query))
      .slice(0, 5);
  }, [memberNames, mentionQuery, myName]);

  const chooseMention = useCallback(
    (name: string) => {
      const element = textareaRef.current;
      const caret = element?.selectionStart ?? text.length;
      const next = applyMention(text, caret, name);
      setText(next.value.slice(0, CHAT_BODY_MAX));
      setMentionQuery(null);
      // Поле остаётся в фокусе, каретка — сразу за именем.
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(next.caret, next.caret);
      });
    },
    [text],
  );

  // Подписка на Realtime. Без явного setAuth события не приходят вовсе: канал
  // при этом отвечает SUBSCRIBED и ошибок не даёт — самый неприятный вид поломки.
  useEffect(() => {
    const supabase = createBrowserSupabase();
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let presenceRef: ReturnType<typeof supabase.channel> | undefined;

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

      // Ждём именно применения токена: setAuth асинхронный, а подписка ниже
      // фиксирует RLS-контекст в момент subscribe. Подписавшись до токена,
      // канал получает SUBSCRIBED и не доставляет ни одного события — молча.
      await supabase.realtime.setAuth(data.session.access_token);

      // Канал переиспользуется по имени: после повторного монтирования (dev
      // делает его дважды) можно получить тот же объект, который предыдущая
      // копия эффекта уже сняла на сервере. Такой «зомби» рапортует joined и
      // не доставляет ни одного события. Сносим старый канал той же темы.
      // ЭКСПЕРИМЕНТ: уникальное имя канала на каждое монтирование.
      const topic = `project-messages:${projectId}:${Math.random().toString(36).slice(2)}`;


      // Один канал на всё: сообщения, реакции и присутствие. Presence требует
      // ключ — им служит id пользователя, чтобы вкладки одного человека
      // схлопывались в одну запись.
      const chatChannel = supabase.channel(topic);

      // Presence живёт в отдельном канале с постоянным именем: имя канала
      // сообщений уникально на монтирование (иначе supabase-js переиспользует
      // «зомби»-канал и тот молча не доставляет), а присутствию нужно общее имя.
      const presenceChannel = supabase.channel(`chat-presence:${projectId}`, {
        config: { presence: { key: userId } },
      });

      presenceRef = presenceChannel;

      presenceChannel
        .on("presence", { event: "sync" }, () => {
          setOnline(mapPresence(presenceChannel.presenceState() as Record<string, PresenceEntry[]>));
        })
        .subscribe((status) => {
          if (status !== "SUBSCRIBED") return;
          void presenceChannel.track({
            user_id: userId,
            full_name: authorNames[userId] ?? "Участник",
          });
        });

      chatChannel
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "project_messages", filter: `project_id=eq.${projectId}` },
          (payload) => {
            applyRef.current([fromChatRow(payload.new as ChatMessageRow)]);
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "project_messages", filter: `project_id=eq.${projectId}` },
          (payload) => {
            // Правку сделали в другой вкладке или другим участником: заменяем текст.
            const updated = fromChatRow(payload.new as ChatMessageRow);
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
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setLive("live");
            if (timeout) clearTimeout(timeout);
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
      if (presenceRef) void supabase.removeChannel(presenceRef);
    };
  }, [authorNames, projectId, userId]);

  // Дозапрос работает всегда, а не только при явном offline: подписка умеет
  // рапортовать SUBSCRIBED и молчать (токен Realtime не применился) — тогда
  // чат тихо замирает без единой ошибки. Пока панель открыта, раз в полминуты
  // сверяемся с сервером; без подписки — чаще.
  useEffect(() => {
    // Свёрнутая панель тоже опрашивается — иначе счётчик непрочитанного
    // застывает на значении из серверного рендера и новых сообщений не видно.
    const intervalMs = !open ? POLL_CLOSED_MS : live === "offline" ? POLL_MS : POLL_SAFETY_MS;
    let cancelled = false;
    const tick = async () => {
      const result = await loadMessagesAction(projectId);
      if (cancelled || !result.ok) return;
      applyRef.current(result.messages);
      // Реакции и фото этой страницы берём с сервера целиком — там источник
      // истины (реакцию могли снять с другого устройства). Записи догруженной
      // истории опрос не знает и трогать не должен, иначе они бы исчезали.
      const pageIds = result.messages.map((message) => message.id);
      setReactions((current) => replacePageReactions(current, result.reactions, pageIds));
      setAttachments((current) => replacePageAttachments(current, result.attachments, pageIds));
    };
    const interval = setInterval(() => void tick(), intervalMs);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [live, open, projectId]);

  // Открытие = прочитано. Отметку на сервере сдвигаем сразу, а счётчик
  // обнуляем по её завершении: иначе после «открыл → свернул» бейдж и волна
  // вокруг кнопки показывают уже прочитанное число.
  useEffect(() => {
    if (!open) return;
    void markChatReadAction(projectId).then((result) => {
      if (!result.ok) return;
      setUnread(0);
      setMentionUnread(false);
      // Значок на иконке приложения и вкладке пересчитывает итог по всем
      // проектам — говорим ему, что здесь прочитано, не дожидаясь опроса.
      window.dispatchEvent(new Event("planner:chat-read"));
    });
  }, [open, projectId]);

  // Поле ввода растёт по содержимому до 96 px (max-h-24), дальше — внутренний
  // скролл. Высоту сбрасываем в auto перед чтением scrollHeight: без сброса
  // она не уменьшается, когда текст стирают. setState здесь не нужен —
  // правим style напрямую, поэтому правило set-state-in-effect не нарушается.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 96)}px`;
    node.style.overflowY = node.scrollHeight > 96 ? "auto" : "hidden";
  }, [text, open]);

  // Вставка истории в начало: компенсируем прирост высоты в том же кадре,
  // до отрисовки. Без этого читаемое сообщение уехало бы вниз на высоту
  // догруженных — ровно на столько вырос scrollHeight.
  useLayoutEffect(() => {
    const pending = restoreRef.current;
    if (!pending) return;
    restoreRef.current = null;
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = pending.top + (node.scrollHeight - pending.height);
  }, [messages]);

  // Лента прилипает к низу, только если читатель внизу: иначе он читает
  // историю, а её выдёргивает к последнему сообщению. Прыжок — только на
  // действительно новое сообщение (подгрузка истории последнее не меняет)
  // или на открытие панели.
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    const node = listRef.current;
    if (!node) return;
    const lastId = messages.at(-1)?.id ?? null;
    const justOpened = !wasOpenRef.current;
    wasOpenRef.current = true;
    const appended = lastId !== lastIdRef.current;
    lastIdRef.current = lastId;
    const lastOwn = messages.at(-1)?.author_id === userId;
    if (justOpened || (appended && (atBottomRef.current || lastOwn))) {
      node.scrollTop = node.scrollHeight;
    }
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

  /**
   * Более ранняя страница. Позицию держим вручную: после вставки в начало
   * scrollHeight вырастает на высоту новых сообщений, и без компенсации
   * читаемое уехало бы вниз ровно на столько же.
   */
  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    // Ref, а не состояние: двойной клик успевает пройти до перерисовки.
    if (loadingOlderRef.current || !hasMore || !oldest) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const result = await loadMessagesAction(projectId, {
        createdAt: oldest.created_at,
        id: oldest.id,
      });
      if (!result.ok) {
        toast.error("Не удалось загрузить историю");
        return;
      }

      for (const message of result.messages) knownIds.current.add(message.id);
      // Позицию запоминаем в ref: layout-эффект вернёт её сразу после вставки
      // узлов, в том же кадре — до того, как читатель увидит прыжок. Высоту
      // читаем здесь, а не до запроса: за время ответа могли прийти новые.
      const node = listRef.current;
      if (result.messages.length > 0 && node) {
        restoreRef.current = { height: node.scrollHeight, top: node.scrollTop };
      }
      setMessages((current) => mergeOlderMessages(current, result.messages));
      setReactions((current) => mergeReactions(current, result.reactions));
      setAttachments((current) => mergeAttachments(current, result.attachments));
      setHasMore(result.hasMore);
    } catch {
      toast.error("Не удалось загрузить историю");
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [hasMore, messages, projectId]);

  // Поиск с задержкой: пока человек печатает, запросы к серверу не нужны.
  // setState стоит внутри таймера, а не в теле эффекта: синхронный setState
  // в эффекте запрещён правилом react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!searchOpen) return;
    const term = searchText.trim();
    if (term.length < 2) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      void searchMessagesAction(projectId, term)
        .then((result) => {
          if (cancelled) return;
          setSearching(false);
          if (result.ok) {
            setSearchResults(result.messages);
            setSearchError(null);
          } else {
            setSearchResults([]);
            setSearchError(result.error);
          }
        })
        .catch(() => {
          if (cancelled) return;
          setSearching(false);
          setSearchResults([]);
          setSearchError("Нет связи. Проверьте интернет и попробуйте ещё раз.");
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchOpen, searchText, projectId]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchText("");
    setSearchResults(null);
    setSearchError(null);
    setSearching(false);
  }, []);

  const toggleSearch = useCallback(() => {
    if (searchOpen) {
      closeSearch();
      return;
    }
    setSearchOpen(true);
    // Поле появляется в этом же рендере — фокус ставим после него.
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [closeSearch, searchOpen]);

  /**
   * Переход к найденному сообщению. Если его нет в загруженной ленте, догружаем
   * историю страницами, пока не найдём, — иначе поиск находил бы то, до чего
   * нельзя долистать. Десяти страниц (500 сообщений) хватает с запасом.
   */
  const jumpToMessage = useCallback(
    async (id: string) => {
      closeSearch();

      let list = messages;
      let older = hasMore;
      let cursor = list[0] ? { createdAt: list[0].created_at, id: list[0].id } : null;
      let found = list.some((message) => message.id === id);
      let pages = 0;

      setJumpBusy(true);
      try {
        while (!found && older && cursor && pages < 10) {
          const result = await loadMessagesAction(projectId, cursor);
          if (!result.ok) break;
          pages += 1;
          list = mergeOlderMessages(list, result.messages);
          found = list.some((message) => message.id === id);
          older = result.hasMore;
          cursor = list[0] ? { createdAt: list[0].created_at, id: list[0].id } : null;
          if (result.messages.length === 0) break;
        }

        if (!found) {
          // Всё равно показываем догруженное: человек увидит хоть что-то новое.
          setMessages(list);
          toast.error("Сообщение слишком старое — не удалось долистать");
          return;
        }

        setMessages(list);
        // Даём React отрисовать догруженные узлы, иначе искать в DOM нечего.
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const element = listRef.current?.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
        element?.scrollIntoView({ block: "center" });
        setHighlightId(id);
        setTimeout(() => setHighlightId((current) => (current === id ? null : current)), 2200);
      } finally {
        setJumpBusy(false);
      }
    },
    [closeSearch, hasMore, messages, projectId],
  );

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

  // Лента фото чата: по ней листается полноэкранный просмотр (←/→ и свайп).
  const gallery = useMemo(
    () => photoGallery(messages.map((message) => message.id), photosByMessage),
    [messages, photosByMessage],
  );

  // -1 — просмотрщик закрыт либо фото исчезло (сообщение удалили).
  const viewerIndex =
    viewerPhotoId === null ? -1 : gallery.findIndex((photo) => photo.id === viewerPhotoId);

  const stepViewer = useCallback(
    (step: number) => {
      if (gallery.length === 0) return;
      const next = gallery[stepPhotoIndex(Math.max(viewerIndex, 0), gallery.length, step)];
      if (next) setViewerPhotoId(next.id);
    },
    [gallery, viewerIndex],
  );

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
    if (!emojiOpen && !reactionPickerFor && !menuFor && !confirmDeleteFor) return;

    const closeAll = () => {
      setEmojiOpen(false);
      setReactionPickerFor(null);
      setMenuFor(null);
      setConfirmDeleteFor(null);
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
  }, [emojiOpen, reactionPickerFor, menuFor, confirmDeleteFor]);

  // Просмотрщик фото живёт отдельно от всплывающих окон: клик внутри него
  // (стрелки, свайп) не должен его закрывать. Esc — закрыть, ←/→ — листать.
  useEffect(() => {
    if (viewerIndex < 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewerPhotoId(null);
      else if (event.key === "ArrowLeft") stepViewer(-1);
      else if (event.key === "ArrowRight") stepViewer(1);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [viewerIndex, stepViewer]);

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
    // Снимаем адресата в момент отправки: пока идёт запрос, полосу могут закрыть.
    const replyTarget = replyTo;
    if ((!canSend(body) && files.length === 0) || sending || !canPost) return;

    // Отправили — всплывающие окна больше не нужны: они закрывали бы ленту.
    setEmojiOpen(false);
    setReactionPickerFor(null);
    setMentionQuery(null);

    const id = crypto.randomUUID();
    const optimistic: ChatMessage = {
      id,
      project_id: projectId,
      author_id: userId,
      body,
      created_at: new Date().toISOString(),
      // Цитата из локального состояния: ждать сервер незачем, она уже известна.
      reply_to_id: replyTarget?.id ?? null,
      reply_to: replyTarget
        ? { id: replyTarget.id, body: replyTarget.body, author_id: replyTarget.author_id }
        : null,
      reply_deleted: false,
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
        const result = await sendMessageAction(projectId, {
          id,
          body,
          replyToId: replyTarget?.id,
        });
        if (!result.ok) throw new Error(result.error);
        setMessages((current) => mergeMessages(current, [result.message]));
        setReplyTo(null);
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
        replyToId: replyTarget?.id,
      });
      if (!result.ok) throw new Error(result.error);

      setMessages((current) => mergeMessages(current, [result.message]));
      setReplyTo(null);
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
  }, [canPost, pending, projectId, replyTo, sending, text, userId]);

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
        aria-label={
          unread === 0
            ? "Открыть чат проекта"
            : mentionUnread
              ? `Чат проекта, вас упомянули, непрочитанных: ${unread}`
              : `Чат проекта, непрочитанных: ${unread}`
        }
        // Toaster живёт снизу по центру — держим кнопку правее и выше safe-area.
        className="fixed right-6 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-40 flex size-12 items-center justify-center rounded-full bg-brand text-white shadow-[0_6px_18px_rgba(20,30,50,0.22)] transition-transform duration-120 hover:scale-[1.04] active:scale-95"
      >
        {/* Волна — только когда есть непрочитанные. key по числу пересоздаёт
            кольца, и CSS-анимация стартует заново на каждое новое сообщение;
            сама кнопка при этом не пересоздаётся и фокус не теряет. */}
        {unread > 0 ? (
          <span key={unread} aria-hidden className="pointer-events-none absolute inset-0">
            <span className="absolute inset-0 rounded-full border-2 border-brand/65 opacity-0 motion-safe:animate-chat-ripple" />
            <span className="absolute inset-0 rounded-full border-2 border-brand/65 opacity-0 motion-safe:animate-chat-ripple-late" />
          </span>
        ) : null}
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
          <span className="absolute -top-1 -right-1 flex min-w-[18px] animate-pulse items-center justify-center rounded-full bg-status-alert-fg px-1 text-[10.5px] leading-[18px] font-semibold text-white">
            {mentionUnread ? "@" : unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
    );
  }

  const category = EMOJI_CATEGORIES.find((item) => item.id === emojiCategory) ?? EMOJI_CATEGORIES[0];

  return (
    <section
      aria-label="Чат проекта"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[46dvh] flex-col overflow-hidden rounded-t-2xl border border-line-strong bg-surface shadow-[0_-8px_30px_rgba(20,30,50,0.18)] md:inset-x-auto md:right-6 md:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] md:h-[36dvh] md:max-h-[440px] md:w-[364px] md:rounded-2xl md:shadow-[0_12px_40px_rgba(20,30,50,0.22)]"
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
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={searchOpen ? "Закрыть поиск" : "Поиск по сообщениям"}
            aria-pressed={searchOpen}
            disabled={jumpBusy}
            onClick={toggleSearch}
          >
            <SearchIcon size={14} strokeWidth={1.6} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Свернуть чат"
            onClick={() => persistOpen(false)}
          >
            <CloseIcon size={13} />
          </Button>
        </div>
      </header>

      {searchOpen ? (
        // Строка поиска живёт между шапкой и лентой: результаты заменяют ленту,
        // композер остаётся на месте — из поиска можно сразу написать.
        <div className="flex shrink-0 items-center gap-1 border-b border-line-strong px-2 py-1.5">
          <SearchIcon size={13} className="shrink-0 text-meta" />
          <input
            ref={searchInputRef}
            value={searchText}
            onChange={(event) => {
              const value = event.target.value.slice(0, 100);
              setSearchText(value);
              // Слишком короткий запрос ничего не ищет — прошлые результаты
              // снимаем сразу, чтобы не показывать чужое.
              if (value.trim().length < 2) {
                setSearchResults(null);
                setSearchError(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              }
            }}
            placeholder="Поиск по сообщениям"
            aria-label="Поиск по сообщениям"
            className="min-w-0 flex-1 bg-transparent py-0.5 text-[12.5px] text-ink outline-none placeholder:text-meta"
          />
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Закрыть поиск"
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-meta transition-colors duration-120 hover:bg-page hover:text-ink"
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ) : null}

      <div
        ref={listRef}
        onScroll={onListScroll}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-page/60 px-2.5 py-2"
      >
        {searchOpen ? (
          // Пока открыт поиск, лента заменяется результатами: смешивать их с
          // перепиской — значит не понимать, где нашлось, а где просто было.
          searchText.trim().length < 2 ? (
            <p className="m-auto max-w-[220px] text-center text-[12px] text-meta">
              Введите хотя бы два символа
            </p>
          ) : searching ? (
            <p className="m-auto text-[12px] text-meta">Ищем…</p>
          ) : searchError ? (
            <p className="m-auto max-w-[240px] text-center text-[12px] text-meta">{searchError}</p>
          ) : (searchResults?.length ?? 0) === 0 ? (
            <p className="m-auto max-w-[220px] text-center text-[12px] text-meta">Ничего не найдено</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {(searchResults ?? []).map((message) => (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => void jumpToMessage(message.id)}
                  className="flex w-full flex-col gap-0.5 rounded-[10px] border border-line-strong bg-surface px-2.5 py-1.5 text-left transition-colors duration-120 hover:border-line-card-hover hover:bg-row-hover"
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-meta">
                    <span className="truncate font-medium text-ink-soft">
                      {authorNameOf(authorNames[message.author_id])}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">
                      {formatDateNumeric(message.created_at, timezone)}, {messageTime(message.created_at, timezone)}
                    </span>
                    {message.has_attachments ? <AttachIcon size={11} className="shrink-0 text-meta" /> : null}
                  </span>
                  <span className="line-clamp-3 text-[12.5px] leading-snug text-ink">
                    {highlightParts(searchSnippet(message.body, searchText), searchText).map((part, index) =>
                      part.match ? (
                        <mark key={index} className="rounded-[3px] bg-brand/15 px-0.5 text-ink">
                          {part.text}
                        </mark>
                      ) : (
                        <span key={index}>{part.text}</span>
                      ),
                    )}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : (
          <>
        {jumpBusy ? (
          <p className="shrink-0 self-center rounded-full bg-page px-2 py-0.5 text-[11px] text-meta">
            Загружаем историю…
          </p>
        ) : null}
        {hasMore ? (
          // Кнопка живёт в начале ленты: история догружается вверх, туда же,
          // куда читатель и смотрит.
          <div className="flex shrink-0 justify-center py-0.5">
            <Button
              type="button"
              variant="ghost"
              size="default"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
              className="rounded-full px-3 text-[11.5px] text-meta"
            >
              {loadingOlder ? "Загружаем…" : "Показать более ранние"}
            </Button>
          </div>
        ) : null}
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
                    data-message-id={message.id}
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
                          // Подсветка цели поиска: гаснет сама через пару секунд.
                          highlightId === message.id && "ring-2 ring-brand/60 ring-offset-1",
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
                        {message.reply_to || message.reply_deleted ? (
                          message.reply_deleted ? (
                            // Оригинал удалили: снимок остался, ссылка обнулилась (0039).
                            <div
                              className={cn(
                                "w-full max-w-[220px] rounded-[8px] border-l-2 px-1.5 py-0.5 text-[10.5px]",
                                own
                                  ? "border-white/50 bg-white/10 text-white/80"
                                  : "border-line-card-hover bg-page text-meta",
                              )}
                            >
                              Сообщение удалено
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                const target = message.reply_to;
                                if (target) void jumpToMessage(target.id);
                              }}
                              aria-label="Перейти к сообщению, на которое ответили"
                              className={cn(
                                "w-full max-w-[220px] rounded-[8px] border-l-2 px-1.5 py-0.5 text-left text-[10.5px] transition-colors",
                                own
                                  ? "border-white/50 bg-white/10 text-white/85 hover:bg-white/15"
                                  : "border-brand/50 bg-page text-ink-soft hover:bg-row-hover",
                              )}
                            >
                              <span className="block truncate font-medium">
                                {authorNameOf(authorNames[message.reply_to?.author_id ?? ""])}
                              </span>
                              <span className="block truncate opacity-80">
                                {quotePreview(message.reply_to?.body ?? "")}
                              </span>
                            </button>
                          )
                        ) : null}
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
                                onClick={() => setViewerPhotoId(photo.id)}
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
                            {mentionParts(message.body, memberNames, myName).map((part, partIndex) =>
                              part.mention ? (
                                <span
                                  key={partIndex}
                                  className={cn(
                                    "rounded-[4px] px-0.5 font-medium",
                                    // В своём пузыре фон бренда: чип должен читаться
                                    // на синем, но не спорить с текстом.
                                    own
                                      ? "bg-white/20 text-white"
                                      : part.isMe
                                        ? "bg-brand/15 text-brand"
                                        : "bg-page text-ink-soft",
                                  )}
                                >
                                  {part.text}
                                </span>
                              ) : (
                                <span key={partIndex}>{part.text}</span>
                              ),
                            )}
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
                        <button
                          type="button"
                          aria-label="Ответить"
                          onClick={() => {
                            // Ответ — жест, который отменяет открытые поповеры.
                            setReplyTo(message);
                            setEmojiOpen(false);
                            setReactionPickerFor(null);
                            setMenuFor(null);
                            textareaRef.current?.focus();
                          }}
                          className="flex size-[18px] items-center justify-center rounded-full border border-line-strong bg-surface text-meta transition-opacity hover:bg-page md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:group-focus-within:opacity-100"
                        >
                          <ReplyIcon size={11} />
                        </button>
                      ) : null}
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
          </>
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
        <div className="relative shrink-0 border-t border-line-strong px-2 py-2">
          {/* Подсказка не занимает места в потоке: иначе лента дёргалась бы при
              каждом фокусе поля. Пока открыт пикер эмодзи — прячем, они бы
              наложились друг на друга. */}
          {(composerFocused || text.trim().length > 0) && !emojiOpen ? (
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-full left-2 mb-1 rounded bg-surface/95 px-1.5 py-0.5 text-[10.5px] text-meta shadow-[0_2px_8px_rgba(20,30,50,0.12)]"
            >
              Enter — отправить · Shift+Enter — новая строка
            </span>
          ) : null}
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
          {/* Полоса ответа не участвует в автовысоте поля: это отдельный блок
              над ним, поэтому цитата не «дёргает» набор. */}
          {replyTo ? (
            <div className="mb-1 flex items-start gap-1.5 rounded-[8px] border-l-2 border-brand bg-page px-2 py-1">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[10.5px] font-medium text-ink">
                  Ответ: {authorNameOf(authorNames[replyTo.author_id])}
                </span>
                <span className="block truncate text-[10.5px] text-meta">
                  {quotePreview(replyTo.body)}
                </span>
              </div>
              <button
                type="button"
                aria-label="Отменить ответ"
                onClick={() => {
                  setReplyTo(null);
                  textareaRef.current?.focus();
                }}
                className="flex size-[18px] shrink-0 items-center justify-center rounded-full text-meta transition-colors hover:bg-surface hover:text-ink"
              >
                <CloseIcon size={11} />
              </button>
            </div>
          ) : null}
          <div className="relative flex items-end gap-0.5 rounded-[22px] border border-line-strong bg-page px-1 py-0.5 focus-within:border-brand">
          {mentionCandidates.length > 0 ? (
            <div
              data-chat-popover
              role="listbox"
              aria-label="Участники для упоминания"
              className="absolute left-1 bottom-[calc(100%-2px)] z-20 w-[232px] overflow-hidden rounded-lg border border-line-strong bg-surface py-1 shadow-[0_10px_30px_rgba(20,30,50,0.18)]"
            >
              {mentionCandidates.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={index === mentionIndex}
                  // mousedown не должен уводить фокус из поля: иначе выбор
                  // мышью закрывал бы список до клика.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseMention(name)}
                  onMouseEnter={() => setMentionIndex(index)}
                  className={cn(
                    "flex w-full items-center gap-1.5 px-2 py-1 text-left text-[12px]",
                    index === mentionIndex ? "bg-page text-ink" : "text-ink-soft",
                  )}
                >
                  <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-brand/15 text-[8.5px] font-semibold text-brand">
                    {authorInitials(name)}
                  </span>
                  <span className="truncate">{name}</span>
                </button>
              ))}
            </div>
          ) : null}
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
            onChange={(event) => {
              const next = event.target.value.slice(0, CHAT_BODY_MAX);
              setText(next);
              syncMention(next, event.target.selectionStart);
            }}
            onKeyDown={(event) => {
              // Список участников перехватывает клавиши первым: Enter при
              // открытом списке подставляет имя, а не отправляет сообщение.
              if (mentionCandidates.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setMentionIndex((index) => (index + 1) % mentionCandidates.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setMentionIndex(
                    (index) => (index - 1 + mentionCandidates.length) % mentionCandidates.length,
                  );
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  chooseMention(mentionCandidates[mentionIndex] ?? mentionCandidates[0]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMentionQuery(null);
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            onSelect={(event) => syncMention(text, event.currentTarget.selectionStart)}
            rows={1}
            placeholder="Сообщение…"
            aria-label="Текст сообщения"
            onFocus={() => setComposerFocused(true)}
            onBlur={() => {
              setComposerFocused(false);
              // Ушли из поля — подсказка участников больше не нужна. Выбор
              // мышью фокус не отдаёт (mousedown отменён), поэтому не мешает.
              setMentionQuery(null);
            }}
            className="max-h-24 min-h-[30px] flex-1 resize-none overflow-hidden bg-transparent px-1 py-1.5 text-[12.5px] leading-snug text-ink outline-none placeholder:text-meta"
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
      {viewerIndex >= 0 ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Просмотр фото, ${viewerIndex + 1} из ${gallery.length}`}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 select-none"
          onClick={() => {
            if (swipeAteClick.current) {
              swipeAteClick.current = false;
              return;
            }
            setViewerPhotoId(null);
          }}
          onPointerDown={(event) => {
            swipeStart.current = { x: event.clientX, y: event.clientY };
            swipeAteClick.current = false;
          }}
          onPointerUp={(event) => {
            const start = swipeStart.current;
            swipeStart.current = null;
            if (!start) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            // Листаем, только если жест заметно горизонтальный: иначе случайное
            // движение при тапе по фото перебрасывало бы на соседнее.
            if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
            swipeAteClick.current = true;
            stepViewer(dx < 0 ? 1 : -1);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- подписанный URL из Storage */}
          <img
            src={gallery[viewerIndex].url}
            alt={`Фото ${viewerIndex + 1} из ${gallery.length}`}
            className="max-h-full max-w-full rounded-[8px] object-contain"
            draggable={false}
          />

          {gallery.length > 1 ? (
            <>
              <button
                type="button"
                aria-label="Предыдущее фото"
                onClick={(event) => {
                  event.stopPropagation();
                  stepViewer(-1);
                }}
                className="absolute top-1/2 left-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/65"
              >
                <ChevronLeftIcon size={18} strokeWidth={2} />
              </button>
              <button
                type="button"
                aria-label="Следующее фото"
                onClick={(event) => {
                  event.stopPropagation();
                  stepViewer(1);
                }}
                className="absolute top-1/2 right-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/65"
              >
                <ChevronRightIcon size={18} strokeWidth={2} />
              </button>
              {/* Счётчик — чтобы было видно, сколько ещё снимков в ленте. */}
              <span className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-1 font-mono text-[11.5px] text-white/90 tabular-nums">
                {viewerIndex + 1} / {gallery.length}
              </span>
            </>
          ) : null}

          <button
            type="button"
            aria-label="Закрыть фото"
            onClick={(event) => {
              event.stopPropagation();
              setViewerPhotoId(null);
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
