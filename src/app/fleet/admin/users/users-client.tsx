"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/roles";
import type { AppUser, UsersScreenData } from "@/lib/data/users";
import { createUserAction, updateUserAction } from "./actions";

const empty = {
  email: "",
  password: "",
  full_name: "",
  roles: [] as Role[],
  contractor_id: "" as string,
};

export function UsersClient({ data }: { data: UsersScreenData }) {
  const { users, contractors } = data;
  const router = useRouter();
  const [editing, setEditing] = useState<AppUser | "new" | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function openNew() {
    setForm({ ...empty });
    setEditing("new");
    setError(null);
  }
  function openEdit(u: AppUser) {
    setForm({
      email: u.email ?? "",
      password: "",
      full_name: u.full_name ?? "",
      roles: u.roles as Role[],
      contractor_id: u.contractor_id ?? "",
    });
    setEditing(u);
    setError(null);
  }

  function toggleRole(r: Role) {
    setForm((s) => ({
      ...s,
      roles: s.roles.includes(r) ? s.roles.filter((x) => x !== r) : [...s.roles, r],
    }));
  }

  function save() {
    setError(null);
    start(async () => {
      const contractor_id = form.roles.includes("contractor")
        ? form.contractor_id || null
        : null;
      const res =
        editing === "new"
          ? await createUserAction({
              email: form.email,
              password: form.password,
              full_name: form.full_name,
              roles: form.roles,
              contractor_id,
            })
          : await updateUserAction({
              user_id: (editing as AppUser).id,
              full_name: form.full_name,
              roles: form.roles,
              contractor_id,
            });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success("Пользователь сохранён");
      setEditing(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Всего: {users.length}</p>
        <Button size="sm" onClick={openNew}>
          <Plus className="size-4" /> Добавить пользователя
        </Button>
      </div>

      {editing ? (
        <div className="rounded-lg border p-4">
          <p className="mb-3 font-medium">
            {editing === "new" ? "Новый пользователь" : "Изменить пользователя"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {editing === "new" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" value={form.email}
                    onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="password">Пароль *</Label>
                  <Input id="password" type="text" value={form.password}
                    onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))} />
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>Email</Label>
                <p className="text-sm text-muted-foreground">{(editing as AppUser).email}</p>
              </div>
            )}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="full_name">ФИО *</Label>
              <Input id="full_name" value={form.full_name}
                onChange={(e) => setForm((s) => ({ ...s, full_name: e.target.value }))} />
            </div>
          </div>

          <div className="mt-3">
            <Label>Роли *</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <label key={r}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                    form.roles.includes(r) ? "border-primary bg-accent" : ""
                  }`}>
                  <input type="checkbox" checked={form.roles.includes(r)}
                    onChange={() => toggleRole(r)} className="size-4" />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
          </div>

          {form.roles.includes("contractor") ? (
            <div className="mt-3 flex flex-col gap-1.5">
              <Label htmlFor="contractor">Контрагент (для роли «Подрядчик») *</Label>
              <select id="contractor" value={form.contractor_id}
                onChange={(e) => setForm((s) => ({ ...s, contractor_id: e.target.value }))}
                className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="">—</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          ) : null}

          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          <div className="mt-4 flex gap-2">
            <Button onClick={save} disabled={pending}>
              {pending ? "Сохранение…" : "Сохранить"}
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)}>Отмена</Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">ФИО</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Роли</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-3 py-2">{u.full_name ?? "—"}</td>
                <td className="px-3 py-2">{u.email ?? "—"}</td>
                <td className="px-3 py-2">
                  {u.roles.map((r) => ROLE_LABELS[r as Role] ?? r).join(", ") || "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                    <Pencil className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  Пользователей нет
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
