"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmOptions {
  title: string;
  /** Что именно произойдёт и почему это необратимо — одной-двумя фразами. */
  description?: string;
  /** Отдельное предупреждение красным: последствие за пределами самой записи. */
  warning?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Удаление и прочее разрушающее — красной кнопкой. */
  destructive?: boolean;
}

/**
 * Подтверждение необратимого действия одним вызовом:
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ title: "Удалить рейс?" }))) return;
 *   …
 *   return (<>{…}{confirmDialog}</>);
 *
 * Заменяет `window.confirm` (нестилизованный, блокирует поток и запрещён в PWA
 * на части устройств) и разнобой из самодельных диалогов.
 */
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setOpts(options);
      }),
    [],
  );

  const finish = useCallback((ok: boolean) => {
    setOpts(null);
    resolveRef.current?.(ok);
    resolveRef.current = null;
  }, []);

  const confirmDialog = (
    <Dialog open={opts !== null} onOpenChange={(open) => { if (!open) finish(false); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{opts?.title}</DialogTitle>
        </DialogHeader>
        {opts?.description ? (
          <p className="text-sm text-muted-foreground">{opts.description}</p>
        ) : null}
        {opts?.warning ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
            {opts.warning}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => finish(false)}>
            {opts?.cancelLabel ?? "Отмена"}
          </Button>
          <Button
            variant={opts?.destructive ? "destructive" : "default"}
            onClick={() => finish(true)}
          >
            {opts?.confirmLabel ?? "Продолжить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, confirmDialog };
}
