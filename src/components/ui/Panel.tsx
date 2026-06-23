import React from "react";

/** Bordered card with an uppercase title — the aside building block. */
export function Panel({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
