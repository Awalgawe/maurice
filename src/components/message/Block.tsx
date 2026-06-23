import type { ContentBlock } from "../../types";
import { useT } from "../../hooks/useT";
import { Md } from "./Markdown";
import { TextBlock } from "./systemTags";
import { ToolResultBlock } from "./ToolResultBlock";
import { TOOL_INPUTS, ToolInput } from "./tools";

/** Renders one content block by kind. `compact` hides thinking (subagent view). */
export function Block({ b, compact }: { b: ContentBlock; compact: boolean }) {
  const t = useT();
  switch (b.kind) {
    case "text":
      return (
        <div className="block markdown">
          <TextBlock text={b.text} />
        </div>
      );
    case "thinking":
      if (compact) return null;
      return (
        <details className="block thinking collapsible">
          <summary>{t("block_thinking")}</summary>
          <Md>{b.text}</Md>
        </details>
      );
    case "tool_use": {
      const inp = typeof b.input === "object" && b.input !== null ? b.input as Record<string, unknown> : null;
      const tname = b.isMcp ? b.name.replace(/^mcp__/, "mcp:") : b.name;
      const ToolBody = inp ? TOOL_INPUTS[b.name] : undefined;
      return (
        <div className="block tool_use">
          <span className={"tname" + (b.isMcp ? " mcp" : "")}>{tname}</span>
          {ToolBody && inp ? <ToolBody input={inp} /> : <ToolInput input={b.input} />}
        </div>
      );
    }
    case "tool_result":
      return <ToolResultBlock b={b} />;
  }
}
