import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { SubagentDetail } from "../types";
import { getSubagent } from "../api";
import { modelLabel } from "../format";
import { useT } from "../hooks/useT";
import { ThreadDetail } from "../components/thread/ThreadDetail";
import { Chip } from "../components/ui/Chip";

export default function SubagentDetailPage() {
  const t = useT();
  const { id, ref } = useParams<{ id: string; ref: string }>();
  const [data, setData] = useState<SubagentDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !ref) return;
    setData(null);
    setErr(null);
    getSubagent(id, ref).then(setData).catch((e) => setErr(String(e)));
  }, [id, ref]);

  if (err) return <div className="center">{t("detail_error_prefix")}{err}</div>;
  if (!data) return <div className="center">{t("subagent_loading")}</div>;

  const backTo = data.parentRef
    ? {
        url: `/sessions/${data.sessionId}/subagents/${encodeURIComponent(data.parentRef)}`,
        label: `← ${data.parentAgentType || "agent"}`,
      }
    : { url: `/sessions/${data.sessionId}`, label: t("subagent_back") };

  return (
    <ThreadDetail
      sessionId={data.sessionId}
      backTo={backTo}
      title={data.agentType || "agent"}
      headerChips={
        <>
          {data.models.map((mdl) => <Chip variant="model" key={mdl}>{modelLabel(mdl)}</Chip>)}
          {data.errorCount > 0 && <Chip variant="warn">{data.errorCount} {t("subagent_errors")}</Chip>}
        </>
      }
      description={data.description}
      messages={data.messages}
      context={data.context}
      subagents={data.subagents}
      estCostUSD={data.estCostUSD}
      tokens={data.tokens}
      costByComponent={data.costByComponent}
      cacheRewriteWastedUSD={data.cacheRewriteWastedUSD}
      withSubagentsCostUSD={data.costWithChildrenUSD}
      models={data.models}
      start={data.start}
      end={data.end}
    />
  );
}
