import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { OrionLayout, KpiCard, OrionNav } from "@/components/orion-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";


export default function OrionOutcomes() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: overview, isLoading } = useQuery<any>({ queryKey: ["/api/retail/demand_forecast/orion/overview"] });
  const { data: outcomeAnalysis } = useQuery<any>({ queryKey: ["/api/retail/demand_forecast/orion/outcome-analysis"] });
  const { data: modelRuns = [] } = useQuery<any[]>({ queryKey: ["/api/retail/demand_forecast/orion/model-runs"] });
  const { data: skuForecasts } = useQuery<any>({ queryKey: ["/api/retail/demand_forecast/orion/sku-forecasts"] });

  const deployMut = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "deploy" | "demote" }) =>
      apiRequest("PATCH", `/api/retail/demand_forecast/orion/model-runs/${id}/${action}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/retail/demand_forecast/orion/model-runs"] });
      qc.invalidateQueries({ queryKey: ["/api/retail/demand_forecast/orion/overview"] });
      toast({ title: "Updated" });
    },
  });

  return (
    <OrionLayout title="Outcomes & Recommendations" subtitle="Demand forecast model results, run history, and SKU-level accuracy" isLoading={isLoading}>
      <div className="mb-4"><OrionNav current="/retail/demand_forecast/orion/outcomes" basePath="/retail/demand_forecast/orion" /></div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <KpiCard label="Total Models" value={overview?.kpis?.totalModels ?? "—"} />
        <KpiCard label="Deployed Models" value={overview?.kpis?.deployedModels ?? "—"} />
        <KpiCard label="Avg WMAPE (Deployed)" value={overview?.kpis?.avgWmape != null ? `${overview.kpis.avgWmape.toFixed(1)}%` : "—"} />
        <KpiCard label="Rows Scored (Unique)" value={overview?.kpis?.uniqueRowsScored != null ? overview.kpis.uniqueRowsScored.toLocaleString() : "—"} />
        <KpiCard label="Forecasted Units" value={overview?.kpis?.forecastedUnits != null ? overview.kpis.forecastedUnits.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview" data-testid="tab-outcomes-overview">Outcome Analysis</TabsTrigger>
          <TabsTrigger value="actions" data-testid="tab-outcomes-actions">Model Runs</TabsTrigger>
          <TabsTrigger value="predictions" data-testid="tab-outcomes-predictions">ML Predictions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {/* Row 1: Accuracy Distribution donut + WMAPE by Run bars */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <div className="border rounded-lg p-4 bg-card">
              <h3 className="text-sm font-semibold mb-1">Forecast Accuracy Distribution</h3>
              <p className="text-xs text-muted-foreground mb-3">% of store × style combos · latest run · Excellent &lt;10% · Good 10–20% · Fair 20–30% · Poor &gt;30%</p>
              {(outcomeAnalysis?.accuracyDistribution || []).every((d: any) => d.count === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-6">No SKU-level WMAPE data yet. Re-run a forecast to populate.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={outcomeAnalysis?.accuracyDistribution || []} dataKey="count" cx="50%" cy="50%" innerRadius={48} outerRadius={72} labelLine={false}>
                        {(outcomeAnalysis?.accuracyDistribution || []).map((entry: any, i: number) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any, _: any, props: any) => [`${props.payload.pct}% (${v} SKUs)`, props.payload.band]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-3 mt-2">
                    {(outcomeAnalysis?.accuracyDistribution || []).map((d: any) => (
                      <span key={d.band} className="flex items-center gap-1 text-xs">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: d.color }} />
                        {d.band} <span className="font-semibold">{d.pct != null ? `${d.pct}%` : d.count}</span>
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-center text-muted-foreground mt-3">
                    Avg WMAPE: <span className="font-semibold text-foreground">{overview?.kpis?.avgWmape != null ? `${overview.kpis.avgWmape.toFixed(1)}%` : "—"}</span>
                    {" · "}SKUs scored: <span className="font-semibold text-foreground">{outcomeAnalysis?.uniqueCombinations?.toLocaleString() ?? "—"}</span>
                  </p>
                  <p className="text-[11px] text-center text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2 mt-3 leading-snug">
                    Global WMAPE ({overview?.kpis?.avgWmape != null ? `${overview.kpis.avgWmape.toFixed(1)}%` : "—"}) reflects aggregated error — individual SKU accuracy may vary significantly due to sparse demand patterns.
                  </p>
                </>
              )}
            </div>

            <div className="border rounded-lg p-4 bg-card col-span-2">
              <h3 className="text-sm font-semibold mb-1">WMAPE by Run</h3>
              <p className="text-xs text-muted-foreground mb-3">Lower is better · last 10 runs</p>
              {(outcomeAnalysis?.wmapeByRun || []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No model runs yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={outcomeAnalysis?.wmapeByRun || []} margin={{ left: -10 }}>
                    <XAxis dataKey="run" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 10 }} unit="%" />
                    <Tooltip formatter={(v: any) => [`${v}%`, "WMAPE"]} labelFormatter={(l) => `Run: ${l}`} />
                    <Bar dataKey="wmape" name="WMAPE" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Row 2: Algorithm Performance Summary */}
          <div className="border rounded-lg p-4 bg-card mb-4">
            <h3 className="text-sm font-semibold mb-1">Algorithm Performance Summary</h3>
            <p className="text-xs text-muted-foreground mb-3">Avg WMAPE and rows processed grouped by algorithm</p>
            {(outcomeAnalysis?.algorithmPerformance || []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No model runs yet.</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {(outcomeAnalysis?.algorithmPerformance || []).map((a: any) => (
                  <div key={a.algorithm} className="border rounded-lg p-4 min-w-[180px] bg-muted/20">
                    <p className="text-xs text-muted-foreground font-medium mb-2">{a.algorithm}</p>
                    <p className="text-2xl font-bold text-red-500">{a.avgWmape != null ? `${a.avgWmape}%` : "—"}</p>
                    <p className="text-xs text-muted-foreground">avg WMAPE</p>
                    <p className="text-sm font-semibold mt-2">{a.avgRows != null ? a.avgRows.toLocaleString() : "—"}</p>
                    <p className="text-xs text-muted-foreground">avg rows</p>
                    <p className="text-xs text-muted-foreground mt-1">{a.runCount} run{a.runCount !== 1 ? "s" : ""}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Row 3: Actual vs Forecast Units */}
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-1">Actual vs Forecast Units</h3>
            <p className="text-xs text-muted-foreground mb-3">Aggregated totals per model run · last 10 runs</p>
            {(outcomeAnalysis?.actualVsForecast || []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No runs with unit data yet.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={outcomeAnalysis?.actualVsForecast || []} margin={{ left: 0 }}>
                    <XAxis dataKey="run" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
                    <Tooltip formatter={(v: any) => v.toLocaleString()} />
                    <Bar dataKey="actualUnits" name="Actual Units" fill="#10b981" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="forecastUnits" name="Forecast Units" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex justify-center gap-4 mt-2">
                  <span className="flex items-center gap-1 text-xs"><span className="w-2 h-2 rounded-full inline-block bg-[#10b981]" />Actual Units</span>
                  <span className="flex items-center gap-1 text-xs"><span className="w-2 h-2 rounded-full inline-block bg-[#3b82f6]" />Forecast Units</span>
                </div>
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="actions">
          <div className="border rounded-lg bg-card">
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">All Model Runs</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{(modelRuns as any[]).length} run{(modelRuns as any[]).length !== 1 ? "s" : ""} · sorted by training date (newest first)</p>
              </div>
              <Badge variant="outline">{(modelRuns as any[]).length}</Badge>
            </div>
            {(modelRuns as any[]).length === 0 ? (
              <p className="text-sm text-muted-foreground p-6 text-center">No model runs yet. Train a model from the Experiments tab.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {["Run Name", "Algorithm", "WMAPE", "Actual Units", "Forecast Units", "Unique Combos", "Status", "Trained", "Action"].map(h => (
                        <th key={h} className="text-left p-3 font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(modelRuns as any[]).map((r: any) => (
                      <tr key={r.id} className="border-t hover:bg-muted/20">
                        <td className="p-3 font-medium max-w-[200px] truncate" title={r.name}>{r.name}</td>
                        <td className="p-3">{r.algorithm ?? "—"}</td>
                        <td className="p-3 font-mono">{r.wmape != null ? `${r.wmape}%` : "—"}</td>
                        <td className="p-3 font-mono">{r.actualUnits != null ? r.actualUnits.toLocaleString() : "—"}</td>
                        <td className="p-3 font-mono">{r.forecastUnits != null ? r.forecastUnits.toLocaleString() : "—"}</td>
                        <td className="p-3">{r.uniqueCombinations != null ? r.uniqueCombinations.toLocaleString() : "—"}</td>
                        <td className="p-3">
                          <Badge className={r.isDeployed ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}>
                            {r.isDeployed ? "Production" : r.status ?? "trained"}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">{r.trainedAt ? new Date(r.trainedAt).toLocaleDateString("en-GB") : "—"}</td>
                        <td className="p-3">
                          {r.isDeployed ? (
                            <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={deployMut.isPending} onClick={() => deployMut.mutate({ id: r.id, action: "demote" })}>Demote</Button>
                          ) : (
                            <Button size="sm" className="h-6 text-[10px]" disabled={deployMut.isPending} onClick={() => deployMut.mutate({ id: r.id, action: "deploy" })}>Set Production</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="predictions">
          {/* Feature Importance */}
          <div className="border rounded-lg bg-card mb-4">
            <div className="p-4 border-b">
              <h3 className="text-sm font-semibold">Feature Importance</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {skuForecasts?.modelName
                  ? `Latest run \u00b7 ${skuForecasts.algorithm ?? ""} \u00b7 ${skuForecasts.trainedAt ? new Date(skuForecasts.trainedAt).toLocaleDateString("en-GB") : ""}`
                  : "No model run yet"}
              </p>
            </div>
            {!(skuForecasts?.featureImportance?.length) ? (
              <p className="text-sm text-muted-foreground p-6 text-center">
                Feature importance is available for tree-based models (XGBoost, LightGBM). Run a forecast to populate.
              </p>
            ) : (
              <div className="p-4">
                <ResponsiveContainer width="100%" height={Math.max(160, (skuForecasts.featureImportance.length) * 28)}>
                  <BarChart
                    layout="vertical"
                    data={skuForecasts.featureImportance}
                    margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
                  >
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                    <Tooltip formatter={(v: any) => [`${(Number(v) * 100).toFixed(2)}%`, "Importance"]} />
                    <Bar dataKey="importance" fill="#3b82f6" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* SKU-Level Forecast Preview */}
          <div className="border rounded-lg bg-card">
            <div className="p-4 border-b flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold">SKU-Level Forecast Preview</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {skuForecasts?.preview?.length
                    ? `${skuForecasts.preview.length} store \u00d7 style rows from latest training run`
                    : "No forecast rows yet \u2014 train a model to populate"}
                </p>
              </div>
              {!!(skuForecasts?.preview?.length) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => {
                    const rows = skuForecasts.preview as any[];
                    const headers = ["Store", "Style Code", "Week Date", "Actual Units", "Forecast Units", "Variance %"];
                    const csvRows = rows.map((row: any) => {
                      const actual = Number(row.actualUnits ?? 0);
                      const forecast = Number(row.forecastUnits ?? 0);
                      const variance = actual !== 0 ? ((forecast - actual) / Math.abs(actual) * 100).toFixed(1) : "";
                      return [
                        row.store ?? "",
                        row.styleCode ?? "",
                        row.weekDate ?? "",
                        actual,
                        forecast.toFixed(1),
                        variance,
                      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
                    });
                    const csv = [headers.join(","), ...csvRows].join("\n");
                    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `sku_forecast_preview_${skuForecasts.trainedAt ? new Date(skuForecasts.trainedAt).toISOString().slice(0, 10) : "latest"}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  {"\u2193"} Download CSV
                </Button>
              )}
            </div>
            <div className="overflow-x-auto">
              <div className="max-h-[420px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-muted border-b border-border">
                    <tr>
                      {["Store", "Style Code", "Week Date", "Actual Units", "Forecast Units", "Variance %"].map(h => (
                        <th key={h} className="text-left p-3 font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {!(skuForecasts?.preview?.length) && (
                      <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No forecast rows yet. Train a model from the Experiments tab.</td></tr>
                    )}
                    {(skuForecasts?.preview ?? []).map((row: any, i: number) => {
                      const actual = Number(row.actualUnits ?? 0);
                      const forecast = Number(row.forecastUnits ?? 0);
                      const variance = actual !== 0 ? ((forecast - actual) / Math.abs(actual)) * 100 : null;
                      const varClass = variance == null ? "" : Math.abs(variance) < 10 ? "text-green-600" : Math.abs(variance) < 25 ? "text-amber-600" : "text-red-600";
                      return (
                        <tr key={i} className="border-t hover:bg-muted/20">
                          <td className="p-3">{row.store ?? "\u2014"}</td>
                          <td className="p-3 font-mono">{row.styleCode ?? "\u2014"}</td>
                          <td className="p-3">{row.weekDate ?? "\u2014"}</td>
                          <td className="p-3 font-mono">{actual.toLocaleString()}</td>
                          <td className="p-3 font-mono">{forecast.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                          <td className={`p-3 font-mono ${varClass}`}>
                            {variance != null ? `${variance > 0 ? "+" : ""}${variance.toFixed(1)}%` : "\u2014"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </OrionLayout>
  );
}
