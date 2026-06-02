import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, BarChart, Bar,
} from "recharts";
import {
  Rocket, PauseCircle, Activity, ShieldCheck, TrendingUp,
  TrendingDown, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

type AnomalyModel = {
  id: number;
  name: string;
  algorithm: string;
  status: string;
  isDeployed: boolean;
  trainedAt: string | null;
  modelWeights: { modelType?: string; summary?: any } | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function DriftBar({ label, value, threshold }: { label: string; value: number; threshold: number }) {
  const pct      = Math.min(value * 100, 100);
  const barColor = value < threshold * 0.5 ? "bg-emerald-500" : value < threshold ? "bg-amber-500" : "bg-red-500";
  const textColor = value >= threshold ? "text-red-400" : value >= threshold * 0.5 ? "text-amber-400" : "text-emerald-400";
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

// ── Component ──────────────────────────────────────────────────────────────────

export default function OrionDeployPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [monitorTab, setMonitorTab] = useState<"overview" | "drift" | "kpis">("overview");

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: allModels = [] } = useQuery<AnomalyModel[]>({ queryKey: ["/api/retail/kpiAnomaly/models"] });
  const anomalyModels: AnomalyModel[] = (allModels as AnomalyModel[]).filter(
    m => m.modelWeights?.modelType === "kpi_anomaly"
  );

  const deployedModels   = anomalyModels.filter(m => m.isDeployed);
  const availableModels  = anomalyModels.filter(m => !m.isDeployed && m.status === "trained");

  const activeMonitorId = selectedModelId ?? (deployedModels[0]?.id ?? anomalyModels[0]?.id ?? null);

  const { data: monitorData } = useQuery<any>({
    queryKey: ["/api/retail/kpiAnomaly/monitoring", activeMonitorId],
    queryFn: () => fetch(`/api/retail/kpiAnomaly/monitoring/${activeMonitorId}`).then(r => r.json()),
    enabled: activeMonitorId !== null,
    refetchInterval: 30000,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const deployMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/retail/kpiAnomaly/models/${id}/deploy`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/models"] });
      toast({ title: "Model deployed" });
    },
    onError: (e: any) => toast({ title: "Deploy failed", description: e.message, variant: "destructive" }),
  });

  const undeployMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/retail/kpiAnomaly/models/${id}/undeploy`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/models"] });
      toast({ title: "Model undeployed" });
    },
    onError: (e: any) => toast({ title: "Undeploy failed", description: e.message, variant: "destructive" }),
  });

  // ── Monitoring data ────────────────────────────────────────────────────────

  const weeklyMetrics: any[] = monitorData?.weeklyMetrics ?? [];
  const summary              = monitorData?.summary ?? {};
  const recommendations: any[] = monitorData?.recommendations ?? [];
  const kpiStats             = monitorData?.kpiStats ?? {};
  const latestSnap           = weeklyMetrics[weeklyMetrics.length - 1] ?? {};
  const prevSnap             = weeklyMetrics[weeklyMetrics.length - 2] ?? {};

  const anomalyRateDelta = (latestSnap.anomalyRate ?? 0) - (prevSnap.anomalyRate ?? 0);
  const psiDelta         = (latestSnap.psi ?? 0) - (prevSnap.psi ?? 0);

  const activeModel = anomalyModels.find(m => m.id === activeMonitorId) ?? null;

  // ── KPI stats chart ────────────────────────────────────────────────────────

  const kpiChartData = Object.entries(kpiStats as Record<string, any>)
    .map(([name, s]: [string, any]) => ({
      name,
      anomalies: s.anomalyCount ?? s.total_anomalies ?? 0,
    }))
    .sort((a, b) => b.anomalies - a.anomalies)
    .slice(0, 8);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <OrionLayout title="Deploy & Monitor" subtitle="Deploy anomaly detection models and track real-time KPI health">
      <div className="mb-4"><OrionNav current="/retail/kpi-anomaly/orion/deploy" basePath="/retail/kpi-anomaly/orion" /></div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Deployed Models"  value={deployedModels.length} color={deployedModels.length > 0 ? "green" : "default"} />
        <KpiCard label="Total Models"     value={anomalyModels.length} />
        <KpiCard label="Latest Anomaly Rate" value={latestSnap.anomalyRate != null ? `${Number(latestSnap.anomalyRate).toFixed(1)}%` : "—"} color={latestSnap.anomalyRate > 25 ? "amber" : "green"} />
        <KpiCard label="Latest PSI"       value={latestSnap.psi != null ? Number(latestSnap.psi).toFixed(3) : "—"} color={latestSnap.psi > 0.2 ? "amber" : "green"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── LEFT: Model list ─────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Deployed models */}
          <div className="border rounded-lg bg-card">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-500" /> Live Models
              </h3>
            </div>
            {deployedModels.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4">No models deployed. Deploy one below.</p>
            ) : (
              <div className="divide-y">
                {deployedModels.map(m => (
                  <div
                    key={m.id}
                    className={`p-3 cursor-pointer hover:bg-muted/20 transition-colors ${activeMonitorId === m.id ? "bg-muted/30" : ""}`}
                    onClick={() => setSelectedModelId(m.id)}
                    data-testid={`row-deployed-${m.id}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium truncate max-w-[140px]">{m.name}</p>
                      <StatusBadge status="Production" />
                    </div>
                    <p className="text-[10px] text-muted-foreground">{m.algorithm}</p>
                    <Button
                      size="sm" variant="outline"
                      className="mt-2 h-6 text-[10px] w-full gap-1"
                      onClick={e => { e.stopPropagation(); undeployMut.mutate(m.id); }}
                      disabled={undeployMut.isPending}
                      data-testid={`button-undeploy-${m.id}`}
                    >
                      <PauseCircle className="w-3 h-3" /> Undeploy
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Available to deploy */}
          {availableModels.length > 0 && (
            <div className="border rounded-lg bg-card">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold">Ready to Deploy</h3>
              </div>
              <div className="divide-y">
                {availableModels.map(m => {
                  const s = m.modelWeights?.summary;
                  return (
                    <div key={m.id} className="p-3" data-testid={`row-available-${m.id}`}>
                      <p className="text-xs font-medium truncate mb-0.5">{m.name}</p>
                      <p className="text-[10px] text-muted-foreground mb-2">
                        {s?.totalAnomalies?.toLocaleString() ?? "—"} anomalies · {s?.kpisProcessed?.length ?? "—"} KPIs
                      </p>
                      <Button
                        size="sm" className="h-6 text-[10px] w-full gap-1"
                        onClick={() => deployMut.mutate(m.id)}
                        disabled={deployMut.isPending}
                        data-testid={`button-deploy-${m.id}`}
                      >
                        <Rocket className="w-3 h-3" /> Deploy
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div className="border rounded-lg bg-card">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-500" /> Recommendations
                </h3>
              </div>
              <div className="divide-y">
                {recommendations.map((r: any) => (
                  <div key={r.id} className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      {r.severity === "high" ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      <p className="text-[11px] font-semibold">{r.title}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{r.detail}</p>
                    <p className="text-[10px] text-primary mt-1">{r.action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Monitoring ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {activeModel ? (
            <>
              {/* Model selector */}
              <div className="flex items-center gap-3 flex-wrap">
                <select
                  className="border rounded px-3 py-1.5 text-sm bg-background"
                  value={activeMonitorId ?? ""}
                  onChange={e => setSelectedModelId(Number(e.target.value))}
                >
                  {anomalyModels.map(m => (
                    <option key={m.id} value={m.id}>{m.name} {m.isDeployed ? "(live)" : ""}</option>
                  ))}
                </select>
                <StatusBadge status={activeModel.isDeployed ? "Production" : activeModel.status} />
              </div>

              {/* Monitor KPIs */}
              <div className="grid grid-cols-3 gap-3">
                <div className="border rounded-lg p-3 bg-card text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">Anomaly Rate</p>
                  <p className="text-lg font-bold">{latestSnap.anomalyRate != null ? `${Number(latestSnap.anomalyRate).toFixed(1)}%` : "—"}</p>
                  {anomalyRateDelta !== 0 && (
                    <div className={`flex items-center justify-center gap-1 text-[10px] ${anomalyRateDelta > 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {anomalyRateDelta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {anomalyRateDelta > 0 ? "+" : ""}{anomalyRateDelta.toFixed(1)}%
                    </div>
                  )}
                </div>
                <div className="border rounded-lg p-3 bg-card text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">PSI (Drift)</p>
                  <p className={`text-lg font-bold ${latestSnap.psi > 0.2 ? "text-amber-500" : "text-foreground"}`}>
                    {latestSnap.psi != null ? Number(latestSnap.psi).toFixed(3) : "—"}
                  </p>
                  {psiDelta !== 0 && (
                    <div className={`flex items-center justify-center gap-1 text-[10px] ${psiDelta > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                      {psiDelta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {psiDelta > 0 ? "+" : ""}{psiDelta.toFixed(3)}
                    </div>
                  )}
                </div>
                <div className="border rounded-lg p-3 bg-card text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">KS Statistic</p>
                  <p className="text-lg font-bold">{latestSnap.ks != null ? Number(latestSnap.ks).toFixed(3) : "—"}</p>
                </div>
              </div>

              {/* Tab nav */}
              <div className="flex gap-1 border-b">
                {(["overview", "drift", "kpis"] as const).map(t => (
                  <button key={t} onClick={() => setMonitorTab(t)}
                    className={`px-4 py-2 text-xs font-medium capitalize border-b-2 transition-colors ${monitorTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                    {t === "overview" ? "Anomaly Trend" : t === "drift" ? "Drift Metrics" : "KPI Breakdown"}
                  </button>
                ))}
              </div>

              {/* Overview: anomaly rate over time */}
              {monitorTab === "overview" && (
                <div className="border rounded-lg p-4 bg-card">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-3">Anomaly Rate Over Time</h3>
                  {weeklyMetrics.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No monitoring data yet.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={weeklyMetrics} margin={{ left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} unit="%" />
                        <Tooltip formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                        <Line type="monotone" dataKey="anomalyRate" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} name="Anomaly Rate" />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              )}

              {/* Drift metrics over time */}
              {monitorTab === "drift" && (
                <div className="border rounded-lg p-4 bg-card space-y-4">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase">Drift Over Time</h3>
                  {weeklyMetrics.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No drift data yet.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={weeklyMetrics} margin={{ left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                        <YAxis tick={{ fontSize: 9 }} />
                        <Tooltip formatter={(v: any) => Number(v).toFixed(3)} />
                        <Line type="monotone" dataKey="psi" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} name="PSI" />
                        <Line type="monotone" dataKey="ks"  stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} name="KS" />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                  <div className="space-y-3 pt-2">
                    <DriftBar label="PSI (Population Stability Index)" value={latestSnap.psi ?? 0} threshold={0.2} />
                    <DriftBar label="KS Statistic"                     value={latestSnap.ks  ?? 0} threshold={0.1} />
                  </div>
                </div>
              )}

              {/* KPI breakdown */}
              {monitorTab === "kpis" && (
                <div className="border rounded-lg p-4 bg-card">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-3">KPI Anomaly Breakdown</h3>
                  {kpiChartData.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No per-KPI data available.</p>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={kpiChartData} margin={{ left: -10 }}>
                          <XAxis dataKey="name" tick={{ fontSize: 8 }} />
                          <YAxis tick={{ fontSize: 9 }} />
                          <Tooltip />
                          <Bar dataKey="anomalies" name="Anomaly Count" fill="#ef4444" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>

                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b bg-muted/30">
                            {["KPI", "Anomalies", "Total Rows", "Rate"].map(h => (
                              <th key={h} className="text-left px-2 py-2 text-muted-foreground font-medium">{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {Object.entries(kpiStats as Record<string, any>).map(([kpi, s]: [string, any]) => {
                              const count = s.anomalyCount ?? s.total_anomalies ?? 0;
                              const total = s.totalRows ?? s.total_rows ?? 0;
                              const rate  = total > 0 ? ((count / total) * 100).toFixed(1) : "—";
                              return (
                                <tr key={kpi} className="border-b hover:bg-muted/10">
                                  <td className="px-2 py-1.5 font-medium">{kpi}</td>
                                  <td className="px-2 py-1.5 font-mono text-amber-600">{count}</td>
                                  <td className="px-2 py-1.5 font-mono">{total.toLocaleString()}</td>
                                  <td className="px-2 py-1.5">
                                    <Badge className={`text-[9px] ${parseFloat(rate) > 20 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                                      {rate !== "—" ? `${rate}%` : "—"}
                                    </Badge>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="border rounded-lg p-12 bg-card text-center text-muted-foreground text-sm">
              No models available. Train a model in the Experiments tab first.
            </div>
          )}
        </div>
      </div>
    </OrionLayout>
  );
}
