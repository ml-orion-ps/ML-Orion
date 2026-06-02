import { useQuery } from "@tanstack/react-query";
import { OrionLayout, KpiCard, OrionNav } from "@/components/orion-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { useState } from "react";
import { TrendingUp, TrendingDown, Target, BarChart2 } from "lucide-react";

const PROMO_COLORS = ["#FFD822","#3b82f6","#a78bfa","#f97316","#22c55e","#ec4899","#14b8a6","#f43f5e","#84cc16","#06b6d4","#8b5cf6","#fb923c","#34d399","#60a5fa","#c084fc"];

function getPromoData(m: any) {
  const summary = (m.modelWeights?.summary) || {};
  const metrics = summary.metrics || {};
  return {
    r2:           metrics.r2 as number | undefined,
    rmse:         metrics.rmse as number | undefined,
    mae:          metrics.mae as number | undefined,
    rowCount:     summary.rowCount as number | undefined,
    promoColumns: (summary.promoColumnsUsed || []) as string[],
    promoSummary: (summary.promoSummary || {}) as Record<string, any>,
    totals:       (summary.totals || {}) as Record<string, any>,
  };
}

export default function OrionOutcomes() {
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  const { data: allModels = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/cpg/promoUplift/models"] });

  const promoModels = [...(allModels as any[])]
    .filter(m => m.modelWeights?.modelType === "promo_uplift" || m.modelWeights?.summary?.promoColumnsUsed)
    .sort((a, b) => new Date(b.trainedAt ?? 0).getTime() - new Date(a.trainedAt ?? 0).getTime());

  const latestModel  = promoModels[0] ?? null;
  const activeModelId = selectedModelId ?? latestModel?.id ?? null;
  const activeModel  = promoModels.find(m => m.id === activeModelId) ?? latestModel;
  const activeData   = activeModel ? getPromoData(activeModel) : null;

  const bestR2 = promoModels.reduce((best, m) => {
    const r2 = getPromoData(m).r2 ?? m.auc ?? 0;
    return r2 > best ? r2 : best;
  }, 0);

  const mechanicChartData = activeData
    ? Object.entries(activeData.promoSummary)
        .map(([name, stats]: [string, any]) => ({
          name,
          totalUplift:  parseFloat((stats.totalUpliftUnits || 0).toFixed(1)),
          avgPctUplift: parseFloat(((stats.avgPctUplift || 0) * 100).toFixed(2)),
          activeRows:   stats.activeRows || 0,
        }))
        .sort((a, b) => b.totalUplift - a.totalUplift)
    : [];

  const bestMechanic  = mechanicChartData[0] ?? null;
  const totalUplift   = mechanicChartData.reduce((s, d) => s + d.totalUplift, 0);

  // Auto-generate strategic recommendations from promo data
  const recommendations: Array<{ title: string; desc: string; type: "invest" | "reduce" | "monitor"; impact: string }> = [];
  if (activeData && mechanicChartData.length > 0) {
    mechanicChartData.slice(0, 3).forEach(m => {
      recommendations.push({
        title:  `Increase ${m.name} investment`,
        desc:   `${m.name} drives ${m.totalUplift.toFixed(1)} uplift units (${m.avgPctUplift >= 0 ? "+" : ""}${m.avgPctUplift.toFixed(2)}% avg across ${m.activeRows.toLocaleString()} active rows)`,
        type:   "invest",
        impact: `+${m.totalUplift.toFixed(0)} units`,
      });
    });
    mechanicChartData.slice(-3).filter(m => m.avgPctUplift < 1).forEach(m => {
      recommendations.push({
        title:  `Review ${m.name} strategy`,
        desc:   `${m.name} shows only ${m.avgPctUplift.toFixed(2)}% avg uplift — consider reallocating budget to higher-performing mechanics`,
        type:   "reduce",
        impact: "Cost saving",
      });
    });
    if (activeData.r2 !== undefined && activeData.r2 < 0.5) {
      recommendations.push({
        title:  "Improve model quality",
        desc:   `Current R² is ${(activeData.r2 * 100).toFixed(1)}% — try a different algorithm or add more explanatory features`,
        type:   "monitor",
        impact: "Better predictions",
      });
    }
  }

  return (
    <OrionLayout title="Outcomes & Recommendations" subtitle="Promo uplift results and strategic recommendations" isLoading={isLoading}>
      <div className="mb-4">
        <OrionNav current="/cpg/promo-uplift/orion/outcomes" basePath="/cpg/promo-uplift/orion" />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Models Trained" value={promoModels.length} />
        <KpiCard
          label="Best R²"
          value={bestR2 > 0 ? bestR2.toFixed(3) : "—"}
          color={bestR2 >= 0.7 ? "green" : bestR2 >= 0.4 ? "amber" : "default"}
        />
        <KpiCard label="Best Mechanic" value={bestMechanic?.name ?? "—"} color="green" />
        <KpiCard label="Total Uplift Units" value={totalUplift > 0 ? totalUplift.toFixed(0) : "—"} trend="up" />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview" data-testid="tab-outcomes-overview">Uplift Analysis</TabsTrigger>
          <TabsTrigger value="recommendations" data-testid="tab-outcomes-recommendations">Recommendations</TabsTrigger>
          <TabsTrigger value="models" data-testid="tab-outcomes-models">Model Comparison</TabsTrigger>
        </TabsList>

        {/* ── UPLIFT ANALYSIS ── */}
        <TabsContent value="overview">
          {/* model selector */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-muted-foreground">Viewing model:</span>
            <select
              className="text-xs border rounded px-2 py-1 bg-background"
              value={activeModelId ?? ""}
              onChange={e => setSelectedModelId(e.target.value ? Number(e.target.value) : null)}
            >
              {promoModels.map((m: any) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {mechanicChartData.length === 0 ? (
            <div className="border rounded-lg p-8 text-center text-muted-foreground text-sm bg-card">
              No promo uplift results yet. Run an experiment from the Experiments page.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="border rounded-lg p-4 bg-card">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary" />Total Uplift Units by Mechanic
                  </h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={mechanicChartData} margin={{ left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="totalUplift" name="Total Uplift Units" radius={[2, 2, 0, 0]}>
                        {mechanicChartData.map((_, i) => (
                          <Cell key={i} fill={PROMO_COLORS[i % PROMO_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="border rounded-lg p-4 bg-card">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-blue-500" />Avg % Uplift by Mechanic
                  </h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={mechanicChartData} margin={{ left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 10 }} unit="%" />
                      <Tooltip formatter={(v: any) => `${v}%`} />
                      <Bar dataKey="avgPctUplift" name="Avg % Uplift" radius={[2, 2, 0, 0]}>
                        {mechanicChartData.map((_, i) => (
                          <Cell key={i} fill={PROMO_COLORS[i % PROMO_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Mechanic performance table */}
              <div className="border rounded-lg bg-card overflow-hidden">
                <div className="px-4 py-3 border-b">
                  <h3 className="text-sm font-semibold">Mechanic Performance Detail</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30">
                      <tr>
                        {["Rank", "Mechanic", "Active Rows", "Total Uplift Units", "Avg % Uplift", "Relative Performance"].map(h => (
                          <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mechanicChartData.map((row, i) => {
                        const maxUplift = mechanicChartData[0]?.totalUplift || 1;
                        const pct = Math.max(0, (row.totalUplift / maxUplift) * 100);
                        return (
                          <tr key={row.name} className="border-t hover:bg-muted/10">
                            <td className="px-3 py-2 font-bold text-muted-foreground">#{i + 1}</td>
                            <td className="px-3 py-2 font-medium">{row.name}</td>
                            <td className="px-3 py-2">{row.activeRows.toLocaleString()}</td>
                            <td className="px-3 py-2 font-mono font-bold text-primary">{row.totalUplift.toFixed(1)}</td>
                            <td className="px-3 py-2 font-mono">
                              {row.avgPctUplift >= 0 ? "+" : ""}{row.avgPctUplift.toFixed(2)}%
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-24 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full"
                                    style={{ width: `${pct}%`, backgroundColor: PROMO_COLORS[i % PROMO_COLORS.length] }}
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground">{pct.toFixed(0)}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── RECOMMENDATIONS ── */}
        <TabsContent value="recommendations">
          {recommendations.length === 0 ? (
            <div className="border rounded-lg p-8 text-center text-muted-foreground text-sm bg-card">
              No recommendations yet. Run a promo uplift analysis first.
            </div>
          ) : (
            <div className="space-y-3">
              {recommendations.map((rec, i) => (
                <div
                  key={i}
                  className={`border rounded-lg p-4 bg-card flex items-start gap-3 ${
                    rec.type === "invest"  ? "border-l-4 border-l-emerald-500" :
                    rec.type === "reduce"  ? "border-l-4 border-l-amber-500"  :
                                            "border-l-4 border-l-blue-500"
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {rec.type === "invest"  ? <TrendingUp   className="w-4 h-4 text-emerald-500" /> :
                     rec.type === "reduce"  ? <TrendingDown  className="w-4 h-4 text-amber-500"  /> :
                                              <Target        className="w-4 h-4 text-blue-500"   />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-sm font-semibold">{rec.title}</p>
                      <Badge
                        className={
                          rec.type === "invest" ? "bg-emerald-100 text-emerald-700" :
                          rec.type === "reduce" ? "bg-amber-100 text-amber-700"   :
                                                  "bg-blue-100 text-blue-700"
                        }
                      >
                        {rec.impact}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{rec.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── MODEL COMPARISON ── */}
        <TabsContent value="models">
          <div className="border rounded-lg bg-card overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-semibold">Model Comparison</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">All trained promo uplift models sorted by training date</p>
            </div>
            {promoModels.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs">
                No models trained yet.{" "}
                <a href="/cpg/promo-uplift/orion/experiments" className="text-primary underline">Go to Experiments →</a>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      {["Model", "Algorithm", "R²", "RMSE", "MAE", "Promo Cols", "Status", "Trained"].map(h => (
                        <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {promoModels.map(m => {
                      const d = getPromoData(m);
                      const r2val = d.r2 ?? m.auc;
                      return (
                        <tr key={m.id} className="border-t hover:bg-muted/10">
                          <td className="px-3 py-2 font-medium max-w-[200px] truncate" title={m.name}>{m.name}</td>
                          <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
                          <td className="px-3 py-2 font-mono font-bold text-primary">
                            {r2val != null ? (r2val * 100).toFixed(1) + "%" : "—"}
                          </td>
                          <td className="px-3 py-2 font-mono">{d.rmse != null ? d.rmse.toFixed(4) : "—"}</td>
                          <td className="px-3 py-2 font-mono">{d.mae  != null ? d.mae.toFixed(4)  : "—"}</td>
                          <td className="px-3 py-2">{d.promoColumns.length}</td>
                          <td className="px-3 py-2">
                            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${m.isDeployed ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
                              {m.isDeployed ? "Production" : m.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {m.trainedAt ? new Date(m.trainedAt).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </OrionLayout>
  );
}
