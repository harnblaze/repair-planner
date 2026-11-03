import { notFound } from "next/navigation";

import { ProjectNav } from "@/components/common/project-nav";
import { BADGE_BASE } from "@/components/common/status-badge";
import { CHAT_ATTACHMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/business/attachments";
import { CHAT_PAGE_SIZE, type ChatAttachment, type ChatMessage, type ChatReaction } from "@/lib/business/chat";
import { canEditProject, projectRoleLabel } from "@/lib/business/project-roles";
import { getProjectRole } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";

import { ChatWidget } from "./chat/chat-widget";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectLayout({ children, params }: LayoutProps<"/[projectId]">) {
  const { projectId } = await params;

  if (!UUID_RE.test(projectId)) {
    notFound();
  }

  const supabase = await createClient();
  const [{ data: project }, role] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, timezone")
      .eq("id", projectId)
      .is("archived_at", null)
      .maybeSingle(),
    getProjectRole(projectId),
  ]);

  // RLS уже ограничивает выборку проектами, к которым есть доступ — отсутствие
  // строки означает либо «не существует», либо «нет доступа», и намеренно не
  // различается (см. docs/architecture.md §4).
  if (!project) {
    notFound();
  }

  // Чат проекта: первый рендер собирается на сервере — клиент ничего не
  // догружает, и панель не мигает пустой лентой.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: recentMessages }, { data: readRow }, { data: members }] = await Promise.all([
    supabase
      .from("project_messages")
      .select(
        "id, project_id, author_id, body, created_at, edited_at, project_message_reactions(user_id, emoji), project_message_attachments(id, storage_path, kind, mime_type, file_name, size_bytes, width, height)",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      // Вторичный ключ тот же, что у пагинации: иначе на границе страницы
      // сообщения с одинаковым временем могли бы потеряться.
      .order("id", { ascending: false })
      .limit(CHAT_PAGE_SIZE),
    user
      ? supabase
          .from("project_message_reads")
          .select("last_read_at")
          .eq("project_id", projectId)
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Имена авторов одним запросом на страницу: profiles закрыт RLS на свою
    // строку, поэтому чужие имена доступны только через security definer.
    supabase.rpc("project_member_list", { p_project_id: projectId }),
  ]);

  const authorNames: Record<string, string | null> = Object.fromEntries(
    (members ?? []).map((member) => [member.user_id, member.full_name]),
  );

  // Реакции лежат вложенно в строках сообщений: отдельный запрос на них не нужен,
  // а клиент не должен догружать их при открытии панели.
  const messageRows = recentMessages ?? [];
  const initialMessages: ChatMessage[] = messageRows
    .map(({ id, project_id, author_id, body, created_at, edited_at }) => ({
      id,
      project_id,
      author_id,
      body,
      created_at,
      edited_at,
    }))
    .reverse();
  const initialReactions: ChatReaction[] = messageRows.flatMap((row) =>
    (row.project_message_reactions ?? []).map((reaction) => ({
      message_id: row.id,
      user_id: reaction.user_id,
      emoji: reaction.emoji,
    })),
  );

  // Фото подписываем одним запросом на всю панель: bucket приватный, ссылки
  // живут час и обновляются вместе со страницей.
  const attachmentRows = messageRows.flatMap((row) => row.project_message_attachments ?? []);
  const signedByPath = new Map<string, string>();
  if (attachmentRows.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .createSignedUrls(
        attachmentRows.map((row) => row.storage_path),
        SIGNED_URL_TTL_SECONDS,
      );
    if (signError) console.error("ProjectLayout (sign chat attachments):", signError);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
    }
  }

  const initialAttachments: ChatAttachment[] = messageRows.flatMap((row) =>
    (row.project_message_attachments ?? []).map((attachment) => ({
      id: attachment.id,
      message_id: row.id,
      storage_path: attachment.storage_path,
      kind: attachment.kind === "document" ? "document" : "image",
      mime_type: attachment.mime_type,
      file_name: attachment.file_name,
      size_bytes: attachment.size_bytes,
      width: attachment.width,
      height: attachment.height,
      url: signedByPath.get(attachment.storage_path) ?? null,
    })),
  );

  const lastReadAt = readRow?.last_read_at ?? null;

  // Счётчик считаем запросом, а не по загруженным 50 строкам: иначе на активном
  // чате бейдж молча занижается.
  const { count: unreadCount } = user
    ? await (() => {
        let query = supabase
          .from("project_messages")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId)
          .neq("author_id", user.id);
        if (lastReadAt) query = query.gt("created_at", lastReadAt);
        return query;
      })()
    : { count: 0 };

  return (
    <div className="flex flex-1 flex-col">
      {/* До md навигация не помещается рядом с названием — уходит второй строкой. */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-line-strong bg-surface px-5 pt-2 pb-1.5 md:h-11 md:flex-row md:items-center md:justify-between md:gap-6 md:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-ink">{project.name}</span>
          {/* Роль в проекте — повод, почему нет кнопок редактирования. */}
          {role && !canEditProject(role) ? (
            <span className={`${BADGE_BASE} bg-page text-meta`}>{projectRoleLabel(role)}</span>
          ) : null}
        </div>
        <ProjectNav projectId={project.id} />
      </div>
      {children}
      {user ? (
        <ChatWidget
          projectId={project.id}
          userId={user.id}
          canPost={canEditProject(role)}
          initialMessages={initialMessages}
          initialReactions={initialReactions}
          initialAttachments={initialAttachments}
          initialUnread={unreadCount ?? 0}
          authorNames={authorNames}
          timezone={project.timezone}
        />
      ) : null}
    </div>
  );
}
