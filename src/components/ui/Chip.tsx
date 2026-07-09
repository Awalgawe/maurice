import React from "react";

type Variant = "skill" | "ticket" | "err" | "sub" | "model" | "warn";

/** Pill badge. `variant` maps to the existing .chip.skill/.ticket/.err/.sub styles. */
export function Chip({
  variant,
  className,
  style,
  title,
  children,
}: {
  variant?: Variant;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}) {
  const cls = "chip" + (variant ? " " + variant : "") + (className ? " " + className : "");
  return <span className={cls} style={style} title={title}>{children}</span>;
}
