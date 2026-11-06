"use server";

import { createClient } from "@/lib/supabase/server";

// Сколько сообщений ждёт человека во всех его проектах — для значка на иконке
// приложения и вкладке браузера. Считает база (функция 0044): в браузер чужие
// проекты не загружаются, а значок должен быть честным.
//
// null означает «не удалось узнать»: тогда значок не трогаем, иначе он бы
// мигал нулём при каждом сбое сети.
export async function chatUnreadTotalAction(): Promise<number | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase.rpc("chat_unread_total");

  if (error) {
    console.error("chatUnreadTotalAction:", error);
    return null;
  }

  return typeof data === "number" ? data : 0;
}
