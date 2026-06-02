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
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar, ReferenceLine,
} from "recharts";

const CPG_BASE = "/cpg/price-elasticity/orion";
const API_BASE = "/api/cpg/price_elasticity";
const MODELS_API = `${API_BASE}/models`;
const DATASETS_API = `${API_BASE}/datasets`;
const ORION_API = `${API_BASE}/orion`;
const PREDICTIONS_API = `${API_BASE}/predictions/predictions`;
const MONITORING_API = `${API_BASE}/orion/monitoring`;

const CUSTOM_TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  fontSize: "10px",
};

// ── Sub-components ────────────────────────────────────────────────────────────

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
    <div className={`border rounded-lg p-4 space-y-3 ${borderColor}`}>
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

function getMonitoringStatus(m: any) {
  if (!m.isDeployed) return { status: "stale", label: "Not Deployed" };
  if (!m.rowCount || m.rowCount === 0) return { status: "stale", label: "Stale — No Data" };
  const weights = m.modelWeights ?? {};
  if (weights.modelConverged === false) return { status: "at risk", label: "At Risk" };
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
      qc.invalidateQueries({ queryKey: [MONITORING_API, activeMonitorId, prodDatasetId] });
      qc.invalidateQueries({ queryKey: [MODELS_API] });
      const m = data.metrics || {};
      const parts = [`${data.rowsProcessed ?? 0} rows`];
      if (m.globalPriceElasticity != null) parts.push(`Elasticity ${Number(m.globalPriceElasticity).toFixed(3)}`);
      toast({ title: `Prod evaluation complete · ${parts.join(" · ")}` });
    },
    onError: (e: any) => toast({ title: "Evaluation failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `${MODELS_API}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [MODELS_API] });
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

  const healthyCount = deployedModels.filter(m => getMonitoringStatus(m).status === "healthy").length;
  const atRiskCount  = deployedModels.filter(m => getMonitoringStatus(m).status === "at risk").length;
  const staleCount   = deployedModels.filter(m => getMonitoringStatus(m).status === "stale").length;
  const totalRowsProcessed = models.reduce((s, m) => s + (m.rowCount ?? m.modelWeights?.rowsProcessed ?? 0), 0);

  const elasticityValues = deployedModels
    .map(m => m.modelWeights?.globalPriceElasticity ?? m.r2)
    .filter((v): v is number => v != null);
  const avgElasticity = elasticityValues.length
    ? (elasticityValues.reduce((s, v) => s + v, 0) / elasticityValues.length).toFixed(3)
    : null;

  const activeMonitorModel = models.find(m => m.id === activeMonitorId);
  const activeWeights = (activeMonitorModel?.modelWeights ?? {}) as any;
  const activeElasticity = activeWeights.globalPriceElasticity ?? activeMonitorModel?.r2 ?? null;
  const activeBrandsScored = (activeWeights.elasticitySummary ?? []).length;
  const activeConverged = activeWeights.modelConverged ?? null;
  const activeRows = activeMonitorModel?.rowCount ?? activeWeights.rowsProcessed ?? 0;

  const deleteTarget = models.find(m => m.id === deleteId);
  const highSeverityCount = (monitoringData?.recommendations || []).filter((r: any) => r.severity === "high").length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <OrionLayout title="Deploy & Score" subtitle="Production model management, elasticity monitoring, and observability">
      <div className="space-y-4">
        <OrionNav current={`${CPG_BASE}/deploy`} basePath={CPG_BASE} />

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <KpiCard label="Deployed Models" value={deployedModels.length} color="green" />
          <KpiCard label="Converged" value={healthyCount} color="green" />
          <KpiCard label="At Risk" value={atRiskCount} color={atRiskCount > 0 ? "amber" : "green"} />
          <KpiCard label="Stale" value={staleCount} color={staleCount > 0 ? "amber" : "green"} />
          <KpiCard label="Avg Elasticity" value={avgElasticity ?? "—"} color="blue" />
          <KpiCard label="Total Rows" value={totalRowsProcessed.toLocaleString()} />
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
                    {["Model", "Algorithm", "Global Elasticity", "Converged", "Brands Scored", "Rows", "Deployed", "Status", "Approval", "Actions"].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deployedModels.map(m => {
                    const w = m.modelWeights ?? {};
                    const elas = w.globalPriceElasticity ?? m.r2 ?? null;
                    const converged = w.modelConverged ?? null;
                    const brands = (w.elasticitySummary ?? []).length;
                    const rows = m.rowCount ?? w.rowsProcessed ?? null;
                    const monStatus = getMonitoringStatus(m);
                    return (
                      <tr key={m.id} className="border-b hover:bg-muted/10">
                        <td className="px-3 py-2 font-medium max-w-[160px] truncate">{m.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
                        <td
                          className="px-3 py-2 font-mono font-bold"
                          style={{ color: elas == null ? undefined : elas < -1 ? "#dc2626" : elas < 0 ? "#2563eb" : "#16a34a" }}
                        >
                          {elas != null ? Number(elas).toFixed(3) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {converged === null ? "—"
                            : converged
                            ? <span className="text-green-600 font-medium">Yes</span>
                            : <span className="text-amber-600 font-medium">No</span>}
                        </td>
                        <td className="px-3 py-2 font-mono">{brands > 0 ? brands : "—"}</td>
                        <td className="px-3 py-2 font-mono">{rows != null ? Number(rows).toLocaleString() : "—"}</td>
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
                              title="Score records">
                              <Target className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
                              onClick={() => { setApprovalModel(m); setApprovalNotes(""); setApprovalAction(m.approvalStatus === "approved" ? "reject" : "approve"); }}
                              title="Approve/reject">
                              <ShieldCheck className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
                              onClick={() => undeployMut.mutate(m.id)} title="Undeploy">
                              <StopCircle className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
                              onClick={() => setDeleteId(m.id)} title="Delete">
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
                  >
                    <option value="">— training data —</option>
                    {(allDatasets as any[]).map((ds: any) => (
                      <option key={ds.id} value={ds.id}>{ds.name} ({ds.rowCount?.toLocaleString()} rows)</option>
                    ))}
                  </select>
                  {prodDatasetId && activeMonitorId && (
                    <button
                      onClick={() => evalProdMut.mutate({ modelId: activeMonitorId, prodDatasetId })}
                      disabled={evalProdMut.isPending}
                      title="Run elasticity model on production dataset"
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                    >
                      {evalProdMut.isPending
                        ? <><Loader2 className="w-3 h-3 animate-spin" />Evaluating…</>
                        : <><FlaskConical className="w-3 h-3" />Evaluate on Prod</>}
                    </button>
                  )}
                </div>
                <div className="flex gap-1">
                  {(["health", "trends", "drivers", "insights"] as const).map(t => (
                    <button key={t} onClick={() => setMonitorTab(t)}
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
                {/* Row 1 — elasticity outputs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">Global Elasticity</p>
                    <p className="text-xl font-mono font-bold"
                      style={{ color: activeElasticity == null ? undefined : activeElasticity < -1 ? "#dc2626" : activeElasticity < 0 ? "#2563eb" : "#16a34a" }}>
                      {activeElasticity != null ? Number(activeElasticity).toFixed(3) : "—"}
                    </p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">price elasticity</p>
                  </div>
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">Converged</p>
                    <p className={`text-xl font-mono font-bold ${activeConverged === true ? "text-emerald-600" : activeConverged === false ? "text-amber-600" : ""}`}>
                      {activeConverged === null ? "—" : activeConverged ? "Yes" : "No"}
                    </p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">model convergence</p>
                  </div>
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">Brands Scored</p>
                    <p className="text-xl font-mono font-bold text-blue-600">{activeBrandsScored}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">brand-level results</p>
                  </div>
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">Rows Processed</p>
                    <p className="text-xl font-mono font-bold text-blue-600">{Number(activeRows).toLocaleString()}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">training data</p>
                  </div>
                </div>

                {/* Row 2 — model fit & statistical metrics */}
                {(() => {
                  const w = activeWeights;
                  const r2Val   = w.r2   ?? activeMonitorModel.r2   ?? null;
                  const maeVal  = w.mae  ?? activeMonitorModel.mae  ?? null;
                  const rmseVal = w.rmse ?? activeMonitorModel.rmse ?? null;
                  const aicVal  = w.aic  ?? null;
                  const pVal    = w.priceCoefPvalue ?? null;
                  const seVal   = w.priceCoefStdErr ?? null;
                  const sig     = pVal != null ? (pVal < 0.001 ? "< 0.001 ***" : pVal < 0.01 ? `${pVal.toFixed(3)} **` : pVal < 0.05 ? `${pVal.toFixed(3)} *` : pVal.toFixed(3)) : null;
                  return (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                      <div className="bg-muted/30 border rounded-lg p-3 text-center">
                        <p className="text-[10px] text-muted-foreground">R² (log-sales)</p>
                        <p className={`text-xl font-mono font-bold ${r2Val == null ? "" : r2Val >= 0.7 ? "text-emerald-600" : r2Val >= 0.4 ? "text-amber-600" : "text-red-600"}`}>
                          {r2Val != null ? Number(r2Val).toFixed(3) : "—"}
                        </p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">fit quality</p>
                      </div>
                      <div className="bg-muted/30 border rounded-lg p-3 text-center">
                        <p className="text-[10px] text-muted-foreground">MAE</p>
                        <p className="text-xl font-mono font-bold">
                          {maeVal != null ? Number(maeVal).toFixed(4) : "—"}
                        </p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">log-units residual</p>
                      </div>
                      <div className="bg-muted/30 border rounded-lg p-3 text-center">
                        <p className="text-[10px] text-muted-foreground">RMSE</p>
                        <p className="text-xl font-mono font-bold">
                          {rmseVal != null ? Number(rmseVal).toFixed(4) : "—"}
                        </p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">log-units residual</p>
                      </div>
                      <div className="bg-muted/30 border rounded-lg p-3 text-center">
                        <p className="text-[10px] text-muted-foreground">AIC</p>
                        <p className="text-xl font-mono font-bold text-muted-foreground">
                          {aicVal != null ? Number(aicVal).toFixed(1) : "—"}
                        </p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">lower = better fit</p>
                      </div>
                      <div className="bg-muted/30 border rounded-lg p-3 text-center">
                        <p className="text-[10px] text-muted-foreground">Price p-value</p>
                        <p className={`text-xl font-mono font-bold ${pVal == null ? "" : pVal < 0.05 ? "text-emerald-600" : "text-amber-600"}`}>
                          {sig ?? "—"}
                        </p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">coef significance</p>
                      </div>
                      <div className="bg-muted/30 border rounded-lg p-3 text-center">
                        <p className="text-[10px] text-muted-foreground">Std Error</p>
                        <p className="text-xl font-mono font-bold">
                          {seVal != null ? Number(seVal).toFixed(4) : "—"}
                        </p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">price coef ±</p>
                      </div>
                    </div>
                  );
                })()}

                {monitoringData?.weeklyMetrics?.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border rounded-lg p-4 space-y-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Elasticity Range Across Runs</p>
                      {(() => {
                        const vals = (monitoringData.weeklyMetrics as any[]).map((m: any) => m.elasticity).filter((v: any) => v != null);
                        const min = Math.min(...vals);
                        const max = Math.max(...vals);
                        const range = max - min;
                        const latest = vals[vals.length - 1] ?? 0;
                        const rangeColor = range > 0.5 ? "text-amber-600" : "text-emerald-600";
                        return (
                          <div className="space-y-2 text-xs">
                            <div className="flex justify-between"><span className="text-muted-foreground">Latest</span><span className="font-mono font-bold">{latest.toFixed(3)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Min</span><span className="font-mono">{min.toFixed(3)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Max</span><span className="font-mono">{max.toFixed(3)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Range</span><span className={`font-mono font-bold ${rangeColor}`}>{range.toFixed(3)}</span></div>
                            {range > 0.5 && (
                              <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5 mt-1">
                                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                High elasticity variance across runs — consider retraining with more data.
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="border rounded-lg p-4 space-y-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Brand Coverage</p>
                      <div className="space-y-2 text-xs">
                        {(() => {
                          const latest = monitoringData.weeklyMetrics[monitoringData.weeklyMetrics.length - 1] ?? {};
                          const convergedRuns = monitoringData.weeklyMetrics.filter((m: any) => m.converged === 1).length;
                          const totalRuns = monitoringData.weeklyMetrics.length;
                          return (
                            <>
                              <div className="flex justify-between"><span className="text-muted-foreground">Brands Scored (latest)</span><span className="font-mono font-bold">{latest.brandsScored ?? 0}</span></div>
                              <div className="flex justify-between"><span className="text-muted-foreground">Rows Processed (latest)</span><span className="font-mono">{Number(latest.rowsProcessed ?? 0).toLocaleString()}</span></div>
                              <div className="flex justify-between"><span className="text-muted-foreground">Converged Runs</span><span className={`font-mono font-bold ${convergedRuns === totalRuns ? "text-emerald-600" : "text-amber-600"}`}>{convergedRuns}/{totalRuns}</span></div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── TRENDS TAB ── */}
            {!monitorLoading && monitorTab === "trends" && monitoringData && (
              <div className="p-4 space-y-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold flex items-center gap-1.5">
                      <TrendingDown className="w-3.5 h-3.5 text-primary" />Global Elasticity — Run Trend
                    </h4>
                    <span className="text-[10px] text-muted-foreground">Model: {activeMonitorModel?.name}</span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={monitoringData.weeklyMetrics} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => v.toFixed(2)} />
                      <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v: any) => (v as number).toFixed(4)} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <ReferenceLine y={-1} stroke="#f97316" strokeDasharray="4 2" label={{ value: "Elastic threshold", position: "insideBottomRight", fontSize: 9, fill: "#f97316" }} />
                      <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="elasticity" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Global Elasticity" />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-muted-foreground">Orange line = elastic threshold (−1). Values below indicate high price sensitivity.</p>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-blue-400" />Brands Scored & Convergence per Run
                  </h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={monitoringData.weeklyMetrics} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Bar dataKey="brandsScored" fill="#22c55e" name="Brands Scored" opacity={0.85} />
                      <Bar dataKey="converged" fill="#3b82f6" name="Converged (1=Yes)" opacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-emerald-400" />Rows Processed Over Time
                  </h4>
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={monitoringData.weeklyMetrics} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="rowsGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v: any) => Number(v).toLocaleString()} />
                      <Area type="monotone" dataKey="rowsProcessed" stroke="#22c55e" fill="url(#rowsGrad)" strokeWidth={2} dot={{ r: 3 }} name="Rows Processed" />
                    </AreaChart>
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
                      className={`border rounded-lg p-3 ${d.trend === "declining" ? "border-amber-500/30 bg-amber-500/5" : "border-border"}`}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-[11px] font-mono font-semibold text-blue-700 truncate">{d.name}</p>
                          <p className="text-[9px] text-muted-foreground capitalize">{d.displayName}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          {d.trend === "declining" && <><ArrowDownRight className="w-3.5 h-3.5 text-amber-700" /><span className="text-[9px] text-amber-700 font-bold">High Elastic</span></>}
                          {d.trend === "stable" && <><Minus className="w-3 h-3 text-muted-foreground" /><span className="text-[9px] text-muted-foreground">Inelastic</span></>}
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded overflow-hidden mb-1">
                        <div className="h-full rounded"
                          style={{
                            width: `${Math.min(100, (d.current / 2) * 100)}%`,
                            backgroundColor: d.current > 1 ? "#ef4444" : "#3b82f6",
                          }} />
                      </div>
                      <div className="flex justify-between text-[9px]">
                        <span className="text-muted-foreground">|Elasticity|: <span className="font-mono text-foreground">{d.current.toFixed(3)}</span></span>
                        <span className={d.current > 1 ? "text-red-500" : "text-blue-500"}>
                          {d.current > 1 ? "Highly Elastic" : "Inelastic"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5 text-primary" />Elasticity Evolution — Run History
                  </h4>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={monitoringData.featureHistory} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => v.toFixed(2)} />
                      <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v: any) => (v as number).toFixed(4)} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <ReferenceLine y={-1} stroke="#f97316" strokeDasharray="3 3" />
                      <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
                      {(monitoringData.featureNames || []).map((name: string, idx: number) => {
                        const colors = ["#3b82f6", "#22c55e", "#a78bfa", "#f97316", "#ec4899"];
                        return <Line key={name} type="monotone" dataKey={name} stroke={colors[idx % colors.length]} strokeWidth={1.5} dot={false} name={name.replace(/_/g, " ")} />;
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-red-500/30 rounded-lg p-3 bg-red-500/5">
                    <h5 className="text-[10px] font-semibold text-red-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                      <ArrowDownRight className="w-3 h-3" />Highly Elastic Brands (&lt; −1)
                    </h5>
                    {(monitoringData.driverChanges || []).filter((d: any) => d.trend === "declining").length === 0
                      ? <p className="text-[10px] text-muted-foreground">No highly elastic brands detected.</p>
                      : (monitoringData.driverChanges || []).filter((d: any) => d.trend === "declining").map((d: any) => (
                        <div key={d.name} className="flex justify-between text-[10px] py-0.5">
                          <span className="font-mono text-red-800">{d.name}</span>
                          <span className="text-red-700 font-medium">{d.current.toFixed(3)}</span>
                        </div>
                      ))}
                  </div>
                  <div className="border border-blue-500/30 rounded-lg p-3 bg-blue-500/5">
                    <h5 className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Minus className="w-3 h-3" />Inelastic Brands (−1 to 0)
                    </h5>
                    {(monitoringData.driverChanges || []).filter((d: any) => d.trend === "stable").length === 0
                      ? <p className="text-[10px] text-muted-foreground">No inelastic brands in top drivers.</p>
                      : (monitoringData.driverChanges || []).filter((d: any) => d.trend === "stable").map((d: any) => (
                        <div key={d.name} className="flex justify-between text-[10px] py-0.5">
                          <span className="font-mono text-blue-800">{d.name}</span>
                          <span className="text-blue-700 font-medium">{d.current.toFixed(3)}</span>
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
                    ML Orion analysed elasticity trends, brand sensitivity, and portfolio patterns to generate these prioritised recommendations.
                  </p>
                </div>
                {(monitoringData.recommendations || []).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">No recommendations generated. Deploy a model with brand-level elasticity results to see insights.</p>
                )}
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
              {availableModels.length} trained price elasticity models ready for deployment
            </p>
          </div>
          {availableModels.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-xs">
              No trained models available. Run a price elasticity experiment first.
              <div className="mt-2">
                <a href={`${CPG_BASE}/experiments`} className="text-primary underline text-xs">Go to Experiments →</a>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {["Model", "Algorithm", "Global Elasticity", "Converged", "Brands Scored", "Rows", "Trained", "Approval", "Actions"].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {availableModels.map(m => {
                    const w = m.modelWeights ?? {};
                    const elas = w.globalPriceElasticity ?? m.r2 ?? null;
                    const converged = w.modelConverged ?? null;
                    const brands = (w.elasticitySummary ?? []).length;
                    const rows = m.rowCount ?? w.rowsProcessed ?? null;
                    return (
                      <tr key={m.id} className="border-b hover:bg-muted/10">
                        <td className="px-3 py-2 font-medium max-w-[160px] truncate">{m.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
                        <td
                          className="px-3 py-2 font-mono font-bold"
                          style={{ color: elas == null ? undefined : elas < -1 ? "#dc2626" : elas < 0 ? "#2563eb" : "#16a34a" }}
                        >
                          {elas != null ? Number(elas).toFixed(3) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {converged === null ? "—"
                            : converged
                            ? <span className="text-green-600 font-medium">Yes</span>
                            : <span className="text-amber-600 font-medium">No</span>}
                        </td>
                        <td className="px-3 py-2 font-mono">{brands > 0 ? brands : "—"}</td>
                        <td className="px-3 py-2 font-mono">{rows != null ? Number(rows).toLocaleString() : "—"}</td>
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
                              onClick={() => deployMut.mutate(m.id)} title="Deploy">
                              <PlayCircle className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
                              onClick={() => { setApprovalModel(m); setApprovalNotes(""); setApprovalAction("approve"); }}
                              title="Submit for approval">
                              <Send className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
                              onClick={() => setDeleteId(m.id)} title="Delete">
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
                <div>
                  <span className="text-muted-foreground">Global Elasticity</span><br />
                  <strong>{approvalModel.modelWeights?.globalPriceElasticity != null ? Number(approvalModel.modelWeights.globalPriceElasticity).toFixed(3) : approvalModel.r2 != null ? Number(approvalModel.r2).toFixed(3) : "—"}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Converged</span><br />
                  <strong>{approvalModel.modelWeights?.modelConverged === true ? "Yes" : approvalModel.modelWeights?.modelConverged === false ? "No" : "—"}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Brands Scored</span><br />
                  <strong>{(approvalModel.modelWeights?.elasticitySummary ?? []).length || "—"}</strong>
                </div>
              </div>
            )}
            <div>
              <label className="text-xs font-medium">Review Notes</label>
              <textarea
                className="mt-1 w-full h-20 text-xs border rounded p-2 bg-background resize-none"
                placeholder="Add notes for the governance audit log…"
                value={approvalNotes}
                onChange={e => setApprovalNotes(e.target.value)}
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
