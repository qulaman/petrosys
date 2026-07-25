"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadBase64, XLSX_MIME } from "@/lib/download";
import { exportDirectoriesXlsx } from "@/app/fleet/admin/actions";

/** Выгрузка всех справочников одной книгой Excel (лист на справочник). */
export function ExportDirectoriesButton() {
  const [pending, start] = useTransition();

  return (
    <Button
      variant="outline"
      className="gap-2"
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await exportDirectoriesXlsx();
          if (!res.ok) { toast.error(res.error); return; }
          downloadBase64(res.filename, res.base64, XLSX_MIME);
          toast.success("Справочники выгружены");
        })
      }
    >
      <Download className="size-5" /> Выгрузить все справочники (Excel)
    </Button>
  );
}
