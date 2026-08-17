import { useT } from "../../../hooks/useT";
import { highlightCode } from "../../../lib/highlight";
import { TODO_STATUS } from "./constants";

export function ToolSearchInput({ input }: { input: Record<string, unknown> }) {
  const t = useT();
  const query = typeof input.query === "string" ? input.query : null;
  const max = typeof input.max_results === "number" ? input.max_results : null;
  return (
    <>
      {query && <span className="muted tool-search-query"> {query}</span>}
      {max != null && <span className="muted"> ({t("tool_search_max")} {max})</span>}
    </>
  );
}

export function GrepInput({ input }: { input: Record<string, unknown> }) {
  const t = useT();
  const pattern = typeof input.pattern === "string" ? input.pattern : null;
  const path = typeof input.path === "string" ? input.path : null;
  const glob = typeof input.glob === "string" ? input.glob : null;
  return (
    <>
      {pattern && <code className="grep-pattern"> /{pattern}/</code>}
      {(path || glob) && <span className="muted"> {t("grep_in")} {path ?? glob}</span>}
    </>
  );
}

export function WebFetchInput({ input }: { input: Record<string, unknown> }) {
  const t = useT();
  const url = typeof input.url === "string" ? input.url : null;
  // Only http(s) becomes a clickable link; anything else (javascript:, data:…)
  // renders as inert text since the value comes straight from the logs.
  const safeUrl = url && /^https?:\/\//i.test(url) ? url : null;
  const label = url ? (url.length > 80 ? url.slice(0, 80) + "…" : url) : null;
  const prompt = typeof input.prompt === "string" ? input.prompt : null;
  return (
    <>
      {safeUrl
        ? <a className="muted bash-desc" href={safeUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>{label}</a>
        : label && <span className="muted bash-desc" style={{ marginLeft: 6 }}>{label}</span>}
      {prompt && <details className="plan-body"><summary>{t("tool_prompt_label")}</summary><div className="plan-content">{prompt}</div></details>}
    </>
  );
}

export function WebSearchInput({ input }: { input: Record<string, unknown> }) {
  const query = typeof input.query === "string" ? input.query : null;
  return <>{query && <span className="muted bash-desc"> {query}</span>}</>;
}

export function TodoWriteInput({ input }: { input: Record<string, unknown> }) {
  const todos = Array.isArray(input.todos) ? input.todos as Record<string, unknown>[] : [];
  return (
    <div className="todo-list">
      {todos.map((t, i) => (
        <div key={i} className="todo-item">
          <span className={"todo-status " + String(t.status ?? "")}>{TODO_STATUS[String(t.status ?? "")] ?? "·"}</span>
          <span>{String(t.content ?? "")}</span>
        </div>
      ))}
    </div>
  );
}

export function TaskCreateInput({ input }: { input: Record<string, unknown> }) {
  const t = useT();
  const subject = typeof input.subject === "string" ? input.subject : null;
  const desc = typeof input.description === "string" ? input.description : null;
  return (
    <>
      {subject && <span className="muted bash-desc"> {subject}</span>}
      {desc && <details className="plan-body"><summary>{t("tool_desc_label")}</summary><div className="plan-content">{desc}</div></details>}
    </>
  );
}

export function TaskUpdateInput({ input }: { input: Record<string, unknown> }) {
  const id = typeof input.taskId === "string" ? input.taskId : null;
  const status = typeof input.status === "string" ? input.status : null;
  return (
    <>
      {id && <span className="muted bash-desc"> #{id}</span>}
      {status && <span className="chip" style={{ marginLeft: 4 }}>{TODO_STATUS[status] ?? ""} {status}</span>}
    </>
  );
}

export function ScheduleWakeupInput({ input }: { input: Record<string, unknown> }) {
  const reason = typeof input.reason === "string" ? input.reason : null;
  const delay = typeof input.delaySeconds === "number" ? input.delaySeconds : null;
  const mins = delay != null ? (delay < 60 ? `${delay}s` : `${Math.round(delay / 60)}min`) : null;
  return (
    <>
      {mins && <span className="chip" style={{ marginLeft: 4 }}>⏱ {mins}</span>}
      {reason && <span className="muted bash-desc"> {reason}</span>}
    </>
  );
}

export function PushNotificationInput({ input }: { input: Record<string, unknown> }) {
  const msg = typeof input.message === "string" ? input.message : null;
  const status = typeof input.status === "string" ? input.status : null;
  return (
    <>
      {status && <span className="chip" style={{ marginLeft: 4 }}>{status}</span>}
      {msg && <span className="muted bash-desc"> {msg}</span>}
    </>
  );
}

/**
 * Serialised tool input, or null when there is nothing worth showing.
 * Shared with the block-level copy button so both agree on what "empty" means.
 */
export function toolInputJson(input: unknown): string | null {
  if (input == null) return null;
  let s: string;
  try {
    s = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  } catch {
    return null;
  }
  return s === "{}" || s === "null" || s === '""' ? null : s;
}

/** Generic JSON fallback for tools without a dedicated renderer. */
export function ToolInput({ input }: { input: unknown }) {
  const s = toolInputJson(input);
  if (s === null) return null;
  const truncated = s.length > 3000 ? s.slice(0, 3000) + "\n…" : s;
  const html = highlightCode(truncated, "json");
  return (
    <pre className="json-view">
      {html
        ? <code className="hljs language-json" dangerouslySetInnerHTML={{ __html: html }} />
        : <code>{truncated}</code>}
    </pre>
  );
}
