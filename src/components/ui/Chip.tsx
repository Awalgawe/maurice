import React from "react";

type Variant = "skill" | "ticket" | "err" | "sub" | "model";

/** Pill badge. `variant` maps to the existing .chip.skill/.ticket/.err/.sub styles. */
export function Chip({
  variant,
  className,
  style,
  children,
}: {
  variant?: Variant;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const cls = "chip" + (variant ? " " + variant : "") + (className ? " " + className : "");
  return <span className={cls} style={style}>{children}</span>;
}
