"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ChatIcon, CloseIcon } from "@/components/common/icons";
import { Button } from "@/components/ui/button";
import {
  CHAT_BODY_MAX,
  applyEmoji,
  authorNameOf,
  canSend,
  groupMessagesByDay,
  isOwnMessage,
  mergeMessages,
  messageTime,
  normalizeBody,
  shouldShowAuthor,
  type ChatMessage,
} from "@/lib/business/chat";
import { EMOJI_CATEGORIES, readRecentEmoji, recentEmoji, saveRecentEmoji } from "@/lib/business/emoji";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";

import { loadMessagesAction, markChatReadAction, sendMessageAction } from "./actions";
import { useChatOpen } from "./use-chat-open";

// Сколько ждём подтверждения подписки, прежде чем честно сказать «обновление
// недоступно». Молчащий канал выглядит как живой чат, в котором никто не пишет.
const REALTIME_TIMEOUT_MS = 8000;
// Дозапрос, пока Realtime недоступен: сообщения приходят с задержкой, зато не теряются.
const POLL_MS = 15000;

type Props = {
  projectId: string;
  userId: string;
  canPost: boolean;
  initialMessages: ChatMessage[];
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
  initialUnread,
  authorNames,
  timezone,
}: Props) {
  const [open, setOpen] = useChatOpen(projectId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [unread, setUnread] = useState(initialUnread);
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

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const persistOpen = useCallback(
    (next: boolean) => {
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

      channel = supabase
        .channel(`project-messages:${projectId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "project_messages", filter: `project_id=eq.${projectId}` },
          (payload) => applyRef.current([payload.new as ChatMessage]),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setLive("live");
            if (timeout) clearTimeout(timeout);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setLive("offline");
          }
        });

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
  }, [projectId]);

  // Дозапрос, пока подписки нет: лучше задержка, чем тишина.
  useEffect(() => {
    if (live !== "offline") return;
    let cancelled = false;
    const tick = async () => {
      const result = await loadMessagesAction(projectId);
      if (!cancelled && result.ok) applyRef.current(result.messages);
    };
    const interval = setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [live, projectId]);

  // Открытие = прочитано. Счётчик не обнуляем состоянием: пока панель открыта,
  // бейджа всё равно не видно, а markChatReadAction сдвигает отметку на сервере.
  useEffect(() => {
    if (!open) return;
    void markChatReadAction(projectId);
  }, [open, projectId]);

  // Лента прилипает к низу: новые сообщения должны быть видны.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, open]);

  const groups = useMemo(
    () => groupMessagesByDay(messages, timezone),
    [messages, timezone],
  );

  const send = useCallback(async () => {
    const body = normalizeBody(text);
    if (!canSend(body) || sending || !canPost) return;

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

    try {
      const result = await sendMessageAction(projectId, { id, body });
      if (!result.ok) {
        // Откат оптимистичной вставки: сообщения нет на сервере.
        knownIds.current.delete(id);
        setMessages((current) => current.filter((message) => message.id !== id));
        setText(body);
        toast.error(result.error);
        return;
      }
      setMessages((current) => mergeMessages(current, [result.message]));
    } catch {
      knownIds.current.delete(id);
      setMessages((current) => current.filter((message) => message.id !== id));
      setText(body);
      toast.error("Не удалось отправить сообщение. Проверьте связь.");
    } finally {
      setSending(false);
    }
  }, [canPost, projectId, sending, text, userId]);

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
      className="fixed inset-x-0 bottom-0 z-40 flex h-[80dvh] flex-col overflow-hidden rounded-t-2xl border border-line-strong bg-surface shadow-[0_-8px_30px_rgba(20,30,50,0.18)] md:inset-x-auto md:right-4 md:bottom-[calc(1rem+env(safe-area-inset-bottom))] md:h-[70dvh] md:w-[360px] md:rounded-xl md:shadow-[0_10px_34px_rgba(20,30,50,0.2)]"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line-strong px-3 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-[12.5px] font-semibold text-ink">Чат проекта</span>
          {live === "offline" ? (
            <span className="text-[11px] text-meta" title="Realtime недоступен — сообщения подтягиваются раз в 15 секунд">
              обновление с задержкой
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

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {groups.length === 0 ? (
          <p className="m-auto max-w-[220px] text-center text-[12px] text-meta">
            Сообщений пока нет. Напишите первым.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.day} className="flex flex-col gap-2">
              <span className="self-center rounded-full bg-page px-2 py-0.5 text-[10.5px] text-meta">
                {group.label}
              </span>
              {group.messages.map((message, index) => {
                const own = isOwnMessage(message, userId);
                const previous = index > 0 ? group.messages[index - 1] : null;
                // Имя — только над первой репликой подряд от одного человека:
                // иначе в длинной переписке оно повторяется на каждой строке.
                const showAuthor = shouldShowAuthor(previous, message, userId);
                return (
                  <div
                    key={message.id}
                    className={own ? "flex flex-col items-end" : "flex flex-col items-start"}
                  >
                    {showAuthor ? (
                      <span className="mb-0.5 text-[10.5px] font-medium text-meta">
                        {authorNameOf(authorNames[message.author_id])}
                      </span>
                    ) : null}
                    <div
                      className={
                        own
                          ? "max-w-[85%] rounded-[12px] rounded-br-[4px] bg-brand px-2.5 py-1.5 text-[12.5px] break-words whitespace-pre-wrap text-white"
                          : "max-w-[85%] rounded-[12px] rounded-bl-[4px] bg-page px-2.5 py-1.5 text-[12.5px] break-words whitespace-pre-wrap text-ink"
                      }
                    >
                      {message.body}
                    </div>
                    <span className="mt-0.5 text-[10px] text-meta">
                      {messageTime(message.created_at, timezone)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {canPost ? (
        <div className="relative flex shrink-0 items-end gap-1.5 border-t border-line-strong px-2 py-2">
          {emojiOpen ? (
            <div className="absolute right-2 bottom-[calc(100%-2px)] z-10 w-[286px] rounded-lg border border-line-strong bg-surface p-2 shadow-[0_10px_30px_rgba(20,30,50,0.18)]">
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

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Эмодзи"
            onClick={() => setEmojiOpen((value) => !value)}
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
            className="max-h-24 min-h-[30px] flex-1 resize-none rounded-[7px] border border-control bg-surface px-2 py-1.5 text-[12.5px] text-ink outline-none focus-visible:border-brand"
          />

          <Button
            type="button"
            size="sm"
            disabled={!canSend(text) || sending}
            onClick={() => void send()}
          >
            Отправить
          </Button>
        </div>
      ) : (
        <p className="shrink-0 border-t border-line-strong px-3 py-2 text-[11.5px] text-meta">
          Только просмотр: писать в чат могут владелец и редактор.
        </p>
      )}
    </section>
  );
}
