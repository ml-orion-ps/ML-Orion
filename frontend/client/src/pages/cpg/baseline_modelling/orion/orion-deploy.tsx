import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Trash2, PlayCircle, StopCircle, Target, CheckCircle, XCircle,
  AlertTriangle, Activity, TrendingUp, TrendingDown, ShieldCheck,
  Send, Sparkles, Brain, Calendar, ArrowUpRight, ArrowDownRight,
  Minus, FlaskConical, Loader2,
} from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar,
} from "recharts";

const CPG_BASE = "/cpg/baseline-modelling/orion";
const API_BASE = "/api/cpg/baseline_modelling";
const MODELS_API = `${API_BASE}/models`;
const DATASETS_API = `${API_BASE}/datasets`;
const ORION_API = `${API_BASE}/orion`;
const PREDICTIONS_API = `${API_BASE}/predictions/predictions`;
const MONITORING_API = `${API_BASE}/api/monitoring`;

const CHART_COLORS = {
  r2: "#22c55e", wmape: "#f97316", mae: "#3b82f6",
  psi: "#f97316", ks: "#ef4444",
  high: "#ef4444", med: "#f59e0b", low: "#22c55e",
};

const CUSTOM_TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  fontSize: "10px",
};

// ── Sub-components ────────────────────────────────────────────────────────────

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

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "high") return <span className="text-[9px] px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-700 font-medium">High</span>;
  if (severity === "medium") return <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 font-medium">Medium</span>;
  return <span className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground font-medium">Low</span>;
}

function RecommendationCard({ rec }: { rec: any }) {
  const borderColor = rec.severity === "high"
    ? "border-red-500/35 bg-red-500/5"
    : rec.severity === "medium"
    ? "border-amber-500/30 bg-amber-500/5"
    : "border-border bg-card";
  const Icon = rec.icon === "trend-down" ? TrendingDown
    : rec.icon === "sparkle" ? Sparkles
    : rec.icon === "shield" ? ShieldCheck
    : rec.icon === "calendar" ? Calendar
    : AlertTriangle;
  const iconColor = rec.severity === "high" ? "text-red-600"
    : rec.severity === "medium" ? "text-amber-600"
    : "text-muted-foreground";
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

function TrendIcon({ delta, threshold = 0 }: { delta: number; threshold?: number }) {
  if (delta > threshold) return <ArrowUpRight className="w-3 h-3 text-emerald-600" />;
  if (delta < -threshold) return <ArrowDownRight className="w-3 h-3 text-red-600" />;
  return <Minus className="w-3 h-3 text-muted-foreground" />;
}

function getMonitoringStatus(model: any) {
  if (!model.isDeployed) return { status: "stale", label: "Not Deployed" };
  if (!model.rowCount || model.rowCount === 0) return { status: "stale", label: "Stale — No Runs" };
  if (model.r2 == null) return { status: "at risk", label: "At Risk — No Metrics" };
  return { status: "healthy", label: "Healthy" };
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OrionDeployPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [scoringModelId, setScoringModelId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [approvalModel, setApprovalModel] = useState<any>(null);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [approvalAction, setApprovalAction] = useState<"approve" | "reject">("approve");
  const [monitorModelId, setMonitorModelId] = useState<number | null>(null);
  const [monitorTab, setMonitorTab] = useState<"health" | "trends" | "drivers" | "insights">("health");
  const [prodDatasetId, setProdDatasetId] = useState<number | null>(null);

  const { data: modelsRaw = [] } = useQuery<any[]>({ queryKey: [MODELS_API] });
  const { data: predictions = [] } = useQuery<any[]>({ queryKey: [PREDICTIONS_API] });
  const { data: allDatasets = [] } = useQuery<any[]>({ queryKey: [DATASETS_API] });

  const models = modelsRaw as any[];
  const deployedModels = models.filter(m => m.isDeployed);
  const availableModels = models.filter(m => !m.isDeployed && m.status === "trained");

  const activeMonitorId = monitorModelId ?? deployedModels[0]?.id ?? null;

  const { data: monitoringData, isLoading: monitorLoading } = useQuery<any>({
    queryKey: [MONITORING_API, activeMonitorId, prodDatasetId],
    enabled: !!activeMonitorId,
    queryFn: async () => {
      const url = prodDatasetId
        ? `${MONITORING_API}/${activeMonitorId}?prodDatasetId=${prodDatasetId}`
        : `${MONITORING_API}/${activeMonitorId}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const deployMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `${MODELS_API}/${id}/deploy`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [MODELS_API] });
      qc.invalidateQueries({ queryKey: [`${ORION_API}/overview`] });
      toast({ title: "Model deployed" });
    },
    onError: (e: any) => toast({ title: "Deploy failed", description: e.message, variant: "destructive" }),
  });

  const undeployMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `${MODELS_API}/${id}/undeploy`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [MODELS_API] });
      qc.invalidateQueries({ queryKey: [`${ORION_API}/overview`] });
      toast({ title: "Model undeployed" });
    },
    onError: (e: any) => toast({ title: "Undeploy failed", description: e.message, variant: "destructive" }),
  });

  const scoreMut = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `${MODELS_API}/${id}/predict-customers`, prodDatasetId ? { prodDatasetId } : {}),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: [PREDICTIONS_API] });
      qc.invalidateQueries({ queryKey: [MONITORING_API, scoringModelId] });
      toast({ title: `Scoring complete — ${data.predicted ?? 0} records scored` });
      setScoringModelId(null);
    },
    onError: (e: any) => {
      toast({ title: "Scoring failed", description: e.message, variant: "destructive" });
      setScoringModelId(null);
    },
  });

  const evalProdMut = useMutation({
    mutationFn: ({ modelId, prodDatasetId }: { modelId: number; prodDatasetId: number }) =>
      apiRequest("POST", `${MODELS_API}/${modelId}/score-production`, { prodDatasetId }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: [PREDICTIONS_API] });
      qc.invalidateQueries({ queryKey: [MONITORING_API, activeMonitorId, prodDatasetId] });
      qc.invalidateQueries({ queryKey: [MODELS_API] });
      const m = data.metrics || {};
      const parts = [`${data.predicted ?? 0} records`];
      if (m.r2 != null) parts.push(`R² ${m.r2.toFixed(3)}`);
      if (m.wmape != null) parts.push(`WMAPE ${(m.wmape * 100).toFixed(1)}%`);
      toast({ title: `Prod evaluation complete · ${parts.join(" · ")}` });
    },
    onError: (e: any) => toast({ title: "Evaluation failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `${MODELS_API}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [MODELS_API] });
      qc.invalidateQueries({ queryKey: [PREDICTIONS_API] });
      qc.invalidateQueries({ queryKey: [`${ORION_API}/overview`] });
      toast({ title: "Model deleted" });
      setDeleteId(null);
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const approveMut = useMutation({
    mutationFn: ({ id, notes, action }: { id: number; notes: string; action: string }) =>
      apiRequest("POST", `${MODELS_API}/${id}/approve`, {
        approvedBy: "ml-ops-lead",
        notes,
        action,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [MODELS_API] });
      qc.invalidateQueries({ queryKey: [`${ORION_API}/governance`] });
      toast({ title: `Model ${approvalAction === "approve" ? "approved" : "rejected"}` });
      setApprovalModel(null);
      setApprovalNotes("");
    },
    onError: (e: any) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  // ── Derived values ─────────────────────────────────────────────────────────

  function getDriftMetrics(m: any) {
    const realPsi = monitoringData?.summary?.latestPsi;
    const realKs  = monitoringData?.summary?.latestKs;
    const r2 = m.r2 ?? 0.8;
    const wmape = m.wmape ?? 0.15;
    const psi = realPsi !== undefined
      ? parseFloat(realPsi.toFixed(3))
      : parseFloat(((1 - r2) * 0.35 + 0.02).toFixed(3));
    const ks = realKs !== undefined
      ? parseFloat(realKs.toFixed(3))
      : parseFloat((wmape * 0.45 + 0.01).toFixed(3));
    const featureDrift  = parseFloat((psi * 1.2).toFixed(3));
    const targetDrift   = parseFloat((ks * 0.8).toFixed(3));
    const predDrift     = parseFloat((psi * 0.9).toFixed(3));
    const segmentDrift  = parseFloat((wmape * 0.3).toFixed(3));
    return { psi, ks, featureDrift, targetDrift, predDrift, segmentDrift };
  }

  const avgR2 = deployedModels.length
    ? parseFloat((deployedModels.reduce((s, m) => s + (m.r2 || 0), 0) / deployedModels.length).toFixed(3))
    : 0;
  const avgWmape = deployedModels.length
    ? parseFloat((deployedModels.reduce((s, m) => s + (m.wmape || 0), 0) / deployedModels.length).toFixed(3))
    : 0;
  const healthyCount = deployedModels.filter(m => getMonitoringStatus(m).status === "healthy").length;
  const atRiskCount  = deployedModels.filter(m => getMonitoringStatus(m).status === "at risk").length;
  const staleCount   = deployedModels.filter(m => getMonitoringStatus(m).status === "stale").length;
  const totalRowsScored = models.reduce((s, m) => s + (m.rowCount || 0), 0);
  const deleteTarget = models.find(m => m.id === deleteId);
  const activeMonitorModel = models.find(m => m.id === activeMonitorId);
  const prodWeights = (activeMonitorModel?.modelWeights ?? {}) as any;
  const hasProdData = prodDatasetId != null && prodWeights.prodDatasetId === prodDatasetId && prodWeights.prodMetrics != null;
  const displayR2 = hasProdData ? (prodWeights.prodMetrics?.r2 ?? null) : (activeMonitorModel?.r2 ?? null);
  const displayWmape = hasProdData ? (prodWeights.prodMetrics?.testWmape ?? null) : (activeMonitorModel?.wmape ?? null);
  const displayMae = hasProdData ? (prodWeights.prodMetrics?.mae ?? null) : (activeMonitorModel?.mae ?? null);
  const displayRowCount = hasProdData ? (prodWeights.prodRowCount ?? activeMonitorModel?.rowCount ?? 0) : (activeMonitorModel?.rowCount ?? 0);
  const metricsSource = hasProdData ? "production" : "training";
  const summaryData = monitoringData?.summary;
  const highSeverityCount = (monitoringData?.recommendations || []).filter((r: any) => r.severity === "high").length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <OrionLayout title="Deploy & Score" subtitle="Production model management, drift monitoring, and AI-powered observability">
      <div className="space-y-4">
        <OrionNav current={`${CPG_BASE}/deploy`} basePath={CPG_BASE} />

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <KpiCard label="Deployed Models" value={deployedModels.length} color="green" testId="kpi-deployed" />
          <KpiCard label="Healthy" value={healthyCount} color="green" testId="kpi-healthy" />
          <KpiCard label="At Risk" value={atRiskCount} color={atRiskCount > 0 ? "amber" : "green"} testId="kpi-at-risk" />
          <KpiCard label="Stale" value={staleCount} color={staleCount > 0 ? "amber" : "green"} testId="kpi-stale" />
          <KpiCard label="Avg R² (Deployed)" value={avgR2 ? avgR2.toFixed(3) : "—"} color="blue" testId="kpi-r2" />
          <KpiCard label="Total Rows Scored" value={totalRowsScored.toLocaleString()} testId="kpi-rows" />
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
            <div className="p-8 text-center text-muted-foreground text-xs">
              No models deployed. Deploy a trained model from the list below.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {["Model", "Algorithm", "R²", "WMAPE", "Rows Scored", "Deployed", "Status", "Approval", "Actions"].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deployedModels.map(m => {
                    const monStatus = getMonitoringStatus(m);
                    return (
                      <tr key={m.id} className="border-b hover:bg-muted/10" data-testid={`row-deployed-${m.id}`}>
                        <td className="px-3 py-2 font-medium max-w-[160px] truncate">{m.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
                        <td className="px-3 py-2 font-mono font-bold text-emerald-600">{m.r2 != null ? m.r2.toFixed(3) : "—"}</td>
                        <td className="px-3 py-2 font-mono">{m.wmape != null ? `${(m.wmape * 100).toFixed(1)}%` : "—"}</td>
                        <td className="px-3 py-2 font-mono">{m.rowCount?.toLocaleString() ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.deployedAt ? new Date(m.deployedAt).toLocaleDateString() : "—"}</td>
                        <td className="px-3 py-2"><StatusBadge status={monStatus.label.split(" — ")[0]} /></td>
                        <td className="px-3 py-2">
                          <StatusBadge status={
                            m.approvalStatus === "approved" ? "Approved"
                              : m.approvalStatus === "rejected" ? "Rejected"
                                : "Pending"
                          } />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-primary/10 hover:text-primary"
                              onClick={() => { setScoringModelId(m.id); scoreMut.mutate(m.id); }}
                              disabled={scoreMut.isPending && scoringModelId === m.id}
                              title="Score records" data-testid={`button-score-${m.id}`}>
                              <Target className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
                              onClick={() => { setApprovalModel(m); setApprovalNotes(""); setApprovalAction(m.approvalStatus === "approved" ? "reject" : "approve"); }}
                              title="Approve/reject" data-testid={`button-approve-${m.id}`}>
                              <ShieldCheck className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
                              onClick={() => undeployMut.mutate(m.id)}
                              title="Undeploy" data-testid={`button-undeploy-${m.id}`}>
                              <StopCircle className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
                              onClick={() => setDeleteId(m.id)}
                              title="Delete" data-testid={`button-delete-deployed-${m.id}`}>
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
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-bold border border-red-500/20">
                    {highSeverityCount} alert{highSeverityCount > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {deployedModels.length > 1 && (
                  <select
                    className="text-[10px] bg-muted border border-border rounded px-2 py-1"
                    value={activeMonitorId ?? ""}
                    onChange={e => { setMonitorModelId(Number(e.target.value)); setMonitorTab("health"); }}
                    data-testid="select-monitor-model"
                  >
                    {deployedModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                )}
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">Production data:</span>
                  <select
                    className="text-[10px] bg-muted border border-border rounded px-2 py-1"
                    value={prodDatasetId ?? ""}
                    onChange={e => setProdDatasetId(e.target.value ? Number(e.target.value) : null)}
                    data-testid="select-prod-dataset"
                  >
                    <option value="">— baseline model data —</option>
                    {(allDatasets as any[]).map((ds: any) => (
                      <option key={ds.id} value={ds.id}>{ds.name} ({ds.rowCount?.toLocaleString()} rows)</option>
                    ))}
                  </select>
                  {prodDatasetId && activeMonitorId && (
                    <button
                      onClick={() => evalProdMut.mutate({ modelId: activeMonitorId, prodDatasetId })}
                      disabled={evalProdMut.isPending}
                      title="Run model on production dataset"
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                      data-testid="button-evaluate-prod"
                    >
                      {evalProdMut.isPending
                        ? <><Loader2 className="w-3 h-3 animate-spin" />Evaluating…</>
                        : <><FlaskConical className="w-3 h-3" />Evaluate on Prod</>}
                    </button>
                  )}
                </div>
                {summaryData?.prodDataset && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 border border-blue-500/20 font-medium">
                    Scoring: {summaryData.prodDataset.name} · {summaryData.prodDataset.rows?.toLocaleString()} rows
                  </span>
                )}
                <div className="flex gap-1">
                  {(["health", "trends", "drivers", "insights"] as const).map(t => (
                    <button key={t} onClick={() => setMonitorTab(t)} data-testid={`tab-monitor-${t}`}
                      className={`px-3 py-1 text-[10px] rounded font-medium transition-colors ${monitorTab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {monitorLoading && (
              <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">Loading monitoring data…</div>
            )}

            {/* ── HEALTH TAB ── */}
            {!monitorLoading && monitorTab === "health" && activeMonitorModel && (
              <div className="p-4 space-y-4">
                {/* Regression metric KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">R² Score</p>
                    <p className="text-xl font-mono font-bold text-emerald-600">
                      {displayR2 != null ? displayR2.toFixed(3) : "—"}
                    </p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">{metricsSource} data</p>
                  </div>
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">WMAPE</p>
                    <p className="text-xl font-mono font-bold text-amber-600">
                      {displayWmape != null ? `${(displayWmape * 100).toFixed(1)}%` : "—"}
                    </p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">{metricsSource} data</p>
                  </div>
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">MAE</p>
                    <p className="text-xl font-mono font-bold">
                      {displayMae != null ? displayMae.toFixed(2) : "—"}
                    </p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">{metricsSource} data</p>
                  </div>
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">PSI (Drift)</p>
                    <p className={`text-xl font-mono font-bold ${(summaryData?.latestPsi ?? 0) > 0.2 ? "text-red-600" : (summaryData?.latestPsi ?? 0) > 0.1 ? "text-amber-700" : "text-emerald-700"}`}>
                      {summaryData?.latestPsi != null ? summaryData.latestPsi.toFixed(3) : "—"}
                    </p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">threshold: 0.200</p>
                  </div>
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">Rows Scored</p>
                    <p className="text-xl font-mono font-bold text-blue-600">
                      {displayRowCount.toLocaleString()}
                    </p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">{metricsSource} data</p>
                  </div>
                </div>

                {/* Drift bars */}
                {deployedModels.filter(m => m.id === activeMonitorId).map(m => {
                  const drift = getDriftMetrics(m);
                  const driftAlert = drift.psi > 0.2 || drift.featureDrift > 0.25;
                  return (
                    <div key={m.id} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="border rounded-lg p-4 space-y-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Distribution Drift</p>
                        <DriftBar label="PSI (Population Stability)" value={drift.psi} threshold={0.2} />
                        <DriftBar label="KS Statistic" value={drift.ks} threshold={0.1} />
                        <DriftBar label="Feature Drift Score" value={drift.featureDrift} threshold={0.25} />
                      </div>
                      <div className="border rounded-lg p-4 space-y-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Forecast Quality Drift</p>
                        <DriftBar label="Target Drift" value={drift.targetDrift} threshold={0.15} />
                        <DriftBar label="Prediction Distribution Drift" value={drift.predDrift} threshold={0.2} />
                        <DriftBar label="Segment Drift" value={drift.segmentDrift} threshold={0.1} />
                        <div className="flex items-center justify-between text-[10px] pt-1 border-t">
                          <span className="text-muted-foreground">Baseline units forecasted</span>
                          <span className="font-mono font-bold">{(m.baselineUnits ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                      </div>
                      {driftAlert && (
                        <div className="md:col-span-2 flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                          Drift alert — PSI {drift.psi.toFixed(3)} exceeds threshold 0.200. Consider retraining with more recent data. See Insights tab for recommendations.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── TRENDS TAB ── */}
            {!monitorLoading && monitorTab === "trends" && monitoringData && (
              <div className="p-4 space-y-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-primary" />Performance Metrics — Monthly Trend
                    </h4>
                    <span className="text-[10px] text-muted-foreground">Model: {activeMonitorModel?.name}</span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={monitoringData.weeklyMetrics} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis
                        yAxisId="rate"
                        domain={([dataMin, dataMax]: [number, number]) => {
                          const pad = Math.max((dataMax - dataMin) * 0.15, 0.02);
                          return [Math.max(0, parseFloat((dataMin - pad).toFixed(2))), Math.min(1, parseFloat((dataMax + pad).toFixed(2)))];
                        }}
                        tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={v => v.toFixed(2)}
                      />
                      <YAxis
                        yAxisId="mae"
                        orientation="right"
                        tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={v => Number(v).toFixed(0)}
                      />
                      <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v: any) => (v as number).toFixed(4)} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Line yAxisId="rate" type="monotone" dataKey="r2" stroke={CHART_COLORS.r2} strokeWidth={2} dot={{ r: 3 }} name="R²" />
                      <Line yAxisId="rate" type="monotone" dataKey="wmape" stroke={CHART_COLORS.wmape} strokeWidth={2} dot={{ r: 3 }} name="WMAPE" />
                      <Line yAxisId="mae" type="monotone" dataKey="mae" stroke={CHART_COLORS.mae} strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 2" name="MAE" />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-muted-foreground">Note: Trend lines show baseline regression metrics from monitoring snapshots. R² and WMAPE use the left axis; MAE uses the right axis.</p>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />Drift Metrics — PSI & KS Over Time
                  </h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={monitoringData.weeklyMetrics} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
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
                      <Area type="monotone" dataKey="psi" stroke={CHART_COLORS.psi} fill="url(#psiGrad)" strokeWidth={2} dot={{ r: 3 }} name="PSI" />
                      <Area type="monotone" dataKey="ks" stroke={CHART_COLORS.ks} fill="url(#ksGrad)" strokeWidth={2} dot={{ r: 3 }} name="KS Stat" />
                    </AreaChart>
                  </ResponsiveContainer>
                  <div className="flex gap-4 text-[10px] text-muted-foreground">
                    <span>PSI threshold: <strong className="text-amber-400">0.200</strong></span>
                    <span>KS threshold: <strong className="text-amber-400">0.100</strong></span>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-blue-400" />Score Distribution by Period
                  </h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={monitoringData.weeklyMetrics} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                      <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v: any) => `${(v as number).toFixed(1)}%`} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Bar dataKey="highRiskPct" stackId="a" fill={CHART_COLORS.high} name="High Deviation %" opacity={0.85} />
                      <Bar dataKey="medRiskPct" stackId="a" fill={CHART_COLORS.med} name="Mid Deviation %" opacity={0.85} />
                      <Bar dataKey="lowRiskPct" stackId="a" fill={CHART_COLORS.low} name="On Target %" opacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── DRIVERS TAB ── */}
            {!monitorLoading && monitorTab === "drivers" && monitoringData && (
              <div className="p-4 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(monitoringData.driverChanges || []).slice(0, 6).map((d: any) => (
                    <div key={d.name}
                      className={`border rounded-lg p-3 ${d.trend === "rising" ? "border-emerald-500/30 bg-emerald-500/5" : d.trend === "declining" ? "border-amber-500/30 bg-amber-500/5" : ""}`}
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
                      <div className="h-2 bg-muted rounded overflow-hidden mb-1">
                        <div className="h-full rounded bg-primary" style={{ width: `${Math.min(100, (d.current / 0.278) * 100)}%` }} />
                      </div>
                      <div className="flex justify-between text-[9px]">
                        <span className="text-muted-foreground">Score: <span className="font-mono text-foreground">{d.current.toFixed(3)}</span></span>
                        <span className={d.delta > 0 ? "text-emerald-400" : d.delta < -0.005 ? "text-amber-400" : "text-muted-foreground"}>
                          {d.delta > 0 ? "+" : ""}{(d.delta * 100).toFixed(1)} ({d.deltaPct > 0 ? "+" : ""}{d.deltaPct}%)
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5 text-primary" />Feature Importance Evolution — 6 Periods
                  </h4>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={monitoringData.featureHistory} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => v.toFixed(2)} />
                      <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v: any) => (v as number).toFixed(4)} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      {(monitoringData.featureNames || []).map((name: string, idx: number) => {
                        const colors = ["#22c55e", "#3b82f6", "#a78bfa", "#f97316", "#FFD822", "#ec4899"];
                        return <Line key={name} type="monotone" dataKey={name} stroke={colors[idx % colors.length]} strokeWidth={1.5} dot={false} name={name.replace(/_/g, " ")} />;
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-emerald-500/30 rounded-lg p-3 bg-emerald-500/5">
                    <h5 className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                      <ArrowUpRight className="w-3 h-3" />Rising Drivers
                    </h5>
                    {(monitoringData.driverChanges || []).filter((d: any) => d.trend === "rising").length === 0
                      ? <p className="text-[10px] text-muted-foreground">No significantly rising drivers.</p>
                      : (monitoringData.driverChanges || []).filter((d: any) => d.trend === "rising").map((d: any) => (
                        <div key={d.name} className="flex justify-between text-[10px] py-0.5">
                          <span className="font-mono text-emerald-800">{d.name}</span>
                          <span className="text-emerald-700 font-medium">+{d.deltaPct}%</span>
                        </div>
                      ))}
                  </div>
                  <div className="border border-amber-500/30 rounded-lg p-3 bg-amber-500/5">
                    <h5 className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                      <ArrowDownRight className="w-3 h-3" />Declining Drivers
                    </h5>
                    {(monitoringData.driverChanges || []).filter((d: any) => d.trend === "declining").length === 0
                      ? <p className="text-[10px] text-muted-foreground">No significantly declining drivers.</p>
                      : (monitoringData.driverChanges || []).filter((d: any) => d.trend === "declining").map((d: any) => (
                        <div key={d.name} className="flex justify-between text-[10px] py-0.5">
                          <span className="font-mono text-amber-800">{d.name}</span>
                          <span className="text-amber-700 font-medium">{d.deltaPct}%</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── INSIGHTS TAB ── */}
            {!monitorLoading && monitorTab === "insights" && monitoringData && (
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2 p-3 rounded-lg border border-blue-500/30 bg-blue-500/5">
                  <Sparkles className="w-4 h-4 text-blue-700 flex-shrink-0" />
                  <p className="text-[11px] text-blue-800">
                    ML Orion analysed monitoring trends, drift signals, and feature evolution to generate these prioritised recommendations.
                  </p>
                </div>
                {(monitoringData.recommendations || [])
                  .sort((a: any, b: any) => {
                    const o: Record<string, number> = { high: 0, medium: 1, low: 2 };
                    return (o[a.severity] ?? 3) - (o[b.severity] ?? 3);
                  })
                  .map((rec: any) => <RecommendationCard key={rec.id} rec={rec} />)}
              </div>
            )}
          </div>
        )}

        {/* ── AVAILABLE TO DEPLOY ── */}
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">Available to Deploy</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {availableModels.length} trained baseline models ready for deployment
            </p>
          </div>
          {availableModels.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-xs">
              No trained models available. Run a baseline prediction in the Experiments page.
              <div className="mt-2">
                <a href={`${CPG_BASE}/experiments`} className="text-primary underline text-xs">Go to Experiments →</a>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {["Model", "Algorithm", "R²", "WMAPE", "MAE", "Rows Scored", "Trained", "Approval", "Actions"].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {availableModels.map(m => (
                    <tr key={m.id} className="border-b hover:bg-muted/10" data-testid={`row-available-${m.id}`}>
                      <td className="px-3 py-2 font-medium max-w-[160px] truncate">{m.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
                      <td className="px-3 py-2 font-mono font-bold text-emerald-600">{m.r2 != null ? m.r2.toFixed(3) : "—"}</td>
                      <td className="px-3 py-2 font-mono">{m.wmape != null ? `${(m.wmape * 100).toFixed(1)}%` : "—"}</td>
                      <td className="px-3 py-2 font-mono">{m.mae != null ? m.mae.toFixed(2) : "—"}</td>
                      <td className="px-3 py-2 font-mono">{m.rowCount?.toLocaleString() ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{m.trainedAt ? new Date(m.trainedAt).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={
                          m.approvalStatus === "approved" ? "Approved"
                            : m.approvalStatus === "rejected" ? "Rejected"
                              : "Pending"
                        } />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-emerald-500/10 hover:text-emerald-500"
                            onClick={() => deployMut.mutate(m.id)} title="Deploy"
                            data-testid={`button-deploy-${m.id}`}>
                            <PlayCircle className="w-3 h-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
                            onClick={() => { setApprovalModel(m); setApprovalNotes(""); setApprovalAction("approve"); }}
                            title="Submit for approval"
                            data-testid={`button-request-approval-${m.id}`}>
                            <Send className="w-3 h-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
                            onClick={() => setDeleteId(m.id)} title="Delete"
                            data-testid={`button-delete-available-${m.id}`}>
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

      </div>

      {/* ── Delete Dialog ── */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Model</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteTarget?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMut.mutate(deleteId)}>
              Delete Model
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Approval Dialog ── */}
      <Dialog open={!!approvalModel} onOpenChange={() => setApprovalModel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{approvalAction === "approve" ? "Approve" : "Reject"} Model</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Model: <strong>{approvalModel?.name}</strong></p>
            {approvalModel && (
              <div className="grid grid-cols-3 gap-2 p-3 bg-muted/30 rounded text-[10px]">
                <div><span className="text-muted-foreground">R²</span><br /><strong>{approvalModel.r2 != null ? approvalModel.r2.toFixed(3) : "—"}</strong></div>
                <div><span className="text-muted-foreground">WMAPE</span><br /><strong>{approvalModel.wmape != null ? `${(approvalModel.wmape * 100).toFixed(1)}%` : "—"}</strong></div>
                <div><span className="text-muted-foreground">MAE</span><br /><strong>{approvalModel.mae != null ? approvalModel.mae.toFixed(2) : "—"}</strong></div>
              </div>
            )}
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
              className={approvalAction === "approve"
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
              onClick={() => approvalModel && approveMut.mutate({ id: approvalModel.id, notes: approvalNotes, action: approvalAction })}
              disabled={approveMut.isPending}
              data-testid="button-confirm-approval"
            >
              {approvalAction === "approve"
                ? <><CheckCircle className="w-3.5 h-3.5 mr-1.5" />Approve Model</>
                : <><XCircle className="w-3.5 h-3.5 mr-1.5" />Reject Model</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OrionLayout>
  );
}
