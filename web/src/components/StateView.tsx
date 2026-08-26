import type { ReactNode } from "react";

export function Banner({ kind, children }: { kind: "warn" | "error" | "info" | "muted"; children: ReactNode }) {
  return (
    <div className={`banner banner-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span className={`dot${kind === "info" ? " pulse" : ""}`} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
