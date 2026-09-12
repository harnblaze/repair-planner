export type ActionResult<TFieldErrors = Record<string, string[] | undefined>> =
  | { ok: true; message?: string }
  | { ok: false; error: string; fieldErrors?: TFieldErrors };
