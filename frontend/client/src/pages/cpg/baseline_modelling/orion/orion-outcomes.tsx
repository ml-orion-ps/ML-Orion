import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

const OUTCOME_COLORS = { retained: "#22c55e", churned: "#ef4444", downgraded: "#f59e0b", pending: "#94a3b8" };

const CPG_BASE = "/cpg/baseline-modelling/orion";

export default function OrionOutcomes() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  const { data: retention, isLoading } = useQuery<any>({ queryKey: ["/api/cpg/analytics/retention"] });
  const { data: models = [] } = useQuery<any[]>({
    queryKey: ["/api/cpg/models"],
    onSuccess: (data: any[]) => {
      if (data.length > 0 && selectedModelId === null) {
        const latest = [...data].sort((a, b) => new Date(b.trainedAt).getTime() - new Date(a.trainedAt).getTime())[0];
        setSelectedModelId(latest.id);
      }
    },
  } as any);

  const latestModelId = (models as any[]).length > 0
    ? [...(models as any[])].sort((a, b) => new Date(b.trainedAt).getTime() - new Date(a.trainedAt).getTime())[0].id
    : null;
  const activeModelId = selectedModelId ?? latestModelId;

  const predQueryKey = activeModelId
    ? [`/api/cpg/predictions`, { modelId: activeModelId }]
    : ["/api/cpg/predictions"];

  const { data: allPreds = [] } = useQuery<any[]>({
    queryKey: predQueryKey,
    queryFn: () => activeModelId
      ? fetch(`/api/cpg/predictions?modelId=${activeModelId}`).then(r => r.json())
      : fetch("/api/cpg/predictions").then(r => r.json()),
  });

  const updateRecMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/cpg/recommendations/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/cpg/analytics/retention"] }); toast({ title: "Updated" }); },
  });

  const tracker = retention?.tracker || {};
  const recs = retention?.recommendedActions || [];
  const queue = retention?.queue || { pending: [], inProgress: [], completed: [], declined: [] };

  const completed = queue.completed || [];
  const outcomeCounts = { retained: 0, churned: 0, downgraded: 0 };
  completed.forEach((r: any) => { if (r.outcome && outcomeCounts.hasOwnProperty(r.outcome)) (outcomeCounts as any)[r.outcome]++; });
  const outcomePie = Object.entries(outcomeCounts).filter(([, v]) => v > 0).map(([k, v]) => ({ name: k.charAt(0).toUpperCase() + k.slice(1), value: v, color: (OUTCOME_COLORS as any)[k] }));

  const actionTypeCounts: Record<string, { total: number; saved: number }> = {};
  recs.forEach((r: any) => {
    const t = r.actionType || "Unknown";
    if (!actionTypeCounts[t]) actionTypeCounts[t] = { total: 0, saved: 0 };
    actionTypeCounts[t].total++;
    if (r.outcome === "retained") actionTypeCounts[t].saved++;
  });
  const actionData = Object.entries(actionTypeCounts).map(([name, d]) => ({
    name, total: d.total, saved: d.saved, rate: d.total > 0 ? parseFloat(((d.saved / d.total) * 100).toFixed(1)) : 0,
  })).sort((a, b) => b.total - a.total).slice(0, 8);

  const monthlyRevenue: Record<string, number> = {};
  completed.forEach((r: any) => {
    if (r.executedAt && r.outcome === "retained" && r.estimatedImpact) {
      const m = new Date(r.executedAt).toISOString().slice(0, 7);
      monthlyRevenue[m] = (monthlyRevenue[m] || 0) + r.estimatedImpact;
    }
  });
  const revenueTimeline = Object.entries(monthlyRevenue).sort().map(([month, revenue]) => ({ month, revenue: Math.round(revenue) }));

  const predByModel: Record<number, number> = {};
  (allPreds as any[]).forEach((p: any) => { predByModel[p.modelId] = (predByModel[p.modelId] || 0) + 1; });

  // Build per-model scoring summary from models table (baseline metrics)
  const modelScoringRows = (models as any[]).map((m: any) => ({
    ...m,
    scoreCount: predByModel[m.id] || 0,
  }));

  return (
    <OrionLayout title="Outcomes & Scoring" subtitle="Baseline scoring results and model action outcomes" isLoading={isLoading}>
      <div className="mb-4"><OrionNav current={`${CPG_BASE}/outcomes`} basePath={CPG_BASE} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Actions Triggered" value={tracker.actionsTriggered ?? "—"} />
        <KpiCard label="Actions Completed" value={tracker.actionsExecuted ?? "—"} />
        <KpiCard label="Success Rate" value={tracker.saveSuccessRate != null ? `${tracker.saveSuccessRate}%` : "—"} trend="up" />
        <KpiCard label="Revenue Impact" value={tracker.totalImpactGenerated != null ? `$${(tracker.totalImpactGenerated / 1000).toFixed(0)}K` : "—"} trend="up" />
        <KpiCard label="Cost Spent" value={tracker.totalCostSpent != null ? `$${(tracker.totalCostSpent / 1000).toFixed(1)}K` : "—"} />
        <KpiCard label="ROI" value={tracker.totalCostSpent > 0 ? `${((tracker.totalImpactGenerated / tracker.totalCostSpent)).toFixed(1)}×` : "—"} trend="up" />
        <KpiCard label="In Progress" value={(queue.inProgress || []).length} />
        <KpiCard label="Pending Review" value={(queue.pending || []).length} />
      </div>

      <Tabs defaultValue="scoring">
        <TabsList className="mb-4">
          <TabsTrigger value="scoring" data-testid="tab-outcomes-scoring">Scoring Results</TabsTrigger>
          <TabsTrigger value="actions" data-testid="tab-outcomes-actions">Action Queue</TabsTrigger>
          <TabsTrigger value="predictions" data-testid="tab-outcomes-predictions">Forecast Runs</TabsTrigger>
        </TabsList>

        <TabsContent value="scoring">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <div className="border rounded-lg p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3">Outcome Distribution</h3>
              {outcomePie.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No completed actions yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={outcomePie} dataKey="value" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                      {outcomePie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="border rounded-lg p-4 bg-card col-span-2">
              <h3 className="text-sm font-semibold mb-3">Action Type Performance</h3>
              {actionData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No action data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={actionData} margin={{ left: -10 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                    <Tooltip formatter={(v: any) => `${v}%`} />
                    <Bar dataKey="rate" name="Success Rate %" fill="#10b981" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {revenueTimeline.length > 0 && (
            <div className="border rounded-lg p-4 bg-card mb-4">
              <h3 className="text-sm font-semibold mb-3">Revenue Impact Timeline</h3>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={revenueTimeline} margin={{ left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: any) => `$${v.toLocaleString()}`} />
                  <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} dot={false} name="Revenue Impact" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Baseline model scoring summary */}
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-3">Baseline Model Scoring Summary</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {["Model", "Algorithm", "R²", "WMAPE", "MAE", "Baseline Units", "Promo Effect", "Status"].map(h => (
                      <th key={h} className="text-left p-3 font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {modelScoringRows.length === 0 && (
                    <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No baseline runs yet.</td></tr>
                  )}
                  {modelScoringRows.map((m: any) => (
                    <tr key={m.id} className="border-t">
                      <td className="p-3 font-medium max-w-[180px] truncate">{m.name}</td>
                      <td className="p-3 text-muted-foreground">{m.algorithm}</td>
                      <td className="p-3 font-mono font-bold text-blue-600">{m.r2 != null ? m.r2.toFixed(3) : "—"}</td>
                      <td className="p-3 font-mono">{m.wmape != null ? `${(m.wmape * 100).toFixed(1)}%` : "—"}</td>
                      <td className="p-3 font-mono">{m.mae != null ? m.mae.toFixed(2) : "—"}</td>
                      <td className="p-3 font-mono">{m.baselineUnits != null ? m.baselineUnits.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</td>
                      <td className="p-3 font-mono">{m.promoEffectUnits != null ? m.promoEffectUnits.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</td>
                      <td className="p-3"><StatusBadge status={m.isDeployed ? "Production" : m.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="actions">
          <div className="space-y-4">
            {["inProgress", "pending", "completed", "declined"].map(status => {
              const statusRecs = (queue[status] || []) as any[];
              const label = { inProgress: "In Progress", pending: "Pending", completed: "Completed", declined: "Declined" }[status];
              return (
                <div key={status} className="border rounded-lg bg-card">
                  <div className="p-3 border-b flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{label}</h3>
                    <Badge variant="outline">{statusRecs.length}</Badge>
                  </div>
                  {statusRecs.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-4">None</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            {["Customer", "Action", "Priority", "Impact", "Cost", "Outcome", ...(status === "pending" ? ["Actions"] : [])].map(h => (
                              <th key={h} className="text-left p-3 font-medium text-muted-foreground">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {statusRecs.slice(0, 20).map((r: any) => (
                            <tr key={r.id} className="border-t hover:bg-muted/20" data-testid={`row-rec-${r.id}`}>
                              <td className="p-3 font-medium">{r.customerName || `#${r.customerId}`}</td>
                              <td className="p-3">{r.actionType?.replace(/_/g, " ")}</td>
                              <td className="p-3">
                                <Badge className={r.priority === "high" ? "bg-red-100 text-red-700" : r.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}>
                                  {r.priority}
                                </Badge>
                              </td>
                              <td className="p-3">{r.estimatedImpact ? `$${r.estimatedImpact.toFixed(0)}` : "—"}</td>
                              <td className="p-3">{r.estimatedCost ? `$${r.estimatedCost.toFixed(0)}` : "—"}</td>
                              <td className="p-3">
                                {r.outcome
                                  ? <Badge style={{ backgroundColor: `${(OUTCOME_COLORS as any)[r.outcome]}20`, color: (OUTCOME_COLORS as any)[r.outcome] }}>{r.outcome}</Badge>
                                  : <span className="text-muted-foreground">—</span>}
                              </td>
                              {status === "pending" && (
                                <td className="p-3">
                                  <div className="flex gap-1">
                                    <Button size="sm" className="h-5 text-[10px]" onClick={() => updateRecMut.mutate({ id: r.id, data: { status: "in_progress" } })}>Start</Button>
                                    <Button size="sm" variant="outline" className="h-5 text-[10px]" onClick={() => updateRecMut.mutate({ id: r.id, data: { status: "declined" } })}>Decline</Button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="predictions">
          <div className="border rounded-lg bg-card">
            <div className="p-4 border-b">
              <h3 className="text-sm font-semibold">Model Attribution</h3>
              <p className="text-xs text-muted-foreground mt-1">Scoring runs per deployed baseline model</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {["Model", "Algorithm", "Status", "Rows Scored", "R²", "WMAPE", "Promo Effect Units"].map(h => (
                      <th key={h} className="text-left p-3 font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(models as any[]).length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No models trained yet.</td></tr>}
                  {(models as any[]).map((m: any) => (
                    <tr key={m.id} className="border-t">
                      <td className="p-3 font-medium max-w-[200px] truncate">{m.name}</td>
                      <td className="p-3">{m.algorithm}</td>
                      <td className="p-3"><StatusBadge status={m.isDeployed ? "Production" : m.status} /></td>
                      <td className="p-3 font-mono">{m.rowCount?.toLocaleString() ?? "—"}</td>
                      <td className="p-3 font-mono font-bold text-blue-600">{m.r2 != null ? m.r2.toFixed(3) : "—"}</td>
                      <td className="p-3 font-mono">{m.wmape != null ? `${(m.wmape * 100).toFixed(1)}%` : "—"}</td>
                      <td className="p-3 font-mono">{m.promoEffectUnits != null ? m.promoEffectUnits.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border rounded-lg bg-card mt-4">
            <div className="p-4 border-b flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-semibold">Forecast Runs</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(allPreds as any[]).length > 0
                    ? `${(allPreds as any[]).length} scoring records`
                    : "No scoring records yet — deploy a model and run scoring"}
                </p>
              </div>
              <select
                className="text-xs border rounded px-2 py-1 bg-background"
                value={activeModelId ?? ""}
                onChange={e => setSelectedModelId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">All models</option>
                {(models as any[]).map((m: any) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {["account_number", "forecast_band", "baseline_score", "recommended_action"].map(h => (
                      <th key={h} className="text-left p-3 font-medium text-muted-foreground font-mono">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(allPreds as any[]).map((p: any) => {
                    const rc = (p.riskCategory ?? "").toLowerCase();
                    const bandLabel = rc === "very high" ? "High Deviation" : rc === "high" ? "Above Baseline" : rc === "medium" ? "Near Baseline" : "On Target";
                    const bandClass = rc === "very high" ? "bg-red-200 text-red-900" : rc === "high" ? "bg-red-100 text-red-700" : rc === "medium" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700";
                    return (
                      <tr key={p.id} className="border-t hover:bg-muted/20">
                        <td className="p-3 font-mono">{p.accountNumber}</td>
                        <td className="p-3"><Badge className={bandClass}>{bandLabel}</Badge></td>
                        <td className="p-3 font-mono">{(p.churnProbability * 100).toFixed(2)}%</td>
                        <td className="p-3 text-muted-foreground max-w-[320px] whitespace-normal">{p.recommendedAction || "—"}</td>
                      </tr>
                    );
                  })}
                  {(allPreds as any[]).length === 0 && (
                    <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No scoring records yet. Deploy a model and run a scoring pass.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </OrionLayout>
  );
}
