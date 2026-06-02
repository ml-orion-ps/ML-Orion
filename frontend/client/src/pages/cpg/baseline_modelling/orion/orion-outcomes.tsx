import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";

const CPG_BASE = "/cpg/baseline-modelling/orion";

const KNOWN_EFFECT_SUFFIXES = [
  "base0_units",
  "baseline_without_promo",
  "units_with_all_promos",
  "cannibalization_effect_units",
  "comp_price_effect_units",
  "seasonality_effect_units",
  "holiday_effect_units",
  "promo_effect_units_sum",
  "residual_units",
];

const IDENTIFIER_CANDIDATES = [
  "product_id", "sku_id", "item_id", "store_id", "week_id",
  "brand", "category", "date_id", "date",
];

function numFmt(v: any, decimals = 0) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return decimals > 0 ? n.toFixed(decimals) : Math.round(n).toLocaleString();
}

export default function OrionOutcomes() {
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  const { data: overview, isLoading } = useQuery<any>({
    queryKey: ["/api/cpg/baseline_modelling/orion/overview"],
  });
  const { data: models = [] } = useQuery<any[]>({ queryKey: ["/api/cpg/baseline_modelling/models"] });

  const { data: modelPredictions = [] } = useQuery<any[]>({
    queryKey: ["/api/cpg/baseline_modelling/predictions/predictions", selectedModelId],
    queryFn: async () => {
      if (!selectedModelId) return [];
      const res = await fetch(
        `/api/cpg/baseline_modelling/predictions/predictions?model_id=${selectedModelId}`
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: selectedModelId != null,
  });

  const kpis = overview?.kpis || {};
  const sortedModels = [...(models as any[])].sort(
    (a, b) => new Date(b.trainedAt || 0).getTime() - new Date(a.trainedAt || 0).getTime()
  );
  const deployedModels = sortedModels.filter((m: any) => m.isDeployed);
  const bestR2 = sortedModels.reduce((best: number, m: any) => Math.max(best, m.r2 ?? 0), 0);

  const r2Data = sortedModels
    .filter((m: any) => m.r2 != null)
    .sort((a: any, b: any) => (b.r2 ?? 0) - (a.r2 ?? 0))
    .slice(0, 10)
    .map((m: any) => ({
      label: m.name?.split(" ").slice(-2).join(" ") || `#${m.id}`,
      r2: parseFloat((m.r2 as number).toFixed(3)),
      fill: m.r2 >= 0.8 ? "#22c55e" : m.r2 >= 0.6 ? "#f59e0b" : "#ef4444",
    }));

  const wmapeData = sortedModels
    .filter((m: any) => m.wmape != null)
    .sort((a: any, b: any) => (a.wmape ?? 1) - (b.wmape ?? 1))
    .slice(0, 10)
    .map((m: any) => ({
      label: m.name?.split(" ").slice(-2).join(" ") || `#${m.id}`,
      wmapePct: parseFloat(((m.wmape as number) * 100).toFixed(1)),
      fill: m.wmape < 0.05 ? "#22c55e" : m.wmape < 0.15 ? "#f59e0b" : "#ef4444",
    }));

  const algoMap: Record<string, { promo: number; count: number; r2Sum: number; wmapeSum: number }> = {};
  (sortedModels as any[]).forEach((m: any) => {
    const algo = m.algorithm || "Unknown";
    if (!algoMap[algo]) algoMap[algo] = { promo: 0, count: 0, r2Sum: 0, wmapeSum: 0 };
    algoMap[algo].promo += m.promoEffectUnits || 0;
    algoMap[algo].count += 1;
    algoMap[algo].r2Sum += m.r2 || 0;
    algoMap[algo].wmapeSum += m.wmape || 0;
  });
  const algoSummary = Object.entries(algoMap).map(([algo, d]) => ({
    algo,
    promoUnits: Math.round(d.promo),
    avgR2: d.count > 0 ? parseFloat((d.r2Sum / d.count).toFixed(3)) : 0,
    avgWmape: d.count > 0 ? parseFloat(((d.wmapeSum / d.count) * 100).toFixed(1)) : 0,
    runs: d.count,
  }));

  return (
    <OrionLayout
      title="Model Outcomes & Performance"
      subtitle="Baseline model accuracy, promotional lift, and deployment status"
      isLoading={isLoading}
    >
      <div className="mb-4">
        <OrionNav current={`${CPG_BASE}/outcomes`} basePath={CPG_BASE} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard label="Models Trained" value={kpis.totalModels ?? sortedModels.length} />
        <KpiCard label="Deployed" value={kpis.deployedModels ?? deployedModels.length} trend="up" />
        <KpiCard label="Best R²" value={bestR2 > 0 ? bestR2.toFixed(3) : "—"} trend="up" />
        <KpiCard
          label="Avg WMAPE"
          value={kpis.avgWmape != null ? `${(kpis.avgWmape * 100).toFixed(1)}%` : "—"}
        />
        <KpiCard
          label="Rows Scored"
          value={kpis.totalRowsScored ? kpis.totalRowsScored.toLocaleString() : "—"}
        />
        <KpiCard
          label="Promo Lift (Units)"
          value={
            kpis.totalPromoEffectUnits
              ? Math.round(kpis.totalPromoEffectUnits).toLocaleString()
              : "—"
          }
        />
      </div>

      <Tabs defaultValue="charts">
        <TabsList className="mb-4">
          <TabsTrigger value="charts">Performance Charts</TabsTrigger>
          <TabsTrigger value="results">Model Results</TabsTrigger>
          <TabsTrigger value="deployment">Deployment</TabsTrigger>
        </TabsList>

        {/* ── Performance Charts ── */}
        <TabsContent value="charts">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="border rounded-lg p-4 bg-card">
              <h3 className="text-sm font-semibold">R² Score by Model</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Higher is better · green ≥ 0.8, amber ≥ 0.6 (top 10)
              </p>
              {r2Data.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No trained models yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={r2Data} layout="vertical" margin={{ left: 0, right: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                    <XAxis
                      type="number"
                      domain={[0, 1]}
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => v.toFixed(1)}
                    />
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 9 }} width={110} />
                    <Tooltip formatter={(v: any) => [v, "R²"]} />
                    <Bar dataKey="r2" name="R²" radius={[0, 3, 3, 0]}>
                      {r2Data.map((d, i) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="border rounded-lg p-4 bg-card">
              <h3 className="text-sm font-semibold">WMAPE by Model</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Lower is better · green ≤ 5%, amber ≤ 15% (top 10)
              </p>
              {wmapeData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No trained models yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={wmapeData} layout="vertical" margin={{ left: 0, right: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 9 }} width={110} />
                    <Tooltip formatter={(v: any) => [`${v}%`, "WMAPE"]} />
                    <Bar dataKey="wmapePct" name="WMAPE %" radius={[0, 3, 3, 0]}>
                      {wmapeData.map((d, i) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-1">Algorithm Performance Summary</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Avg R², avg WMAPE, and total promo lift grouped by algorithm
            </p>
            {algoSummary.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No data yet.</p>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {algoSummary.map((d) => (
                  <div key={d.algo} className="border rounded-lg p-3 bg-muted/30">
                    <div className="text-xs font-medium text-muted-foreground mb-2">{d.algo}</div>
                    <div className="flex items-baseline gap-1 mb-1">
                      <span
                        className="text-xl font-bold"
                        style={{
                          color:
                            d.avgR2 >= 0.8
                              ? "#16a34a"
                              : d.avgR2 >= 0.6
                              ? "#d97706"
                              : "#dc2626",
                        }}
                      >
                        {d.avgR2 > 0 ? d.avgR2.toFixed(3) : "—"}
                      </span>
                      <span className="text-xs text-muted-foreground">avg R²</span>
                    </div>
                    <div className="text-sm">
                      <span
                        className="font-semibold"
                        style={{
                          color:
                            d.avgWmape < 5
                              ? "#16a34a"
                              : d.avgWmape < 15
                              ? "#d97706"
                              : "#dc2626",
                        }}
                      >
                        {d.avgWmape > 0 ? `${d.avgWmape}%` : "—"}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">avg WMAPE</span>
                    </div>
                    <div className="text-sm mt-1">
                      <span className="font-semibold">{d.promoUnits.toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground ml-1">promo units</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {d.runs} run{d.runs !== 1 ? "s" : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Model Results ── */}
        <TabsContent value="results">
          {/* Model selector */}
          <div className="border rounded-lg bg-card mb-4 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Select Model to View Results
                </label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  value={selectedModelId ?? ""}
                  onChange={(e) => setSelectedModelId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— choose a model —</option>
                  {sortedModels.map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.algorithm}{m.r2 != null ? ` · R² ${m.r2.toFixed(3)}` : ""}
                      {m.isDeployed ? " ★" : ""}
                    </option>
                  ))}
                </select>
              </div>
              {selectedModelId && (() => {
                const m = sortedModels.find((x: any) => x.id === selectedModelId);
                return m ? (
                  <div className="shrink-0">
                    <StatusBadge status={m.isDeployed ? "Production" : m.status} />
                  </div>
                ) : null;
              })()}
            </div>
          </div>

          {/* Selected model detail */}
          {selectedModelId && (() => {
            const m = sortedModels.find((x: any) => x.id === selectedModelId);
            if (!m) return null;
            const weights = m.modelWeights || m.model_weights || {};
            const totals = weights.predictionTotals || weights.totals || {};
            const promoUsed: string[] = weights.promoColumnsUsed || [];

            /* Derive column sets from first prediction row */
            const firstRow = modelPredictions[0] || {};
            const idCols = IDENTIFIER_CANDIDATES.filter((c) => c in firstRow);
            const knownEffectCols = KNOWN_EFFECT_SUFFIXES.filter((c) => c in firstRow);
            const dynamicPromoCols = Object.keys(firstRow).filter(
              (k) => k.endsWith("_effect_units") && !KNOWN_EFFECT_SUFFIXES.includes(k)
            );
            const allEffectCols = [...knownEffectCols, ...dynamicPromoCols];

            return (
              <div className="space-y-4">
                {/* Accuracy metrics row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KpiCard label="R²" value={m.r2 != null ? m.r2.toFixed(3) : "—"} trend={m.r2 >= 0.8 ? "up" : undefined} />
                  <KpiCard label="WMAPE" value={m.wmape != null ? `${(m.wmape * 100).toFixed(1)}%` : "—"} />
                  <KpiCard label="MAE" value={m.mae != null ? m.mae.toFixed(2) : "—"} />
                  <KpiCard label="RMSE" value={m.rmse != null ? m.rmse.toFixed(2) : "—"} />
                </div>
                {/* Decomposition totals row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KpiCard label="Actual Units" value={totals.actualUnits != null ? Math.round(totals.actualUnits).toLocaleString() : (m.rowCount?.toLocaleString() ?? "—")} />
                  <KpiCard label="Baseline Units" value={totals.baselineWithoutPromoUnits != null ? Math.round(totals.baselineWithoutPromoUnits).toLocaleString() : (m.baselineUnits != null ? Math.round(m.baselineUnits).toLocaleString() : "—")} />
                  <KpiCard label="Promo Effect" value={totals.promoEffectUnits != null ? Math.round(totals.promoEffectUnits).toLocaleString() : (m.promoEffectUnits != null ? Math.round(m.promoEffectUnits).toLocaleString() : "—")} trend="up" />
                  <KpiCard label="Residual Units" value={totals.residualUnits != null ? Math.round(totals.residualUnits).toLocaleString() : (m.residualUnits != null ? Math.round(m.residualUnits).toLocaleString() : "—")} />
                </div>

                {/* Promo columns + hyperparams info row */}
                {(promoUsed.length > 0 || m.hyperparameters) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {promoUsed.length > 0 && (
                      <div className="border rounded-lg p-4 bg-card">
                        <h4 className="text-xs font-semibold mb-2">Promo Columns Used</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {promoUsed.map((col) => (
                            <span key={col} className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-mono">
                              {col}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {m.hyperparameters && Object.keys(m.hyperparameters).length > 0 && (
                      <div className="border rounded-lg p-4 bg-card">
                        <h4 className="text-xs font-semibold mb-2">Best Hyperparameters</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(m.hyperparameters).map(([k, v]) => (
                            <span key={k} className="px-2 py-0.5 rounded-full bg-muted text-xs font-mono">
                              {k}: {String(v)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Feature importance */}
                {Array.isArray(m.featureImportance || m.feature_importance) &&
                  (m.featureImportance || m.feature_importance || []).length > 0 && (
                  <div className="border rounded-lg p-4 bg-card">
                    <h4 className="text-xs font-semibold mb-3">Feature Importance</h4>
                    <div className="space-y-1.5">
                      {[...(m.featureImportance || m.feature_importance || [])]
                        .sort((a: any, b: any) => Math.abs(b.importance ?? 0) - Math.abs(a.importance ?? 0))
                        .slice(0, 12)
                        .map((fi: any) => {
                          const pct = Math.abs(fi.importance ?? 0) * 100;
                          return (
                            <div key={fi.feature} className="flex items-center gap-2">
                              <span className="text-xs font-mono w-36 shrink-0 truncate text-muted-foreground">{fi.feature}</span>
                              <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-blue-500"
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs font-mono w-10 text-right">{pct.toFixed(1)}%</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* Row-level predictions table */}
                <div className="border rounded-lg bg-card">
                  <div className="p-4 border-b flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold">Row-level Decomposition Results</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {modelPredictions.length > 0
                          ? `${modelPredictions.length.toLocaleString()} rows · showing first 200`
                          : "No scored rows available — run Predict / Score from the Experiments page"}
                      </p>
                    </div>
                  </div>
                  {modelPredictions.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      No prediction rows stored for this model yet.<br />
                      Go to <span className="font-medium">Experiments → Predict Customers</span> to score and store results.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            {[...idCols, ...allEffectCols].map((h) => (
                              <th
                                key={h}
                                className="text-left p-2.5 font-medium text-muted-foreground whitespace-nowrap"
                              >
                                {h.replace(/_/g, " ")}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {modelPredictions.slice(0, 200).map((row: any, i: number) => (
                            <tr key={i} className="border-t hover:bg-muted/20">
                              {idCols.map((c) => (
                                <td key={c} className="p-2.5 text-muted-foreground">{row[c] ?? "—"}</td>
                              ))}
                              {allEffectCols.map((c) => (
                                <td key={c} className="p-2.5 font-mono text-right">{numFmt(row[c], 1)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* No model selected — show summary table */}
          {!selectedModelId && (
            <div className="border rounded-lg bg-card">
              <div className="p-4 border-b">
                <h3 className="text-sm font-semibold">All Baseline Models</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sortedModels.length} model run{sortedModels.length !== 1 ? "s" : ""} · select a model above to view detailed results
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {[
                        "Model", "Algorithm", "R²", "WMAPE", "MAE", "RMSE",
                        "Rows", "Baseline Units", "Promo Effect", "Status", "Trained",
                      ].map((h) => (
                        <th key={h} className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedModels.length === 0 && (
                      <tr>
                        <td colSpan={11} className="p-6 text-center text-muted-foreground">
                          No baseline runs yet. Run an experiment from the Experiments page.
                        </td>
                      </tr>
                    )}
                    {sortedModels.map((m: any) => (
                      <tr
                        key={m.id}
                        className="border-t hover:bg-muted/20 cursor-pointer"
                        onClick={() => setSelectedModelId(m.id)}
                      >
                        <td className="p-3 font-medium max-w-[180px] truncate">{m.name}</td>
                        <td className="p-3 text-muted-foreground">{m.algorithm}</td>
                        <td
                          className="p-3 font-mono font-bold"
                          style={{
                            color:
                              m.r2 == null ? undefined
                              : m.r2 >= 0.8 ? "#16a34a"
                              : m.r2 >= 0.6 ? "#d97706"
                              : "#dc2626",
                          }}
                        >
                          {m.r2 != null ? m.r2.toFixed(3) : "—"}
                        </td>
                        <td
                          className="p-3 font-mono"
                          style={{
                            color:
                              m.wmape == null ? undefined
                              : m.wmape < 0.05 ? "#16a34a"
                              : m.wmape < 0.15 ? "#d97706"
                              : "#dc2626",
                          }}
                        >
                          {m.wmape != null ? `${(m.wmape * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className="p-3 font-mono">{m.mae != null ? m.mae.toFixed(2) : "—"}</td>
                        <td className="p-3 font-mono">{m.rmse != null ? m.rmse.toFixed(2) : "—"}</td>
                        <td className="p-3 font-mono">{m.rowCount?.toLocaleString() ?? "—"}</td>
                        <td className="p-3 font-mono">
                          {m.baselineUnits != null ? Math.round(m.baselineUnits).toLocaleString() : "—"}
                        </td>
                        <td className="p-3 font-mono">
                          {m.promoEffectUnits != null ? Math.round(m.promoEffectUnits).toLocaleString() : "—"}
                        </td>
                        <td className="p-3">
                          <StatusBadge status={m.isDeployed ? "Production" : m.status} />
                        </td>
                        <td className="p-3 text-muted-foreground whitespace-nowrap">
                          {m.trainedAt ? new Date(m.trainedAt).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Deployment ── */}
        <TabsContent value="deployment">
          <div className="border rounded-lg bg-card">
            <div className="p-4 border-b">
              <h3 className="text-sm font-semibold">Deployed Models</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {deployedModels.length} model{deployedModels.length !== 1 ? "s" : ""} currently in
                production
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {[
                      "Model",
                      "Algorithm",
                      "R²",
                      "WMAPE",
                      "Rows Scored",
                      "Baseline Units",
                      "Promo Effect",
                      "Deployed",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deployedModels.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-muted-foreground">
                        No models deployed yet. Deploy a trained model from the Experiments page.
                      </td>
                    </tr>
                  )}
                  {deployedModels.map((m: any) => (
                    <tr key={m.id} className="border-t hover:bg-muted/20">
                      <td className="p-3 font-medium max-w-[200px] truncate">{m.name}</td>
                      <td className="p-3">{m.algorithm}</td>
                      <td className="p-3 font-mono font-bold text-blue-600">
                        {m.r2 != null ? m.r2.toFixed(3) : "—"}
                      </td>
                      <td className="p-3 font-mono">
                        {m.wmape != null ? `${(m.wmape * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="p-3 font-mono">{m.rowCount?.toLocaleString() ?? "—"}</td>
                      <td className="p-3 font-mono">
                        {m.baselineUnits != null
                          ? Math.round(m.baselineUnits).toLocaleString()
                          : "—"}
                      </td>
                      <td className="p-3 font-mono">
                        {m.promoEffectUnits != null
                          ? Math.round(m.promoEffectUnits).toLocaleString()
                          : "—"}
                      </td>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">
                        {m.deployedAt ? new Date(m.deployedAt).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {sortedModels.filter((m: any) => !m.isDeployed).length > 0 && (
            <div className="border rounded-lg bg-card mt-4">
              <div className="p-4 border-b">
                <h3 className="text-sm font-semibold">Trained · Not Deployed</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Available to deploy from the Experiments page
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {["Model", "Algorithm", "R²", "WMAPE", "Status", "Trained"].map((h) => (
                        <th key={h} className="text-left p-3 font-medium text-muted-foreground">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedModels
                      .filter((m: any) => !m.isDeployed)
                      .map((m: any) => (
                        <tr key={m.id} className="border-t hover:bg-muted/20">
                          <td className="p-3 font-medium max-w-[200px] truncate">{m.name}</td>
                          <td className="p-3 text-muted-foreground">{m.algorithm}</td>
                          <td className="p-3 font-mono text-blue-600">
                            {m.r2 != null ? m.r2.toFixed(3) : "—"}
                          </td>
                          <td className="p-3 font-mono">
                            {m.wmape != null ? `${(m.wmape * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className="p-3">
                            <StatusBadge status={m.status} />
                          </td>
                          <td className="p-3 text-muted-foreground whitespace-nowrap">
                            {m.trainedAt ? new Date(m.trainedAt).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </OrionLayout>
  );
}
