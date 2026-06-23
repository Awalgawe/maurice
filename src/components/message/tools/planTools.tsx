import { useT } from "../../../hooks/useT";
import { Md } from "../Markdown";

export function ExitPlanModeInput({ input }: { input: Record<string, unknown> }) {
  const t = useT();
  const plan = typeof input.plan === "string" ? input.plan : null;
  const allowed = Array.isArray(input.allowedPrompts) ? input.allowedPrompts as {tool:string;prompt:string}[] : [];
  const title = plan?.split("\n")[0]?.replace(/^#+\s*/, "") ?? null;
  return (
    <>
      {title && <span className="muted plan-title"> {title}</span>}
      {allowed.length > 0 && (
        <span className="muted"> · {allowed.map(a => a.prompt).join(", ")}</span>
      )}
      {plan && (
        <details className="plan-body">
          <summary>{t("tool_plan_label")}</summary>
          <div className="plan-content"><Md>{plan}</Md></div>
        </details>
      )}
    </>
  );
}

export function AgentInput({ input }: { input: Record<string, unknown> }) {
  const t = useT();
  const desc = typeof input.description === "string" ? input.description : null;
  const type = typeof input.subagent_type === "string" ? input.subagent_type : null;
  const prompt = typeof input.prompt === "string" ? input.prompt : null;
  const iso = input.isolation === "worktree";
  return (
    <>
      {type && <span className="chip" style={{ marginLeft: 4 }}>{type}</span>}
      {iso && <span className="chip" style={{ marginLeft: 4 }}>{t("tool_worktree")}</span>}
      {desc && <span className="muted bash-desc"> {desc}</span>}
      {prompt && (
        <details className="plan-body">
          <summary>{t("tool_prompt_label")}</summary>
          <div className="plan-content"><Md>{prompt}</Md></div>
        </details>
      )}
    </>
  );
}

export function AskUserQuestionInput({ input }: { input: Record<string, unknown> }) {
  const questions = Array.isArray(input.questions) ? input.questions as Record<string, unknown>[] : [];
  return (
    <div className="ask-questions">
      {questions.map((q, i) => (
        <div key={i} className="ask-q">
          <span className="ask-header">{String(q.header ?? "")}</span>
          <span className="muted"> {String(q.question ?? "")}</span>
          {Array.isArray(q.options) && (
            <div className="ask-options">
              {(q.options as Record<string, unknown>[]).map((o, j) => (
                <span key={j} className="ask-option">{String(o.label ?? "")}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SkillInput({ input }: { input: Record<string, unknown> }) {
  const skill = typeof input.skill === "string" ? input.skill : null;
  const args = typeof input.args === "string" && input.args ? input.args : null;
  return (
    <>
      {skill && <span className="cmd-tag" style={{ marginLeft: 4 }}>⚙ {skill}</span>}
      {args && <span className="muted bash-desc"> {args}</span>}
    </>
  );
}
