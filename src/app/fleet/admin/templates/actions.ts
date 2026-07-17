"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOfficeAdmin } from "@/lib/documents/save";
import { demoContractData, renderTemplate } from "@/lib/documents/render";
import { devError } from "@/lib/dev-log";

type Result = { ok: true } | { ok: false; error: string };
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function fileFromForm(formData: FormData): Promise<{ ok: true; buf: Buffer } | { ok: false; error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Выберите .docx файл" };
  if (!file.name.toLowerCase().endsWith(".docx")) return { ok: false, error: "Только формат .docx" };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Файл больше 5 МБ" };
  return { ok: true, buf: Buffer.from(await file.arrayBuffer()) };
}

export async function uploadTemplate(formData: FormData): Promise<Result> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return gate;
  const f = await fileFromForm(formData);
  if (!f.ok) return f;

  const name = String(formData.get("name") ?? "").trim();
  const docType = String(formData.get("doc_type") ?? "");
  const contractType = String(formData.get("contract_type") ?? "") || null;
  if (!name) return { ok: false, error: "Укажите название шаблона" };

  const path = `${gate.orgId}/${crypto.randomUUID()}.docx`;
  const admin = createAdminClient();
  const up = await admin.storage.from("templates").upload(path, f.buf, { contentType: DOCX_MIME });
  if (up.error) return { ok: false, error: up.error.message };

  const supabase = await createClient();
  const { error } = await supabase.from("document_templates").insert({
    name, doc_type: docType, contract_type: contractType, file_url: path,
  });
  if (error) {
    devError("uploadTemplate", error);
    return { ok: false, error: error.message };
  }
  revalidatePath("/fleet/admin/templates");
  return { ok: true };
}

/** Замена файла = новая версия (version+1), история файлов остаётся в бакете. */
export async function replaceTemplate(id: string, formData: FormData): Promise<Result> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return gate;
  const f = await fileFromForm(formData);
  if (!f.ok) return f;

  const supabase = await createClient();
  const { data: t } = await supabase.from("document_templates").select("version").eq("id", id).single();
  if (!t) return { ok: false, error: "Шаблон не найден" };

  const path = `${gate.orgId}/${crypto.randomUUID()}.docx`;
  const admin = createAdminClient();
  const up = await admin.storage.from("templates").upload(path, f.buf, { contentType: DOCX_MIME });
  if (up.error) return { ok: false, error: up.error.message };

  const { error } = await supabase
    .from("document_templates")
    .update({ file_url: path, version: t.version + 1, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/fleet/admin/templates");
  return { ok: true };
}

export async function toggleTemplate(id: string, isActive: boolean): Promise<Result> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("document_templates").update({ is_active: isActive }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/fleet/admin/templates");
  return { ok: true };
}

export async function getTemplateUrl(id: string): Promise<{ url: string } | { error: string }> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data: t } = await supabase.from("document_templates").select("file_url").eq("id", id).single();
  if (!t) return { error: "Шаблон не найден" };
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("templates").createSignedUrl(t.file_url, 600);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}

/** Тестовый рендер на демо-данных: ловит битые плейсхолдеры до боевого применения. */
export async function testRenderTemplate(
  id: string,
): Promise<{ ok: true; base64: string } | { ok: false; error: string }> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data: t } = await supabase.from("document_templates").select("file_url").eq("id", id).single();
  if (!t) return { ok: false, error: "Шаблон не найден" };

  const admin = createAdminClient();
  const file = await admin.storage.from("templates").download(t.file_url);
  if (file.error || !file.data) return { ok: false, error: "Не удалось скачать файл шаблона" };

  const res = renderTemplate(Buffer.from(await file.data.arrayBuffer()), demoContractData());
  if (!res.ok) return res;
  return { ok: true, base64: res.buffer.toString("base64") };
}
