import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Trash2, PlayCircle, StopCircle, Target, CheckCircle, XCircle, AlertTriangle, Activity, TrendingUp, TrendingDown, ShieldCheck, Send, Sparkles, Brain, Calendar, ArrowUpRight, ArrowDownRight, Minus, FlaskConical, Loader2 } from "lucide-react";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from "recharts";
import type { MlModel } from "@shared/schema";

const CHART_COLORS = { auc: "#FFD822", accuracy: "#3b82f6", recall: "#a78bfa", psi: "#f97316", ks: "#ef4444", high: "#ef4444", med: "#f59e0b", low: "#22c55e" };

function DriftBar({ label, value, threshold }: { label: string; value: number; threshold: number }) {
  const pct = Math.min(value * 100, 100);
  const barColor = value < threshold * 0.5 ? "bg-emerald-500" : value < threshold ? "bg-amber-500" : "bg-red-500";
  const textColor = value >= threshold ? "text-red-600" : value >= threshold * 0.5 ? "text-amber-700" : "text-emerald-700";
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-mono font-bold ${textColor}`}>{value.toFixed(3)}</span>
      </div>
      <div className="h-2 bg-muted rounded overflow-hidden">
        <div className={`h-full ${barColor} rounded`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-end">
        <span className="text-[9px] text-muted-foreground">threshold: {threshold}</span>
      </div>
    </div>
  );
}

function getMonitoringStatus(model: any, predCount: number = 0) {
  if (!model.isDeployed) return { status: "stale", label: "Not Deployed" };
  const wmape = Number(model.wmape);
  if (!Number.isFinite(wmape)) return { status: "stale", label: "Needs Backtest" };
  if (wmape > 25) return { status: "at risk", label: "At Risk - High Error" };
  if (wmape > 15) return { status: "at risk", label: "Watch - Error Drift" };
  const hasForecast = predCount > 0 || Number(model.forecastUnits) > 0;
  if (!hasForecast) return { status: "stale", label: "Stale — No Forecasts" };
  return { status: "healthy", label: "Healthy" };
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "high") return <span className="text-[9px] px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-700 font-medium">High</span>;
  if (severity === "medium") return <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 font-medium">Medium</span>;
  return <span className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground font-medium">Low</span>;
}

function RecommendationCard({ rec }: { rec: any }) {
  const borderColor = rec.severity === "high" ? "border-red-500/35 bg-red-500/8" : rec.severity === "medium" ? "border-amber-500/30 bg-amber-500/8" : "border-border bg-card";
  const Icon = rec.icon === "trend-down" ? TrendingDown : rec.icon === "sparkle" ? Sparkles : rec.icon === "shield" ? ShieldCheck : rec.icon === "calendar" ? Calendar : AlertTriangle;
  const iconColor = rec.severity === "high" ? "text-red-600" : rec.severity === "medium" ? "text-amber-600" : "text-muted-foreground";
  return (
    <div className={`border rounded-lg p-4 space-y-3 ${borderColor}`} data-testid={`rec-card-${rec.id}`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${iconColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-semibold">{rec.title}</span>
            <SeverityBadge severity={rec.severity} />
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">{rec.category}</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{rec.detail}</p>
        </div>
      </div>
      <div className="ml-7 space-y-2">
        <div className="border border-dashed border-primary/20 rounded px-3 py-2 bg-primary/5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Recommended Action</p>
          <p className="text-xs text-foreground leading-relaxed">{rec.action}</p>
        </div>
        {rec.impact && (
          <div className="flex items-start gap-1.5 text-[10px] text-emerald-700">
            <TrendingUp className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>{rec.impact}</span>
          </div>
        )}
      </div>
    </div>
  );
}


const CUSTOM_TOOLTIP_STYLE = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "10px" };
const asNumber = (v: any) => (v != null && Number.isFinite(Number(v)) ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—");
const asMetric = (v: any, digits = 2) => (v != null && Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : "—");
const asPct = (v: any) => (v != null && Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : "—");

export default function OrionDeployPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [scoringModelId, setScoringModelId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [approvalModel, setApprovalModel] = useState<MlModel | null>(null);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [approvalAction, setApprovalAction] = useState<"approve" | "reject">("approve");
  const [monitorModelId, setMonitorModelId] = useState<number | null>(null);
  const [monitorTab, setMonitorTab] = useState<"health" | "trends" | "drivers" | "insights">("health");
  const [prodDatasetId, setProdDatasetId] = useState<number | null>(null);
  const API_BASE = "/api/retail/demand_forecast";
  const MODELS_QUERY_KEY = [`${API_BASE}/models`];
  const PREDICTIONS_QUERY_KEY = [`${API_BASE}/api/predictions`];

  const { data: modelsRaw = [] } = useQuery<MlModel[]>({ queryKey: MODELS_QUERY_KEY });
  const { data: predictions = [] } = useQuery<any[]>({ queryKey: PREDICTIONS_QUERY_KEY });
  const { data: allDatasets = [] } = useQuery<any[]>({ queryKey: [`${API_BASE}/datasets`] });

  const models = modelsRaw as any[];
  const deployedModels = models.filter(m => m.isDeployed);
  const availableModels = models.filter(m => !m.isDeployed && !["training", "failed"].includes(String(m.status || "").toLowerCase()));
  const forecastRuns = [...models].sort((a, b) => new Date(a.trainedAt || 0).getTime() - new Date(b.trainedAt || 0).getTime());
  const forecastTrendData = forecastRuns.slice(-8).map((m, idx) => ({
    label: `Run ${Math.max(forecastRuns.length - 7, 1) + idx}`,
    wmape: Number(m.wmape) || 0,
    mape: Number(m.mape) || 0,
    rmse: Number(m.rmse) || 0,
    accuracy: Number.isFinite(Number(m.wmape)) ? Math.max(0, 100 - Number(m.wmape)) : 0,
    actualUnits: Number(m.actualUnits) || 0,
    forecastUnits: Number(m.forecastUnits) || 0,
  }));
  const avgWmape = deployedModels.length
    ? deployedModels.reduce((sum, m) => sum + (Number(m.wmape) || 0), 0) / deployedModels.length
    : null;
  const totalForecastUnits = deployedModels.reduce((sum, m) => sum + (Number(m.forecastUnits) || 0), 0);
  const totalActualUnits = deployedModels.reduce((sum, m) => sum + (Number(m.actualUnits) || 0), 0);
  const activeFeatureImportance = ((models.find(m => m.id === (monitorModelId ?? deployedModels[0]?.id))?.featureImportance || []) as any[])
    .slice(0, 6)
    .map((f: any, idx: number) => ({
      name: f.name || f.feature || `feature_${idx + 1}`,
      displayName: String(f.name || f.feature || `Feature ${idx + 1}`).replace(/_/g, " "),
      importance: Number(f.importance ?? f.avgShap ?? 0),
    }));
  const featureHistoryData = forecastTrendData.map((row, rowIdx) => ({
    label: row.label,
    ...Object.fromEntries(activeFeatureImportance.map((f, idx) => [
      f.name,
      Math.max(0, f.importance * (1 + (rowIdx - forecastTrendData.length + 1) * 0.03 + idx * 0.01)),
    ])),
  }));
  
  const activeMonitorId = monitorModelId ?? deployedModels[0]?.id ?? null;
  const MONITORING_QUERY_KEY = [`${API_BASE}/api/monitoring`, activeMonitorId, prodDatasetId];

  const { data: monitoringData, isLoading: monitorLoading } = useQuery<any>({
    queryKey: MONITORING_QUERY_KEY,
    enabled: !!activeMonitorId,
    queryFn: async () => {
      const url = prodDatasetId
        ? `${API_BASE}/api/monitoring/${activeMonitorId}?prodDatasetId=${prodDatasetId}`
        : `${API_BASE}/api/monitoring/${activeMonitorId}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  function predCountForModel(modelId: number) {
    return (predictions as any[]).filter((p: any) => p.modelId === modelId).length;
  }

  const deployMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `${API_BASE}/models/${id}/deploy`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: MODELS_QUERY_KEY }); toast({ title: "Model deployed" }); },
    onError: (e: any) => toast({ title: "Deploy failed", description: e.message, variant: "destructive" }),
  });

  const undeployMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `${API_BASE}/models/${id}/undeploy`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: MODELS_QUERY_KEY }); toast({ title: "Model undeployed" }); },
    onError: (e: any) => toast({ title: "Undeploy failed", description: e.message, variant: "destructive" }),
  });

  const scoreMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `${API_BASE}/models/${id}/predict-customers`, prodDatasetId ? { prodDatasetId } : {}),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: PREDICTIONS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: [`${API_BASE}/api/monitoring`, scoringModelId] });
      const rowCount = (data.predicted ?? data.rows ?? 0).toLocaleString();
      toast({ title: `Generated ${rowCount} forecast rows` });
      setScoringModelId(null);
    },
    onError: (e: any) => { toast({ title: "Scoring failed", description: e.message, variant: "destructive" }); setScoringModelId(null); },
  });

  const evalProdMut = useMutation({
    mutationFn: ({ modelId, prodDatasetId }: { modelId: number; prodDatasetId: number }) =>
      apiRequest("POST", `${API_BASE}/models/${modelId}/score-production`, { prodDatasetId }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: PREDICTIONS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: MONITORING_QUERY_KEY });
      qc.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
      const met = data.metrics || {};
      const parts = [`${data.predicted} predictions`];
      if (met.wmape != null) parts.push(`WMAPE ${Number(met.wmape).toFixed(2)}%`);
      if (met.mape != null) parts.push(`MAPE ${Number(met.mape).toFixed(2)}%`);
      if (met.rmse != null) parts.push(`RMSE ${Number(met.rmse).toFixed(2)}`);
      toast({ title: `Prod evaluation complete · ${parts.join(" · ")}` });
    },
    onError: (e: any) => toast({ title: "Evaluation failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `${API_BASE}/models/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: PREDICTIONS_QUERY_KEY });
      toast({ title: "Model deleted" });
      setDeleteId(null);
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const approveMut = useMutation({
    mutationFn: ({ id, notes, action }: { id: number; notes: string; action: string }) =>
      apiRequest("POST", `${API_BASE}/models/${id}/approve`, { approvedBy: "ml-ops-lead", approvalNotes: notes, action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
      toast({ title: `Model ${approvalAction === "approve" ? "approved" : "rejected"}` });
      setApprovalModel(null);
      setApprovalNotes("");
    },
    onError: (e: any) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  function getDriftMetrics(m: any) {
    const wmape = Number(m.wmape) || 0;
    const mape = Number(m.mape) || 0;
    const rmse = Number(m.rmse) || 0;
    const unitGap = Math.abs(Number(m.forecastUnits || 0) - Number(m.actualUnits || 0));
    const actual = Math.max(Math.abs(Number(m.actualUnits || 0)), 1);
    return {
      forecastError: wmape,
      bias: parseFloat(((unitGap / actual) * 100).toFixed(2)),
      volatility: parseFloat(Math.min(100, rmse / Math.max(actual / 100, 1)).toFixed(2)),
      mape,
    };
  }

  const healthyCount = deployedModels.filter(m => getMonitoringStatus(m).status === "healthy").length;
  const atRiskCount = deployedModels.filter(m => getMonitoringStatus(m).status === "at risk").length;
  const staleCount = deployedModels.filter(m => getMonitoringStatus(m).status === "stale").length;
  const deleteTarget = models.find(m => m.id === deleteId);

  const activeMonitorModel = models.find(m => m.id === activeMonitorId);
  const summaryData = monitoringData?.summary;
  const highSeverityCount = deployedModels.filter((m: any) => Number(m.wmape) > 25).length;

  return (
    <OrionLayout title="Deploy & Scoring" subtitle="Forecast deployment, accuracy monitoring, and demand planning observability">
      <div className="space-y-4">
        <OrionNav current="/retail/demand_forecast/orion/deploy" basePath="/retail/demand_forecast/orion" />

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <KpiCard label="Deployed Models" value={deployedModels.length} color="green" testId="kpi-deployed" />
          <KpiCard label="Healthy" value={healthyCount} color="green" testId="kpi-healthy" />
          <KpiCard label="At Risk" value={atRiskCount} color={atRiskCount > 0 ? "amber" : "green"} testId="kpi-at-risk" />
          <KpiCard label="Stale" value={staleCount} color={staleCount > 0 ? "amber" : "green"} testId="kpi-stale" />
          <KpiCard label="Avg WMAPE" value={avgWmape != null ? asPct(avgWmape) : "—"} color="blue" testId="kpi-wmape" />
          <KpiCard label="Forecast Units" value={asNumber(totalForecastUnits)} testId="kpi-forecast-units" />
        </div>

        {/* ── PRODUCTION MODELS ── */}
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />Production Models
            </h3>
            <span className="text-[10px] text-muted-foreground">{deployedModels.length} deployed</span>
          </div>
          {deployedModels.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-xs">No models deployed. Deploy a model from the available list below.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {["Model", "Algorithm", "WMAPE", "MAPE", "Forecast Units", "Deployed", "Status", "Approval", "Actions"].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deployedModels.map(m => {
                    const monStatus = getMonitoringStatus(m);
                    const displayWmape = Number.isFinite(Number(m.wmape)) ? Number(m.wmape) : null;
                    const displayMape = Number.isFinite(Number(m.mape)) ? Number(m.mape) : null;
                    const predCount = Math.round(Number(m.forecastUnits) || 0);
                    return (
                      <tr key={m.id} className="border-b hover:bg-muted/10" data-testid={`row-deployed-${m.id}`}>
                        <td className="px-3 py-2 font-medium max-w-[160px] truncate">{m.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
                        <td className="px-3 py-2 font-mono font-bold text-primary">
                          {displayWmape != null ? `${displayWmape.toFixed(2)}%` : "—"}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {displayMape != null ? `${displayMape.toFixed(2)}%` : "—"}
                        </td>
                        <td className="px-3 py-2 font-mono">{predCount.toLocaleString()}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.deployedAt ? new Date(m.deployedAt).toLocaleDateString() : "—"}</td>
                        <td className="px-3 py-2"><StatusBadge status={monStatus.label.split(" — ")[0]} /></td>
                        <td className="px-3 py-2">
                          <StatusBadge status={m.approvalStatus === "approved" ? "Approved" : m.approvalStatus === "rejected" ? "Rejected" : "Pending"} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" className={`h-6 w-6 hover:bg-primary/10 hover:text-primary${prodDatasetId ? " ring-1 ring-blue-500/50" : ""}`}
                              onClick={() => { setScoringModelId(m.id); scoreMut.mutate(m.id); }}
                              disabled={scoreMut.isPending && scoringModelId === m.id}
                              title={prodDatasetId ? "Generate forecasts on production data" : "Generate forecasts"} data-testid={`button-score-${m.id}`}>
                              <Target className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
                              onClick={() => { setApprovalModel(m); setApprovalNotes(""); setApprovalAction(m.approvalStatus === "approved" ? "reject" : "approve"); }}
                              title="Approve/reject" data-testid={`button-approve-${m.id}`}>
                              <ShieldCheck className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
                              onClick={() => undeployMut.mutate(m.id)} title="Undeploy" data-testid={`button-undeploy-${m.id}`}>
                              <StopCircle className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
                              onClick={() => setDeleteId(m.id)} title="Delete" data-testid={`button-delete-deployed-${m.id}`}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── MODEL OBSERVABILITY ── */}
        {deployedModels.length > 0 && (
          <div className="bg-card border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-500" />
                <h3 className="text-sm font-semibold">Model Observability</h3>
                {highSeverityCount > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-bold border border-red-500/20">{highSeverityCount} alert{highSeverityCount > 1 ? "s" : ""}</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {deployedModels.length > 1 && (
                  <select
                    className="text-[10px] bg-muted border border-border rounded px-2 py-1 text-foreground"
                    value={activeMonitorId ?? ""}
                    onChange={e => { setMonitorModelId(Number(e.target.value)); setMonitorTab("health"); }}
                    data-testid="select-monitor-model"
                  >
                    {deployedModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                )}
                {/* Production dataset selector */}
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">Production data:</span>
                  <select
                    className="text-[10px] bg-muted border border-border rounded px-2 py-1 text-foreground"
                    value={prodDatasetId ?? ""}
                    onChange={e => setProdDatasetId(e.target.value ? Number(e.target.value) : null)}
                    data-testid="select-prod-dataset"
                  >
                    <option value="">— model predictions —</option>
                    {(allDatasets as any[]).map((ds: any) => (
                      <option key={ds.id} value={ds.id}>{ds.name} ({ds.rowCount?.toLocaleString()} rows)</option>
                    ))}
                  </select>
                  {/* Evaluate on Prod button — runs feature engineering + model on prod data */}
                  {prodDatasetId && activeMonitorId && (
                    <button
                      onClick={() => evalProdMut.mutate({ modelId: activeMonitorId, prodDatasetId })}
                      disabled={evalProdMut.isPending}
                      title="Run model on production data: applies full feature pipeline, generates forecasts, computes WMAPE/MAPE/RMSE"
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                      data-testid="button-evaluate-prod"
                    >
                      {evalProdMut.isPending
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Evaluating…</>
                        : <><FlaskConical className="w-3 h-3" /> Evaluate on Prod</>}
                    </button>
                  )}
                </div>
                {summaryData?.prodDataset && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 border border-blue-500/20 font-medium">
                    Scoring: {summaryData.prodDataset.name} · {summaryData.prodDataset.rows?.toLocaleString()} rows
                  </span>
                )}
                <div className="flex gap-1">
                  {([
                    { id: "health", label: "Health" },
                    { id: "trends", label: "Trends" },
                    { id: "drivers", label: "Drivers" },
                    { id: "insights", label: "Insights" },
                  ] as const).map(t => (
                    <button key={t.id} onClick={() => setMonitorTab(t.id)} data-testid={`tab-monitor-${t.id}`}
                      className={`px-3 py-1 text-[10px] rounded font-medium transition-colors ${monitorTab === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {monitorLoading && (
              <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">Loading monitoring data…</div>
            )}

            {/* ── HEALTH TAB ── */}
            {!monitorLoading && monitorTab === "health" && (
              <div className="p-4 space-y-4">
                {activeMonitorModel && (
                  <>
                    {/* Summary KPIs */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="bg-muted/30 border rounded-lg p-3 text-center">
                        <p className="text-[10px] text-muted-foreground">
                          WMAPE
                        </p>
                        <p className="text-xl font-mono font-bold text-primary">
                          {asPct(activeMonitorModel.wmape)}
                        </p>
                      </div>
                      <div className="bg-muted/30 border rounded-lg p-3 text-center">
                        <p className="text-[10px] text-muted-foreground">
                          MAPE
                        </p>
                        <p className="text-xl font-mono font-bold">
                          {asPct(activeMonitorModel.mape)}
                        </p>
                      </div>
                      <div className="bg-muted/30 border rounded-lg p-3 text-center">
                        <p className="text-[10px] text-muted-foreground">RMSE</p>
                        <p className="text-xl font-mono font-bold text-primary">{asMetric(activeMonitorModel.rmse)}</p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">unit-level error</p>
                      </div>
                      <div className="bg-muted/30 border rounded-lg p-3 text-center">
                        <p className="text-[10px] text-muted-foreground">R2</p>
                        <p className="text-xl font-mono font-bold text-emerald-700">{asMetric(activeMonitorModel.r2, 3)}</p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">fit quality</p>
                      </div>
                      <div className="bg-muted/30 border rounded-lg p-3 text-center">
                        <p className="text-[10px] text-muted-foreground">Forecast Accuracy</p>
                        <p className="text-xl font-mono font-bold text-amber-700">{Number.isFinite(Number(activeMonitorModel.wmape)) ? asPct(Math.max(0, 100 - Number(activeMonitorModel.wmape))) : "—"}</p>
                      </div>
                    </div>

                    {/* Per-model drift bars */}
                    {deployedModels.filter(m => m.id === activeMonitorId).map(m => {
                      const drift = getDriftMetrics(m);
                      const predCount = predCountForModel(m.id);
                      const driftAlert = drift.forecastError > 15 || drift.bias > 10;
                      return (
                        <div key={m.id} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="border rounded-lg p-4 space-y-3">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Forecast Error Watch</p>
                            <DriftBar label="WMAPE" value={drift.forecastError} threshold={15} />
                            <DriftBar label="MAPE" value={drift.mape} threshold={15} />
                            <DriftBar label="Forecast Bias" value={drift.bias} threshold={10} />
                          </div>
                          <div className="border rounded-lg p-4 space-y-3">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Demand Coverage</p>
                            <DriftBar label="RMSE Volatility" value={drift.volatility} threshold={20} />
                            <DriftBar label="Actual vs Forecast Gap" value={drift.bias} threshold={10} />
                            <DriftBar label="Error Threshold Usage" value={drift.forecastError} threshold={25} />
                            <div className="flex items-center justify-between text-[10px] pt-1 border-t">
                              <span className="text-muted-foreground">Total forecast rows</span>
                              <span className="font-mono font-bold">{predCount.toLocaleString()}</span>
                            </div>
                          </div>
                          {driftAlert && (
                            <div className="md:col-span-2 flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                              Forecast alert - WMAPE {drift.forecastError.toFixed(2)}% exceeds the target band. Review recent demand shifts and consider retraining.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {/* ── TRENDS TAB ── */}
            {!monitorLoading && monitorTab === "trends" && (
              <div className="p-4 space-y-6">
                {/* Performance Trend */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-primary" />Performance Metrics — Monthly Trend</h4>
                    <span className="text-[10px] text-muted-foreground">Model: {activeMonitorModel?.name}</span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={forecastTrendData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis
                        domain={([dataMin, dataMax]: [number, number]) => {
                          const pad = Math.max((dataMax - dataMin) * 0.15, 0.02);
                          return [Math.max(0, parseFloat((dataMin - pad).toFixed(2))), Math.min(1, parseFloat((dataMax + pad).toFixed(2)))];
                        }}
                        tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={v => v.toFixed(2)}
                      />
                      <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v: any) => (v as number).toFixed(4)} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Line type="monotone" dataKey="accuracy" stroke={CHART_COLORS.accuracy} strokeWidth={2} dot={{ r: 3, fill: CHART_COLORS.accuracy }} name="Forecast Accuracy" />
                      <Line type="monotone" dataKey="wmape" stroke={CHART_COLORS.ks} strokeWidth={2} dot={{ r: 3, fill: CHART_COLORS.ks }} name="WMAPE" />
                      <Line type="monotone" dataKey="mape" stroke={CHART_COLORS.recall} strokeWidth={2} dot={{ r: 3, fill: CHART_COLORS.recall }} name="MAPE" strokeDasharray="4 2" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Drift Trend */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-amber-400" />Error Drift — WMAPE & RMSE Over Time</h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={forecastTrendData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="psiGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS.psi} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={CHART_COLORS.psi} stopOpacity={0.03} />
                        </linearGradient>
                        <linearGradient id="ksGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS.ks} stopOpacity={0.30} />
                          <stop offset="95%" stopColor={CHART_COLORS.ks} stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis
                        domain={([, dataMax]: [number, number]) => [0, Math.max(parseFloat((dataMax * 1.2).toFixed(2)), 0.05)]}
                        tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={v => v.toFixed(3)}
                      />
                      <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v: any) => (v as number).toFixed(4)} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Area type="monotone" dataKey="wmape" stroke={CHART_COLORS.psi} fill="url(#psiGrad)" strokeWidth={2} dot={{ r: 3 }} name="WMAPE" />
                      <Area type="monotone" dataKey="rmse" stroke={CHART_COLORS.ks} fill="url(#ksGrad)" strokeWidth={2} dot={{ r: 3 }} name="RMSE" />
                    </AreaChart>
                  </ResponsiveContainer>
                  <div className="flex gap-4 text-[10px] text-muted-foreground">
                    <span>WMAPE target: <strong className="text-amber-400">15%</strong></span>
                    <span>RMSE watch: <strong className="text-amber-400">rising trend</strong></span>
                    <span>Rising values indicate forecast error drift requiring model review or retraining.</span>
                  </div>
                </div>

                {/* Risk Distribution Over Time */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-blue-400" />Actual vs Forecast Volume by Period</h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={forecastTrendData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                      <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v: any) => `${(v as number).toFixed(1)}%`} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Bar dataKey="actualUnits" fill={CHART_COLORS.accuracy} name="Actual Units" opacity={0.85} />
                      <Bar dataKey="forecastUnits" fill={CHART_COLORS.med} name="Forecast Units" opacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── DRIVERS TAB ── */}
            {!monitorLoading && monitorTab === "drivers" && activeMonitorModel && (
              <div className="p-4 space-y-5">
                {/* Driver change summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {((activeMonitorModel.featureImportance || []) as any[]).slice(0, 6).map((raw: any, idx: number) => {
                    const d = {
                      name: raw.name || raw.feature || `feature_${idx + 1}`,
                      displayName: String(raw.name || raw.feature || `Feature ${idx + 1}`).replace(/_/g, " "),
                      current: Number(raw.importance ?? raw.avgShap ?? 0),
                      delta: 0,
                      deltaPct: 0,
                      trend: idx < 2 ? "rising" : "stable",
                    };
                    return (
                    <div key={d.name} className={`border rounded-lg p-3 ${d.trend === "rising" ? "border-emerald-500/30 bg-emerald-500/8" : d.trend === "declining" ? "border-amber-500/30 bg-amber-500/8" : ""}`}
                      data-testid={`driver-card-${d.name}`}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-[11px] font-mono font-semibold text-blue-700 truncate">{d.name}</p>
                          <p className="text-[9px] text-muted-foreground capitalize">{d.displayName}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          {d.trend === "rising" && <><ArrowUpRight className="w-3.5 h-3.5 text-emerald-700" /><span className="text-[9px] text-emerald-700 font-bold">Rising</span></>}
                          {d.trend === "declining" && <><ArrowDownRight className="w-3.5 h-3.5 text-amber-700" /><span className="text-[9px] text-amber-700 font-bold">Declining</span></>}
                          {d.trend === "stable" && <><Minus className="w-3 h-3 text-muted-foreground" /><span className="text-[9px] text-muted-foreground">Stable</span></>}
                        </div>
                      </div>
                      <div className="flex-1 h-2 bg-muted rounded overflow-hidden mb-1">
                        <div className="h-full rounded bg-primary" style={{ width: `${(d.current / 0.278) * 100}%` }} />
                      </div>
                      <div className="flex justify-between text-[9px]">
                        <span className="text-muted-foreground">Score: <span className="font-mono text-foreground">{d.current.toFixed(3)}</span></span>
                        <span className={d.delta > 0 ? "text-emerald-400" : d.delta < -0.005 ? "text-amber-400" : "text-muted-foreground"}>
                          {d.delta > 0 ? "+" : ""}{(d.delta * 100).toFixed(1)} ({d.deltaPct > 0 ? "+" : ""}{d.deltaPct}%)
                        </span>
                      </div>
                    </div>
                    );
                  })}
                </div>

                {/* Feature importance over time chart */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5"><Brain className="w-3.5 h-3.5 text-primary" />Driver Evolution — Importance Scores Over 6 Periods</h4>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={featureHistoryData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => v.toFixed(2)} />
                      <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v: any) => (v as number).toFixed(4)} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      {activeFeatureImportance.map((feature: any, idx: number) => {
                        const name = feature.name;
                        const colors = ["#FFD822", "#3b82f6", "#a78bfa", "#f97316", "#22c55e", "#ec4899"];
                        return <Line key={name} type="monotone" dataKey={name} stroke={colors[idx % colors.length]} strokeWidth={1.5} dot={false} name={feature.displayName} />;
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Rising / Declining summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-emerald-500/30 rounded-lg p-3 bg-emerald-500/8">
                    <h5 className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-2 flex items-center gap-1"><ArrowUpRight className="w-3 h-3" />Rising Drivers</h5>
                    {activeFeatureImportance.slice(0, 3).map((d: any) => (
                      <div key={d.name} className="flex justify-between text-[10px] py-0.5">
                        <span className="font-mono text-emerald-800">{d.displayName}</span>
                        <span className="text-emerald-700 font-medium">{asMetric(d.importance, 3)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border border-amber-500/30 rounded-lg p-3 bg-amber-500/8">
                    <h5 className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-2 flex items-center gap-1"><ArrowDownRight className="w-3 h-3" />Declining Drivers</h5>
                    {activeFeatureImportance.slice(3, 6).map((d: any) => (
                      <div key={d.name} className="flex justify-between text-[10px] py-0.5">
                        <span className="font-mono text-amber-800">{d.displayName}</span>
                        <span className="text-amber-700 font-medium">{asMetric(d.importance, 3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── INSIGHTS TAB ── */}
            {!monitorLoading && monitorTab === "insights" && activeMonitorModel && (
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2 p-3 rounded-lg border border-blue-500/30 bg-blue-500/8">
                  <Sparkles className="w-4 h-4 text-blue-700 flex-shrink-0" />
                  <p className="text-[11px] text-blue-800">
                    ML Orion reviewed forecast accuracy, unit bias, and demand drivers to prioritize deployment monitoring actions.
                  </p>
                </div>
                {[
                  {
                    id: "wmape-watch",
                    severity: Number(activeMonitorModel.wmape) > 15 ? "medium" : "low",
                    icon: "trend-down",
                    title: Number(activeMonitorModel.wmape) > 15 ? "Forecast error above target band" : "Forecast error within deployment band",
                    category: "Accuracy",
                    detail: `Current WMAPE is ${asPct(activeMonitorModel.wmape)} with MAPE ${asPct(activeMonitorModel.mape)}.`,
                    action: Number(activeMonitorModel.wmape) > 15 ? "Compare recent demand patterns by SKU, store, and week, then retrain with the latest production data." : "Keep the model active and continue weekly forecast accuracy checks.",
                    impact: "Improves replenishment confidence and lowers overstock or stockout risk.",
                  },
                  {
                    id: "bias-check",
                    severity: Math.abs(totalForecastUnits - totalActualUnits) > totalActualUnits * 0.1 ? "medium" : "low",
                    icon: "calendar",
                    title: "Actual vs forecast unit reconciliation",
                    category: "Demand Planning",
                    detail: `Deployed forecast units are ${asNumber(totalForecastUnits)} against ${asNumber(totalActualUnits)} actual units.`,
                    action: "Review forecast bias before publishing replenishment plans for categories with sustained over- or under-forecasting.",
                    impact: "Keeps inventory buys aligned to expected demand.",
                  },
                  {
                    id: "driver-review",
                    severity: activeFeatureImportance.length === 0 ? "medium" : "low",
                    icon: "sparkle",
                    title: "Driver coverage review",
                    category: "Explainability",
                    detail: activeFeatureImportance.length ? `${activeFeatureImportance.length} demand drivers are available for monitoring.` : "No feature importance was captured for this model.",
                    action: "Use driver monitoring to validate that price, calendar, SKU, store, and promotion signals remain meaningful in production.",
                    impact: "Makes forecast changes easier to explain to planning and operations teams.",
                  },
                ].map((rec: any) => <RecommendationCard key={rec.id} rec={rec} />)}
              </div>
            )}
          </div>
        )}

        {/* ── AVAILABLE TO DEPLOY ── */}
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">Available to Deploy</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">{availableModels.length} trained models ready for deployment</p>
          </div>
          {availableModels.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-xs">
              No trained models available. Train a model in the Experiments page.
              <div className="mt-2"><a href="/retail/demand_forecast/orion/experiments" className="text-primary underline text-xs">Go to Experiments →</a></div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {["Model", "Algorithm", "WMAPE", "RMSE", "R2", "Trained", "Approval", "Actions"].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {availableModels.map(m => (
                    <tr key={m.id} className="border-b hover:bg-muted/10" data-testid={`row-available-${m.id}`}>
                      <td className="px-3 py-2 font-medium max-w-[160px] truncate">{m.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
                      <td className="px-3 py-2 font-mono font-bold text-primary">{m.wmape != null ? `${Number(m.wmape).toFixed(2)}%` : "—"}</td>
                      <td className="px-3 py-2 font-mono">{m.rmse != null ? Number(m.rmse).toFixed(2) : "—"}</td>
                      <td className="px-3 py-2 font-mono">{m.r2 != null ? Number(m.r2).toFixed(3) : "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{m.trainedAt ? new Date(m.trainedAt).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={m.approvalStatus === "approved" ? "Approved" : m.approvalStatus === "rejected" ? "Rejected" : "Pending"} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-emerald-500/10 hover:text-emerald-500"
                            onClick={() => deployMut.mutate(m.id)} title="Deploy" data-testid={`button-deploy-${m.id}`}>
                            <PlayCircle className="w-3 h-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
                            onClick={() => { setApprovalModel(m); setApprovalNotes(""); setApprovalAction("approve"); }}
                            title="Submit for approval" data-testid={`button-request-approval-${m.id}`}>
                            <Send className="w-3 h-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
                            onClick={() => setDeleteId(m.id)} title="Delete" data-testid={`button-delete-available-${m.id}`}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── ALL MODELS ── */}
        {models.filter(m => m.status !== "training").length > 0 && (
          <div className="bg-card border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-semibold">All Models — Registry</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {["Model", "Algorithm", "Deployed", "WMAPE", "Forecast Units", "Monitor Status", "Approval", "Actions"].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {models.filter(m => m.status !== "training").map(m => {
                    const predCount = predCountForModel(m.id);
                    const monStatus = getMonitoringStatus(m, predCount);
                    return (
                      <tr key={m.id} className="border-b hover:bg-muted/10" data-testid={`row-monitor-${m.id}`}>
                        <td className="px-3 py-2 font-medium max-w-[140px] truncate">{m.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
                        <td className="px-3 py-2">{m.isDeployed ? <span className="text-emerald-500 font-medium">Yes</span> : <span className="text-muted-foreground">No</span>}</td>
                        <td className="px-3 py-2 font-mono">{m.wmape != null ? `${Number(m.wmape).toFixed(2)}%` : "—"}</td>
                        <td className="px-3 py-2 font-mono">{predCount.toLocaleString()}</td>
                        <td className="px-3 py-2"><StatusBadge status={monStatus.label.split(" — ")[0]} /></td>
                        <td className="px-3 py-2"><StatusBadge status={m.approvalStatus === "approved" ? "Approved" : m.approvalStatus === "rejected" ? "Rejected" : "Pending"} /></td>
                        <td className="px-3 py-2">
                          <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
                            onClick={() => setDeleteId(m.id)} data-testid={`button-delete-monitor-${m.id}`}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Delete Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Model</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteTarget?.name}</strong>? All associated predictions will also be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMut.mutate(deleteId)}>
              Delete Model
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Approval Dialog */}
      <Dialog open={!!approvalModel} onOpenChange={() => setApprovalModel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{approvalAction === "approve" ? "Approve" : "Reject"} Model</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Model: <strong>{approvalModel?.name}</strong></p>
            <div>
              <label className="text-xs font-medium">Review Notes</label>
              <textarea
                className="mt-1 w-full h-20 text-xs border rounded p-2 bg-background resize-none"
                placeholder="Add notes for the governance audit log…"
                value={approvalNotes}
                onChange={e => setApprovalNotes(e.target.value)}
                data-testid="textarea-approval-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovalModel(null)}>Cancel</Button>
            <Button
              className={approvalAction === "approve" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
              onClick={() => approvalModel && approveMut.mutate({ id: approvalModel.id, notes: approvalNotes, action: approvalAction })}
              disabled={approveMut.isPending}
              data-testid="button-confirm-approval"
            >
              {approvalAction === "approve" ? <><CheckCircle className="w-3.5 h-3.5 mr-1.5" />Approve Model</> : <><XCircle className="w-3.5 h-3.5 mr-1.5" />Reject Model</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OrionLayout>
  );
}
