import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { IconComponent } from "@/types/editor";

export function DialogFrame({
  title,
  icon: Icon,
  onClose,
  children,
}: {
  title: string;
  icon: IconComponent;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <section className="max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-md border border-border bg-background shadow-2xl">
        <div className="flex h-11 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2 text-sm font-black">
            <Icon className="size-4 text-primary" />
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 place-items-center rounded bg-card text-muted-foreground hover:text-foreground"
            title="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[calc(86vh-44px)] overflow-y-auto p-4">{children}</div>
      </section>
    </div>
  );
}
