import { describe, expect, it } from "vitest";

import {
  CHAT_ATTACHMENT_MESSAGES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_DOCUMENT_BYTES,
  MAX_SIDE,
  MAX_SOURCE_BYTES,
  attachmentFolder,
  buildAttachmentPath,
  attachmentKindForFile,
  canAddAttachment,
  chatAttachmentPath,
  documentExtensionFor,
  documentMimeFor,
  firstAttachmentError,
  formatFileSize,
  fitWithin,
  isValidAttachmentPath,
  isValidChatAttachmentPath,
  isValidDimension,
  rememberSignedUrls,
  toPhotoCount,
  urlAfterLoadError,
} from "./attachments";

const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TASK = "e0000000-0000-0000-0000-00000000000a";
const FILE = "f0000000-0000-4000-8000-000000000001";

describe("fitWithin", () => {
  it("scales a landscape photo down to the max side", () => {
    expect(fitWithin(4032, 3024, 2000)).toEqual({ width: 2000, height: 1500 });
  });

  it("scales a portrait photo down to the max side", () => {
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
  });

  it("keeps a small photo as is (never upscales)", () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });

  it("scales a square photo", () => {
    expect(fitWithin(2500, 2500, 2000)).toEqual({ width: 2000, height: 2000 });
  });

  it("never returns a zero side for extreme panoramas", () => {
    expect(fitWithin(1, 10000, 2000)).toEqual({ width: 1, height: 2000 });
  });
});

describe("buildAttachmentPath / isValidAttachmentPath", () => {
  it("builds {project}/{task}/{uuid}.jpg", () => {
    expect(buildAttachmentPath(PROJECT, TASK, FILE)).toBe(`${PROJECT}/${TASK}/${FILE}.jpg`);
  });

  it("accepts a path built for the same task", () => {
    expect(isValidAttachmentPath(buildAttachmentPath(PROJECT, TASK, FILE), PROJECT, TASK)).toBe(true);
  });

  it("rejects a path of another task", () => {
    const other = "e0000000-0000-0000-0000-00000000000b";
    expect(isValidAttachmentPath(buildAttachmentPath(PROJECT, other, FILE), PROJECT, TASK)).toBe(false);
  });

  it("rejects a path of another project", () => {
    const other = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    expect(isValidAttachmentPath(buildAttachmentPath(other, TASK, FILE), PROJECT, TASK)).toBe(false);
  });

  it("rejects traversal, extra segments and other extensions", () => {
    expect(isValidAttachmentPath(`${PROJECT}/${TASK}/../x/${FILE}.jpg`, PROJECT, TASK)).toBe(false);
    expect(isValidAttachmentPath(`${PROJECT}/${TASK}/sub/${FILE}.jpg`, PROJECT, TASK)).toBe(false);
    expect(isValidAttachmentPath(`${PROJECT}/${TASK}/${FILE}.png`, PROJECT, TASK)).toBe(false);
    expect(isValidAttachmentPath(`${PROJECT}/${TASK}/photo.jpg`, PROJECT, TASK)).toBe(false);
  });
});

describe("isValidDimension", () => {
  it("accepts integers from 1 to MAX_SIDE", () => {
    expect(isValidDimension(1)).toBe(true);
    expect(isValidDimension(MAX_SIDE)).toBe(true);
  });

  it("rejects zero, fractions, oversize and non-numbers", () => {
    expect(isValidDimension(0)).toBe(false);
    expect(isValidDimension(10.5)).toBe(false);
    expect(isValidDimension(MAX_SIDE + 1)).toBe(false);
    expect(isValidDimension("100")).toBe(false);
  });
});

describe("rememberSignedUrls", () => {
  it("keeps the url the browser already loaded when the page re-signs the photo", () => {
    expect(rememberSignedUrls({ a: "url-a-old" }, [{ id: "a", url: "url-a-new" }])).toEqual({ a: "url-a-old" });
  });

  it("adds fresh urls for new photos", () => {
    expect(rememberSignedUrls({ a: "url-a" }, [{ id: "a", url: "url-a2" }, { id: "b", url: "url-b" }])).toEqual({
      a: "url-a",
      b: "url-b",
    });
  });

  it("drops deleted photos", () => {
    expect(rememberSignedUrls({ a: "url-a", b: "url-b" }, [{ id: "b", url: "url-b2" }])).toEqual({ b: "url-b" });
  });

  it("skips photos whose url could not be signed", () => {
    expect(rememberSignedUrls({}, [{ id: "a", url: null }])).toEqual({});
  });
});

describe("urlAfterLoadError", () => {
  it("switches to the newer signed url when the failed one has expired", () => {
    expect(urlAfterLoadError("url-old", "url-new")).toBe("url-new");
  });

  it("gives up when the newest url is the one that failed", () => {
    expect(urlAfterLoadError("url-a", "url-a")).toBeNull();
  });

  it("gives up when there is no signed url at all", () => {
    expect(urlAfterLoadError("url-a", null)).toBeNull();
  });
});

describe("upper-case ids in the URL", () => {
  const UPPER_PROJECT = PROJECT.toUpperCase();
  const UPPER_TASK = TASK.toUpperCase();

  it("builds the folder and path in lower case, as Postgres prints uuids", () => {
    expect(attachmentFolder(UPPER_PROJECT, UPPER_TASK)).toBe(`${PROJECT}/${TASK}`);
    expect(buildAttachmentPath(UPPER_PROJECT, UPPER_TASK, FILE)).toBe(`${PROJECT}/${TASK}/${FILE}.jpg`);
  });

  it("accepts a lower-case path for upper-case ids", () => {
    expect(isValidAttachmentPath(`${PROJECT}/${TASK}/${FILE}.jpg`, UPPER_PROJECT, UPPER_TASK)).toBe(true);
  });
});

describe("toPhotoCount", () => {
  it("встроенный подсчёт Supabase — число фото", () => {
    expect(toPhotoCount([{ count: 3 }])).toBe(3);
  });

  it("нет данных — ноль", () => {
    expect(toPhotoCount([])).toBe(0);
    expect(toPhotoCount(null)).toBe(0);
    expect(toPhotoCount(undefined)).toBe(0);
  });
});

describe("вложения чата", () => {
  const projectId = "5eed0000-0000-4000-8000-000000000002";
  const messageId = "0b6f4c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
  const fileId = "11111111-2222-3333-4444-555555555555";

  it("путь фото собирается с расширением jpg по умолчанию", () => {
    expect(chatAttachmentPath(projectId, messageId, fileId)).toBe(
      `${projectId}/${messageId}/${fileId}.jpg`,
    );
  });

  it("путь документа — с расширением из MIME", () => {
    const path = chatAttachmentPath(projectId, messageId, fileId, "pdf");
    expect(path).toBe(`${projectId}/${messageId}/${fileId}.pdf`);
    expect(isValidChatAttachmentPath(path, projectId, messageId)).toBe(true);
  });

  it("приводит путь к нижнему регистру, как Postgres печатает uuid", () => {
    const upper = chatAttachmentPath(projectId.toUpperCase(), messageId.toUpperCase(), fileId.toUpperCase());
    expect(upper).toBe(`${projectId}/${messageId}/${fileId}.jpg`);
    expect(isValidChatAttachmentPath(upper, projectId, messageId)).toBe(true);
  });

  it("не принимает путь чужого проекта или сообщения", () => {
    const path = chatAttachmentPath(projectId, messageId, fileId);
    expect(isValidChatAttachmentPath(path, projectId, "0b6f4c9e-1a2b-4c3d-8e9f-0a1b2c3d4e60")).toBe(false);
    expect(isValidChatAttachmentPath(path, "5eed0000-0000-4000-8000-000000000003", messageId)).toBe(false);
  });

  it("не принимает лишние сегменты, неразрешённые расширения и обход пути", () => {
    const prefix = `${projectId}/${messageId}`;
    expect(isValidChatAttachmentPath(`${prefix}/${fileId}.png`, projectId, messageId)).toBe(false);
    expect(isValidChatAttachmentPath(`${prefix}/${fileId}.exe`, projectId, messageId)).toBe(false);
    expect(isValidChatAttachmentPath(`${prefix}/../${fileId}.jpg`, projectId, messageId)).toBe(false);
  });

  it("разрешает не больше четырёх вложений", () => {
    expect(canAddAttachment(0)).toBe(true);
    expect(canAddAttachment(3)).toBe(true);
    expect(canAddAttachment(4)).toBe(false);
  });

  it("определяет тип файла: фото, документ или отказ", () => {
    expect(attachmentKindForFile({ type: "image/png", name: "a.png" })).toBe("image");
    expect(attachmentKindForFile({ type: "application/pdf", name: "смета.pdf" })).toBe("document");
    expect(attachmentKindForFile({ type: "", name: "смета.docx" })).toBe("document");
    expect(attachmentKindForFile({ type: "application/octet-stream", name: "a.xlsx" })).toBe("document");
    expect(attachmentKindForFile({ type: "application/zip", name: "a.zip" })).toBeNull();
  });

  it("переводит расширение в MIME и обратно", () => {
    expect(documentMimeFor("СМЕТА.PDF")).toBe("application/pdf");
    expect(documentMimeFor("a.exe")).toBeNull();
    expect(documentExtensionFor("application/pdf")).toBe("pdf");
    expect(documentExtensionFor("application/zip")).toBeNull();
  });

  it("объясняет, почему файл не приложить", () => {
    expect(firstAttachmentError({ type: "image/jpeg", size: 1024 }, 0)).toBeNull();
    expect(
      firstAttachmentError({ type: "application/pdf", size: 1024, name: "смета.pdf" }, 0),
    ).toBeNull();
    expect(
      firstAttachmentError({ type: "image/jpeg", size: MAX_SOURCE_BYTES + 1 }, 0),
    ).toBe(CHAT_ATTACHMENT_MESSAGES.tooLarge);
    expect(
      firstAttachmentError({ type: "application/pdf", size: MAX_DOCUMENT_BYTES + 1, name: "a.pdf" }, 0),
    ).toBe(CHAT_ATTACHMENT_MESSAGES.documentTooLarge);
    expect(
      firstAttachmentError({ type: "application/zip", size: 1024, name: "a.zip" }, 0),
    ).toBe(CHAT_ATTACHMENT_MESSAGES.unsupported);
    expect(firstAttachmentError({ type: "image/jpeg", size: 1024 }, MAX_ATTACHMENTS_PER_MESSAGE)).toBe(
      CHAT_ATTACHMENT_MESSAGES.limitReached,
    );
  });

  it("пишет размер файла по-человечески", () => {
    expect(formatFileSize(512)).toBe("512 Б");
    expect(formatFileSize(1024)).toBe("1 КБ");
    expect(formatFileSize(2.4 * 1024 * 1024)).toBe("2,4 МБ");
  });
});
