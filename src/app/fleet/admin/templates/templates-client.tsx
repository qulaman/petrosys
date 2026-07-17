"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Download, FlaskConical, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDateTime } from "@/lib/format";
import { getTemplateUrl, replaceTemplate, testRenderTemplate, toggleTemplate, uploadTemplate } from "./actions";

export interface TemplateRow {
  id: string;
  name: string;
  doc_type: string;
  contract_type: string | null;
  version: number;
  is_active: boolean;
  updated_at: string;
}

const DOC_TYPES: Record<string, string> = {
  contract: "Договор",
  appendix1: "Приложение №1",
  appendix2: "Приложение №2",
  amendment: "Доп. соглашение",
  claim_overconsumption: "Претензия",
  downtime_act: "Акт простоя",
};

const PLACEHOLDERS: [string, string][] = [
  ["{number}", "номер договора"],
  ["{valid_from} / {valid_to}", "срок действия"],
  ["{billing_period}", "расчётный период"],
  ["{today}", "дата формирования"],
  ["{c_name}", "контрагент — наименование"],
  ["{c_bin}", "БИН/ИИН"],
  ["{c_address}", "юридический адрес"],
  ["{c_bank} {c_iik} {c_bik}", "банковские реквизиты"],
  ["{c_head}", "руководитель"],
  ["{c_vat}", "статус по НДС"],
  ["{#rates}{r_type} — {r_unit} — {r_price}{/rates}", "цикл ставок (можно строками таблицы)"],
  ["{fuel_price}", "цена ГСМ для удержания"],
];

export function TemplatesClient({ rows }: { rows: TemplateRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ name: "", doc_type: "contract", contract_type: "" });
  const uploadRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);

  function submitUpload() {
    const file = uploadRef.current?.files?.[0];
    if (!file) { toast.error("Выберите .docx файл"); return; }
    if (!form.name.trim()) { toast.error("Укажите название"); return; }
    const fd = new FormData();
    fd.set("file", file);
    fd.set("name", form.name);
    fd.set("doc_type", form.doc_type);
    fd.set("contract_type", form.contract_type);
    start(async () => {
      const res = await uploadTemplate(fd);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Шаблон загружен");
      setForm({ name: "", doc_type: "contract", contract_type: "" });
      if (uploadRef.current) uploadRef.current.value = "";
      router.refresh();
    });
  }

  function onReplaceFile() {
    const file = replaceRef.current?.files?.[0];
    if (!file || !replaceId) return;
    const fd = new FormData();
    fd.set("file", file);
    const id = replaceId;
    setReplaceId(null);
    if (replaceRef.current) replaceRef.current.value = "";
    start(async () => {
      const res = await replaceTemplate(id, fd);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Файл заменён — версия увеличена");
      router.refresh();
    });
  }

  function download(id: string) {
    start(async () => {
      const res = await getTemplateUrl(id);
      if ("url" in res) window.open(res.url, "_blank", "noopener");
      else toast.error(res.error);
    });
  }

  function testRender(id: string) {
    start(async () => {
      const res = await testRenderTemplate(id);
      if (!res.ok) { toast.error(`Шаблон не прошёл проверку: ${res.error}`); return; }
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "проверка-шаблона.docx";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Шаблон валиден — скачан тестовый документ на демо-данных");
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* скрытый input для замены файла */}
      <input ref={replaceRef} type="file" accept=".docx" className="hidden" onChange={onReplaceFile} />

      {/* Загрузка нового шаблона */}
      <section className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label>Название *</Label>
          <Input value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="Договор перевозки (форма 2026)" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Тип документа</Label>
          <select value={form.doc_type} onChange={(e) => setForm((s) => ({ ...s, doc_type: e.target.value }))} className="h-10 rounded-md border bg-background px-3 text-sm">
            {Object.entries(DOC_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Тип договора</Label>
          <select value={form.contract_type} onChange={(e) => setForm((s) => ({ ...s, contract_type: e.target.value }))} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="">Любой</option>
            <option value="transportation">Перевозка</option>
            <option value="equipment">Услуги техники</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Файл .docx *</Label>
          <div className="flex gap-2">
            <input ref={uploadRef} type="file" accept=".docx" className="text-sm file:mr-2 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5" />
            <Button onClick={submitUpload} disabled={pending}><Upload className="size-4" /> Загрузить</Button>
          </div>
        </div>
      </section>

      {/* Список */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Название</th><th className="px-3 py-2">Тип документа</th>
              <th className="px-3 py-2">Тип договора</th><th className="px-3 py-2 text-right">Версия</th>
              <th className="px-3 py-2">Обновлён</th><th className="px-3 py-2">Активен</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2 font-medium">{t.name}</td>
                <td className="px-3 py-2">{DOC_TYPES[t.doc_type] ?? t.doc_type}</td>
                <td className="px-3 py-2">{t.contract_type == null ? "любой" : t.contract_type === "transportation" ? "перевозка" : "услуги техники"}</td>
                <td className="px-3 py-2 text-right tabular-nums">v{t.version}</td>
                <td className="px-3 py-2">{fmtDateTime(t.updated_at)}</td>
                <td className="px-3 py-2">
                  <button onClick={() => start(async () => { const r = await toggleTemplate(t.id, !t.is_active); if (r.ok) router.refresh(); else toast.error(r.error); })}>
                    {t.is_active ? <CheckCircle2 className="size-5 text-green-600" /> : <span className="text-xs text-muted-foreground">выкл</span>}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" title="Скачать" onClick={() => download(t.id)}><Download className="size-4" /></Button>
                    <Button variant="ghost" size="sm" title="Заменить новой версией" onClick={() => { setReplaceId(t.id); replaceRef.current?.click(); }}><Upload className="size-4" /></Button>
                    <Button variant="ghost" size="sm" title="Проверить на демо-данных" onClick={() => testRender(t.id)}><FlaskConical className="size-4" /></Button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                Шаблонов нет — используются встроенные формы. Загрузите фирменный .docx с плейсхолдерами.
              </td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Справочник плейсхолдеров */}
      <section className="rounded-lg border p-4">
        <p className="mb-2 text-sm font-medium">Плейсхолдеры для вставки в Word</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Правка шаблона: скачать → отредактировать в Word → загрузить как новую версию (кнопка «Заменить»).
          После загрузки нажмите «Проверить» — система отрендерит демо-документ и покажет ошибки плейсхолдеров.
        </p>
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          {PLACEHOLDERS.map(([ph, desc]) => (
            <div key={ph} className="flex items-baseline gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{ph}</code>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
