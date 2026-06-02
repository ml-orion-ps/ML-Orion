import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Button } from "@/components/ui/button";
import {
  Rocket, PauseCircle, Code2, ChevronUp, ChevronDown,
  FileCode, CheckCircle2, Pencil, X, RotateCcw, Save, Sparkles,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const BAR_COLORS = ["#3b82f6", "#8b5cf6", "#10b981"];
const KPI_COLORS = ["#ef4444","#f59e0b","#3b82f6","#8b5cf6","#10b981","#ec4899","#14b8a6","#f43f5e","#84cc16","#06b6d4"];

type CodeFileTab = { id: string; label: string; description: string };
type CodeFileContent = { id: string; label: string; description: string; content: string; lines: number; lastModified: string };

function getAnomalyData(m: any) {
  const weights  = m.modelWeights || {};
  const summary  = (typeof weights === "object" && weights.summary) ? weights.summary : {};
  const kpiStats = summary.kpiStats || {};
  return {
    totalAnomalies: summary.totalAnomalies as number | undefined,
    totalRows:      summary.totalRows      as number | undefined,
    kpisProcessed:  (summary.kpisProcessed || []) as string[],
    kpiStats,
  };
}

export default function OrionOverview() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [codeOpen,     setCodeOpen]     = useState(true);
  const [activeFileId, setActiveFileId] = useState("kpi_anomaly");
  const [editMode,     setEditMode]     = useState(false);
  const [editContent,  setEditContent]  = useState<string | null>(null);
  const [savedBanner,  setSavedBanner]  = useState(false);

  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/retail/kpiAnomaly/orion/overview"] });
  const { data: models }    = useQuery<any[]>({ queryKey: ["/api/retail/kpiAnomaly/models"] });

  const { data: codeFiles } = useQuery<CodeFileTab[]>({ queryKey: ["/api/retail/kpiAnomaly/code/files"] });
  const { data: codeFile, isLoading: codeLoading } = useQuery<CodeFileContent>({
    queryKey: ["/api/retail/kpiAnomaly/code", activeFileId],
    enabled: codeOpen && Boolean(activeFileId),
  });

  const deployMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/retail/kpiAnomaly/models/${id}/deploy`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/models"] });
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/orion/overview"] });
      toast({ title: "Model deployed" });
    },
  });
  const undeployMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/retail/kpiAnomaly/models/${id}/undeploy`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/models"] });
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/orion/overview"] });
      toast({ title: "Model undeployed" });
    },
  });
  const saveMut = useMutation({
    mutationFn: async ({ fileId, content }: { fileId: string; content: string }) => {
      const response = await apiRequest("PUT", `/api/retail/kpiAnomaly/code/${fileId}`, { content });
      return response.json();
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/code", activeFileId] });
      setEditMode(false);
      setSavedBanner(true);
      setTimeout(() => setSavedBanner(false), 2500);
      toast({ title: "Code saved" });
    },
    onError: (error: any) => toast({ title: "Save failed", description: error.message, variant: "destructive" }),
  });

  const startEdit  = () => { if (!codeFile) return; setEditContent(codeFile.content); setEditMode(true); };
  const cancelEdit = () => { setEditMode(false); setEditContent(codeFile?.content ?? null); };
  const saveEdit   = () => { if (!activeFileId || editContent === null) return; saveMut.mutate({ fileId: activeFileId, content: editContent }); };

  const kpis       = data?.kpis || {};
  const allModels: any[] = models || [];
  const deployedModels   = allModels.filter((m: any) => m.isDeployed);

  // Aggregate anomaly stats across all models
  const totalAnomalies = allModels.reduce((s, m) => s + (getAnomalyData(m).totalAnomalies ?? 0), 0);
  const totalRows      = allModels.reduce((s, m) => s + (getAnomalyData(m).totalRows ?? 0), 0);
  const anomalyRate    = totalRows > 0 ? ((totalAnomalies / totalRows) * 100).toFixed(1) : "—";

  // All unique KPIs monitored across all models
  const allKpis = Array.from(
    new Set(allModels.flatMap(m => getAnomalyData(m).kpisProcessed))
  );

  // Per-model anomaly rate chart
  const perfData = allModels.slice(0, 6).map((m: any) => {
    const d    = getAnomalyData(m);
    const rate = d.totalRows ? parseFloat(((d.totalAnomalies ?? 0) / d.totalRows * 100).toFixed(1)) : 0;
    return { name: (m.name || "").slice(0, 20), anomalyRate: rate };
  });

  // KPI anomaly breakdown from latest model
  const latestModel = [...allModels].sort((a, b) =>
    new Date(b.trainedAt ?? 0).getTime() - new Date(a.trainedAt ?? 0).getTime()
  )[0];
  const latestKpiStats = latestModel ? getAnomalyData(latestModel).kpiStats : {};
  const kpiChartData = Object.entries(latestKpiStats as Record<string, any>)
    .map(([name, s]: [string, any]) => ({
      name,
      anomalies: (s.anomalyCount ?? s.total_anomalies ?? 0) as number,
    }))
    .sort((a, b) => b.anomalies - a.anomalies)
    .slice(0, 10);

  return (
    <OrionLayout title="ML Orion Overview" subtitle="KPI anomaly detection — all numbers from live database" isLoading={isLoading}>
      <div className="mb-4">
        <OrionNav current="/retail/kpi-anomaly/orion/overview" basePath="/retail/kpi-anomaly/orion" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Total Models"    value={allModels.length || kpis.totalModels || 0} />
        <KpiCard label="Deployed"        value={deployedModels.length} color={deployedModels.length > 0 ? "green" : "default"} trend={deployedModels.length > 0 ? "up" : undefined} />
        <KpiCard label="KPIs Monitored"  value={allKpis.length || kpis.kpisMonitored || 0} color="blue" />
        <KpiCard label="Total Datasets"  value={kpis.totalDatasets ?? "—"} />
        <KpiCard label="Total Anomalies" value={totalAnomalies > 0 ? totalAnomalies.toLocaleString() : (kpis.totalAnomalies ?? "—")} color={totalAnomalies > 0 ? "amber" : "default"} trend={totalAnomalies > 0 ? "up" : undefined} />
        <KpiCard label="Rows Scored"     value={totalRows > 0 ? totalRows.toLocaleString() : (kpis.totalRowsScored?.toLocaleString() ?? "—")} />
        <KpiCard label="Anomaly Rate"    value={anomalyRate !== "—" ? `${anomalyRate}%` : "—"} color={parseFloat(anomalyRate) > 20 ? "amber" : "green"} />
        <KpiCard label="Promo Analyses"  value={allModels.length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="text-sm font-semibold mb-4">Anomaly Rate per Model</h3>
          {perfData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No models trained yet. Go to Experiment Lab to run your first detection.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={perfData} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                <Tooltip formatter={(v: any) => `${v}%`} />
                <Bar dataKey="anomalyRate" name="Anomaly Rate" fill={BAR_COLORS[0]} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="border rounded-lg p-4 bg-card">
          <h3 className="text-sm font-semibold mb-1">KPI Anomaly Breakdown</h3>
          <p className="text-xs text-muted-foreground mb-3">Anomaly counts per KPI — latest model</p>
          {kpiChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Run a KPI anomaly experiment to see per-KPI results.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={kpiChartData} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="anomalies" name="Anomaly Count" radius={[2, 2, 0, 0]}>
                  {kpiChartData.map((_, i) => (
                    <Cell key={i} fill={KPI_COLORS[i % KPI_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Backend Code Explorer */}
      <div className="border rounded-lg bg-card mb-4 overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
          onClick={() => { setCodeOpen(o => !o); setEditMode(false); setEditContent(null); }}
          data-testid="button-toggle-code-explorer"
        >
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-primary" />
            <div>
              <span className="text-sm font-semibold">Backend Code Explorer</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">Review and modify ML pipeline source files — changes hot-reload immediately</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!codeOpen && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                {(codeFiles || []).length} files accessible
              </span>
            )}
            {codeOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </button>

        {codeOpen && (
          <div className="border-t">
            <div className="flex items-center gap-0 border-b bg-muted/20 overflow-x-auto">
              {(codeFiles || [
                { id: "kpi_anomaly", label: "KPI Anomaly Engine" },
                { id: "ml_service",  label: "ML Service" },
                { id: "storage",     label: "Storage Layer" },
                { id: "models",      label: "ORM Models" },
                { id: "schema",      label: "Data Schema" },
              ]).map((f: any) => (
                <button
                  key={f.id}
                  onClick={() => { setActiveFileId(f.id); setEditMode(false); setEditContent(null); }}
                  data-testid={`tab-code-${f.id}`}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeFileId === f.id
                      ? "border-primary text-primary bg-background"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                >
                  <FileCode className="w-3 h-3" />
                  {f.label}
                </button>
              ))}
            </div>

            {codeFile && !codeLoading && (
              <div className="flex items-center justify-between px-4 py-2 bg-muted/10 border-b text-[10px] text-muted-foreground">
                <div className="flex items-center gap-4">
                  <span className="font-mono text-foreground font-medium">{activeFileId}</span>
                  <span>{codeFile.lines?.toLocaleString()} lines</span>
                  <span>Last modified: {new Date(codeFile.lastModified).toLocaleString()}</span>
                  {savedBanner && (
                    <span className="flex items-center gap-1 text-emerald-700 font-medium">
                      <CheckCircle2 className="w-3 h-3" /> Saved successfully
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!editMode ? (
                    <button onClick={startEdit} className="flex items-center gap-1 px-2 py-1 rounded border border-border hover:border-primary/50 hover:text-primary transition-colors" data-testid="button-edit-code">
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  ) : (
                    <>
                      <button onClick={cancelEdit} className="flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted transition-colors" data-testid="button-cancel-edit">
                        <X className="w-3 h-3" /> Cancel
                      </button>
                      <button onClick={() => setEditContent(codeFile.content)} className="flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted transition-colors" data-testid="button-reset-code">
                        <RotateCcw className="w-3 h-3" /> Reset
                      </button>
                      <button onClick={saveEdit} disabled={saveMut.isPending} className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50" data-testid="button-save-code">
                        <Save className="w-3 h-3" /> {saveMut.isPending ? "Deploying..." : "Deploy Changes"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {codeFile && !codeLoading && (
              <div className="px-4 py-2 border-b bg-blue-500/5 border-blue-500/20">
                <p className="text-[10px] text-blue-800 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 flex-shrink-0" />
                  {codeFile.description}
                </p>
              </div>
            )}

            {codeLoading && <div className="h-64 flex items-center justify-center text-xs text-muted-foreground animate-pulse">Loading file...</div>}

            {!codeLoading && codeFile && (
              editMode ? (
                <textarea
                  className="w-full font-mono text-[11px] leading-5 bg-gray-950 text-gray-100 p-4 resize-none outline-none border-0"
                  style={{ height: "520px", tabSize: 2 }}
                  value={editContent ?? ""}
                  onChange={e => setEditContent(e.target.value)}
                  spellCheck={false}
                  data-testid="textarea-code-editor"
                  onKeyDown={e => {
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const start = e.currentTarget.selectionStart;
                      const end   = e.currentTarget.selectionEnd;
                      const val   = editContent ?? "";
                      setEditContent(val.substring(0, start) + "  " + val.substring(end));
                      setTimeout(() => { e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 2; }, 0);
                    }
                  }}
                />
              ) : (
                <div className="relative bg-gray-950 overflow-auto" style={{ maxHeight: "520px" }}>
                  <pre className="text-[11px] leading-5 text-gray-100 p-4 m-0 whitespace-pre font-mono">
                    {(codeFile.content || "").split("\n").map((line: string, i: number) => (
                      <div key={i} className="flex">
                        <span className="select-none text-gray-600 pr-4 text-right min-w-[3rem]">{i + 1}</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Model Registry */}
      <div className="border rounded-lg bg-card">
        <div className="p-4 border-b">
          <h3 className="text-sm font-semibold">Model Registry</h3>
          <p className="text-xs text-muted-foreground mt-1">Manage all trained KPI anomaly models — deploy to activate live detection</p>
        </div>
        {(!models || models.length === 0) ? (
          <p className="text-sm text-muted-foreground text-center py-10">No models yet. Train your first model in the Experiment Lab.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {["Name", "Algorithm", "Status", "Total Anomalies", "Rows Scored", "KPIs Processed", "Actions"].map(h => (
                    <th key={h} className="text-left p-3 font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {models.map((m: any) => {
                  const d = getAnomalyData(m);
                  return (
                    <tr key={m.id} className="border-t hover:bg-muted/30 transition-colors" data-testid={`row-model-${m.id}`}>
                      <td className="p-3 font-medium max-w-[180px] truncate" title={m.name}>{m.name}</td>
                      <td className="p-3 text-muted-foreground">{m.algorithm}</td>
                      <td className="p-3"><StatusBadge status={m.isDeployed ? "Production" : m.status} /></td>
                      <td className="p-3 font-semibold text-amber-600">{d.totalAnomalies != null ? d.totalAnomalies.toLocaleString() : "—"}</td>
                      <td className="p-3">{d.totalRows != null ? d.totalRows.toLocaleString() : "—"}</td>
                      <td className="p-3">{d.kpisProcessed.length > 0 ? d.kpisProcessed.length : "—"}</td>
                      <td className="p-3">
                        {m.isDeployed ? (
                          <Button size="sm" variant="outline" className="h-6 text-xs gap-1" data-testid={`button-undeploy-${m.id}`}
                            onClick={() => undeployMut.mutate(m.id)} disabled={undeployMut.isPending}>
                            <PauseCircle className="w-3 h-3" /> Undeploy
                          </Button>
                        ) : (
                          <Button size="sm" className="h-6 text-xs gap-1" data-testid={`button-deploy-${m.id}`}
                            onClick={() => deployMut.mutate(m.id)} disabled={deployMut.isPending}>
                            <Rocket className="w-3 h-3" /> Deploy
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </OrionLayout>
  );
}
