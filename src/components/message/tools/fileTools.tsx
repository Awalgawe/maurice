import { useT } from "../../../hooks/useT";
import { FilePath } from "../FilePath";

export function BashInput({ input }: { input: Record<string, unknown> }) {
  const t = useT();
  const cmd = typeof input.command === "string" ? input.command : null;
  const desc = typeof input.description === "string" ? input.description : null;
  const bg = input.run_in_background === true;
  return (
    <>
      {desc && <span className="muted bash-desc"> {desc}</span>}
      {bg && <span className="chip" style={{ marginLeft: 6 }}>{t("tool_bg")}</span>}
      {cmd && <pre className="bash-cmd">{cmd}</pre>}
    </>
  );
}

export function EditInput({ input }: { input: Record<string, unknown> }) {
  const t = useT();
  const fp = typeof input.file_path === "string" ? input.file_path : null;
  const old_ = typeof input.old_string === "string" ? input.old_string : "";
  const new_ = typeof input.new_string === "string" ? input.new_string : "";
  const all = input.replace_all === true;
  const oldLines = old_.split("\n").slice(0, 5);
  const newLines = new_.split("\n").slice(0, 5);
  return (
    <>
      {fp && <> <FilePath path={fp} />{all && <span className="chip" style={{ marginLeft: 4 }}>{t("tool_all")}</span>}</>}
      <details className="edit-diff">
        <summary>{old_.split("\n").length}L → {new_.split("\n").length}L</summary>
        <div className="edit-diff-body">
          {oldLines.map((l, i) => <div key={"o" + i} className="diff-del">- {l}</div>)}
          {old_.split("\n").length > 5 && <div className="muted">… +{old_.split("\n").length - 5} {t("file_diff_lines")}</div>}
          {newLines.map((l, i) => <div key={"n" + i} className="diff-add">+ {l}</div>)}
          {new_.split("\n").length > 5 && <div className="muted">… +{new_.split("\n").length - 5} {t("file_diff_lines")}</div>}
        </div>
      </details>
    </>
  );
}

export function ReadInput({ input }: { input: Record<string, unknown> }) {
  const fp = typeof input.file_path === "string" ? input.file_path : null;
  const offset = typeof input.offset === "number" ? input.offset : null;
  const limit = typeof input.limit === "number" ? input.limit : null;
  return (
    <>
      {fp && <> <FilePath path={fp} /></>}
      {(offset != null || limit != null) && (
        <span className="muted"> [{offset ?? 0}…{limit != null ? (offset ?? 0) + limit : "∞"}]</span>
      )}
    </>
  );
}

export function WriteInput({ input }: { input: Record<string, unknown> }) {
  const fp = typeof input.file_path === "string" ? input.file_path : null;
  const lines = typeof input.content === "string" ? input.content.split("\n").length : null;
  return (
    <>
      {fp && <> <FilePath path={fp} /></>}
      {lines != null && <span className="muted"> ({lines}L)</span>}
    </>
  );
}
