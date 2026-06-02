import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { OrionLayout, KpiCard, OrionNav } from "@/components/orion-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, LineChart, Line,
} from "recharts";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Activity } from "lucide-react";

const KPI_COLORS = ["#ef4444","#f59e0b","#3b82f6","#8b5cf6","#10b981","#ec4899","#14b8a6","#f43f5e","#84cc16","#06b6d4"];

// ── Helpers ────────────────────────────────────────────────────────────────────

function getAnomalyData(m: any) {
  const weights  = m.modelWeights || {};
  const summary  = (typeof weights === "object" && weights.summary) ? weights.summary : {};
  const kpiStats = summary.kpiStats || {};
  return {
    totalAnomalies: (summary.totalAnomalies ?? 0) as number,
    totalRows:      (summary.totalRows ?? 0)      as number,
    kpisProcessed:  (summary.kpisProcessed || []) as string[],
    kpiStats,
  };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function OrionOutcomes() {
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  const { data: allModels = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/retail/kpiAnomaly/models"] });

  const anomalyModels = [...(allModels as any[])]
    .filter(m => m.modelWeights?.modelType === "kpi_anomaly")
    .sort((a, b) => new Date(b.trainedAt ?? 0).getTime() - new Date(a.trainedAt ?? 0).getTime());

  const latestModel   = anomalyModels[0] ?? null;
  const activeModelId = selectedModelId ?? latestModel?.id ?? null;
  const activeModel   = anomalyModels.find(m => m.id === activeModelId) ?? latestModel;
  const activeData    = activeModel ? getAnomalyData(activeModel) : null;

  // Aggregate stats across all models
  const totalAnomaliesAll = anomalyModels.reduce((s, m) => s + getAnomalyData(m).totalAnomalies, 0);
  const totalRowsAll      = anomalyModels.reduce((s, m) => s + getAnomalyData(m).totalRows, 0);
  const overallRate       = totalRowsAll > 0 ? ((totalAnomaliesAll / totalRowsAll) * 100).toFixed(1) : null;

  // Per-KPI breakdown for active model
  // Backend kpiStats shape: { totalAnomalies, totalRows, anomalyRate, avgScore, window1, window2 }
  const kpiBreakdown = activeData
    ? Object.entries(activeData.kpiStats as Record<string, any>)
        .map(([name, s]: [string, any]) => {
          const anomalies = (s.totalAnomalies ?? s.anomalyCount ?? s.total_anomalies ?? 0) as number;
          const total     = (s.totalRows     ?? s.total_rows    ?? 0) as number;
          const rate      = typeof s.anomalyRate === "number"
            ? parseFloat(s.anomalyRate.toFixed(1))
            : total > 0 ? parseFloat((anomalies / total * 100).toFixed(1)) : 0;
          return { name, anomalies, total, rate };
        })
        .sort((a, b) => b.anomalies - a.anomalies)
    : [];

  // Model performance timeline
  const modelTimeline = [...anomalyModels].reverse().map(m => {
    const d    = getAnomalyData(m);
    const rate = d.totalRows > 0 ? parseFloat((d.totalAnomalies / d.totalRows * 100).toFixed(1)) : 0;
    return {
      name:      (m.name || "").slice(0, 18),
      anomalies: d.totalAnomalies,
      rate,
      kpis:      d.kpisProcessed.length,
    };
  });

  // Auto-generate insights from active model
  const insights: Array<{ title: string; desc: string; type: "alert" | "ok" | "info" }> = [];
  if (activeData && kpiBreakdown.length > 0) {
    const worst = kpiBreakdown[0];
    if (worst.rate > 20) {
      insights.push({
        title: `High anomaly rate in ${worst.name}`,
        desc:  `${worst.rate.toFixed(1)}% of rows flagged as anomalies (${worst.anomalies} of ${worst.total.toLocaleString()}) — review data quality or thresholds`,
        type:  "alert",
      });
    }
    kpiBreakdown.filter(k => k.rate < 5 && k.anomalies > 0).slice(0, 2).forEach(k => {
      insights.push({
        title: `${k.name} within healthy range`,
        desc:  `Only ${k.rate.toFixed(1)}% anomaly rate — this KPI is performing normally`,
        type:  "ok",
      });
    });
    if (activeData.kpisProcessed.length > 5) {
      insights.push({
        title: "Broad KPI coverage",
        desc:  `${activeData.kpisProcessed.length} KPIs monitored in this run — good coverage for comprehensive anomaly detection`,
        type:  "info",
      });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <OrionLayout title="Outcomes & Insights" subtitle="KPI anomaly detection results — per-KPI breakdown and model attribution" isLoading={isLoading}>
      <div className="mb-4"><OrionNav current="/retail/kpi-anomaly/orion/outcomes" basePath="/retail/kpi-anomaly/orion" /></div>

      {/* Top KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Total Experiments"  value={anomalyModels.length} />
        <KpiCard label="Total Anomalies"    value={totalAnomaliesAll > 0 ? totalAnomaliesAll.toLocaleString() : "—"} color="amber" />
        <KpiCard label="Overall Anomaly Rate" value={overallRate ? `${overallRate}%` : "—"} color={overallRate && parseFloat(overallRate) > 20 ? "amber" : "green"} />
        <KpiCard label="KPIs Active"        value={activeData?.kpisProcessed.length ?? "—"} color="blue" trend="up" />
        <KpiCard label="Rows Scored"        value={totalRowsAll > 0 ? totalRowsAll.toLocaleString() : "—"} />
        <KpiCard label="Active Model Anomalies" value={activeData?.totalAnomalies?.toLocaleString() ?? "—"} color="amber" />
        <KpiCard label="Active Model Rows"  value={activeData?.totalRows?.toLocaleString() ?? "—"} />
        <KpiCard label="Model Run Rate"     value={activeData?.totalRows ? `${((activeData.totalAnomalies / activeData.totalRows) * 100).toFixed(1)}%` : "—"} />
      </div>

      <Tabs defaultValue="kpi-breakdown">
        <TabsList className="mb-4">
          <TabsTrigger value="kpi-breakdown"  data-testid="tab-outcomes-kpis">KPI Breakdown</TabsTrigger>
          <TabsTrigger value="timeline"       data-testid="tab-outcomes-timeline">Model Timeline</TabsTrigger>
          <TabsTrigger value="insights"       data-testid="tab-outcomes-insights">Insights</TabsTrigger>
          <TabsTrigger value="models"         data-testid="tab-outcomes-models">Model Attribution</TabsTrigger>
        </TabsList>

        {/* ── KPI BREAKDOWN ── */}
        <TabsContent value="kpi-breakdown">
          {/* Model selector */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span className="text-xs text-muted-foreground">View model:</span>
            <select
              className="border rounded px-3 py-1.5 text-xs bg-background"
              value={activeModelId ?? ""}
              onChange={e => setSelectedModelId(Number(e.target.value))}
            >
              {anomalyModels.map(m => (
                <option key={m.id} value={m.id}>{m.name} {m.isDeployed ? "(live)" : ""}</option>
              ))}
            </select>
          </div>

          {kpiBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No KPI data available. Run an experiment first.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <div className="border rounded-lg p-4 bg-card">
                  <h3 className="text-sm font-semibold mb-3">Anomaly Count per KPI</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={kpiBreakdown} margin={{ left: -10 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 8 }} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip />
                      <Bar dataKey="anomalies" name="Anomaly Count" radius={[2, 2, 0, 0]}>
                        {kpiBreakdown.map((_, i) => <Cell key={i} fill={KPI_COLORS[i % KPI_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="border rounded-lg p-4 bg-card">
                  <h3 className="text-sm font-semibold mb-3">Anomaly Rate per KPI (%)</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={kpiBreakdown} margin={{ left: -10 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 8 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} unit="%" />
                      <Tooltip formatter={(v: any) => `${v}%`} />
                      <Bar dataKey="rate" name="Rate %" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="border rounded-lg bg-card overflow-hidden">
                <div className="px-4 py-3 border-b">
                  <h3 className="text-sm font-semibold">Per-KPI Detail</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>{["KPI", "Anomalies", "Total Rows", "Anomaly Rate", "Status"].map(h => (
                        <th key={h} className="text-left p-3 font-medium text-muted-foreground">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {kpiBreakdown.map((k, i) => (
                        <tr key={k.name} className="border-t hover:bg-muted/20">
                          <td className="p-3 font-medium flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: KPI_COLORS[i % KPI_COLORS.length] }} />
                            {k.name}
                          </td>
                          <td className="p-3 font-mono text-amber-600 font-bold">{k.anomalies.toLocaleString()}</td>
                          <td className="p-3 font-mono">{k.total.toLocaleString()}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(k.rate, 100)}%`, backgroundColor: k.rate > 20 ? "#f59e0b" : "#10b981" }} />
                              </div>
                              <span className="font-mono">{k.rate.toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="p-3">
                            <Badge className={k.rate > 20 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}>
                              {k.rate > 20 ? "High" : "Normal"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── MODEL TIMELINE ── */}
        <TabsContent value="timeline">
          {modelTimeline.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No experiments yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <div className="border rounded-lg p-4 bg-card">
                  <h3 className="text-sm font-semibold mb-3">Total Anomalies per Run</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={modelTimeline} margin={{ left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fontSize: 8 }} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip />
                      <Bar dataKey="anomalies" name="Total Anomalies" fill="#ef4444" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="border rounded-lg p-4 bg-card">
                  <h3 className="text-sm font-semibold mb-3">Anomaly Rate Trend</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={modelTimeline} margin={{ left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fontSize: 8 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} unit="%" />
                      <Tooltip formatter={(v: any) => `${v}%`} />
                      <Line type="monotone" dataKey="rate" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="Anomaly Rate" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── INSIGHTS ── */}
        <TabsContent value="insights">
          <div className="space-y-3">
            {insights.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">Run an experiment to generate insights.</p>
            ) : (
              insights.map((ins, i) => (
                <div key={i} className="border rounded-lg p-4 bg-card flex gap-3">
                  <div className="shrink-0 mt-0.5">
                    {ins.type === "alert" ? (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    ) : ins.type === "ok" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Activity className="w-4 h-4 text-blue-500" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{ins.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{ins.desc}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        {/* ── MODEL ATTRIBUTION ── */}
        <TabsContent value="models">
          <div className="border rounded-lg bg-card">
            <div className="p-4 border-b">
              <h3 className="text-sm font-semibold">Model Attribution</h3>
              <p className="text-xs text-muted-foreground mt-1">Detection statistics per model run</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>{["Model", "Algorithm", "Status", "Anomalies", "Rows Scored", "Anomaly Rate", "KPIs"].map(h => (
                    <th key={h} className="text-left p-3 font-medium text-muted-foreground">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {anomalyModels.length === 0 && (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No models trained yet.</td></tr>
                  )}
                  {anomalyModels.map(m => {
                    const d    = getAnomalyData(m);
                    const rate = d.totalRows > 0 ? ((d.totalAnomalies / d.totalRows) * 100).toFixed(1) : null;
                    return (
                      <tr key={m.id} className="border-t hover:bg-muted/20">
                        <td className="p-3 font-medium max-w-[180px] truncate">{m.name}</td>
                        <td className="p-3 text-muted-foreground">{m.algorithm}</td>
                        <td className="p-3">
                          <Badge className={m.isDeployed ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}>
                            {m.isDeployed ? "Live" : m.status}
                          </Badge>
                        </td>
                        <td className="p-3 font-mono text-amber-600 font-bold">{d.totalAnomalies.toLocaleString()}</td>
                        <td className="p-3 font-mono">{d.totalRows.toLocaleString()}</td>
                        <td className="p-3">
                          {rate ? (
                            <div className="flex items-center gap-1">
                              {parseFloat(rate) > 20
                                ? <TrendingUp className="w-3 h-3 text-amber-500" />
                                : <TrendingDown className="w-3 h-3 text-emerald-500" />}
                              <span className={`font-mono ${parseFloat(rate) > 20 ? "text-amber-600" : "text-emerald-600"}`}>{rate}%</span>
                            </div>
                          ) : "—"}
                        </td>
                        <td className="p-3 font-mono">{d.kpisProcessed.length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </OrionLayout>
  );
}
