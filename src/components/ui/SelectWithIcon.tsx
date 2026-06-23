import type { ReactNode } from "react";

export function SelectWithIcon({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <label className="select-with-icon">
      {icon}
      {children}
    </label>
  );
}

export const IconGlobe = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12" />
    <path d="M8 2c-1.5 2-2 4-2 6s.5 4 2 6" />
    <path d="M8 2c1.5 2 2 4 2 6s-.5 4-2 6" />
  </svg>
);

export const IconPalette = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" strokeLinecap="round">
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
  </svg>
);

export const IconCode = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 4L2 8l3 4" />
    <path d="M11 4l3 4-3 4" />
    <path d="M9.5 3l-3 10" />
  </svg>
);
