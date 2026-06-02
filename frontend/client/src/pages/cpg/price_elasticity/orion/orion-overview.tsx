import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, ReferenceLine,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Rocket, PauseCircle, Code2, ChevronUp, ChevronDown,
  FileCode, CheckCircle2, Pencil, X, RotateCcw, Save, Sparkles,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const API_BASE = "/api/cpg/price_elasticity";

const MODEL_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

type ModelType = {
  id: number;
  name: string;
  algorithm: string;
  status: string;
  isDeployed: boolean;
  trainedAt: string;
  rowCount?: number;
  r2?: number;
  modelWeights?: {
    globalPriceElasticity?: number;
    modelConverged?: boolean;
    elasticitySummary?: { name: string; elasticity: number }[];
    rowsProcessed?: number;
  };
};

export default function OrionOverview() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [codeOpen, setCodeOpen] = useState(true);
  const [activeFileId, setActiveFileId] = useState("elasticity_model");
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState(false);

  // Single consolidated overview call — same pattern as baseline_modelling
  const { data: overview, isLoading } = useQuery<any>({
    queryKey: [`${API_BASE}/orion/overview`],
  });
  const { data: codeFiles } = useQuery<any[]>({
    queryKey: [`${API_BASE}/code/files`],
  });
  const { data: codeFile, isLoading: codeLoading } = useQuery<any>({
    queryKey: [`${API_BASE}/code`, activeFileId],
    enabled: codeOpen && Boolean(activeFileId),
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/code/${activeFileId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const kpis = overview?.kpis ?? {};
  const allModels: ModelType[] = overview?.recentModels ?? overview?.modelPerformance ?? [];
  const deployedModel: ModelType | null = overview?.activeModel ?? null;

  const deployMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `${API_BASE}/models/${id}/deploy`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`${API_BASE}/orion/overview`] });
      toast({ title: "Model deployed" });
    },
    onError: (e: any) => toast({ title: "Deploy failed", description: e.message, variant: "destructive" }),
  });

  const undeployMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `${API_BASE}/models/${id}/undeploy`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`${API_BASE}/orion/overview`] });
      toast({ title: "Model undeployed" });
    },
    onError: (e: any) => toast({ title: "Undeploy failed", description: e.message, variant: "destructive" }),
  });

  const saveMut = useMutation({
    mutationFn: async ({ fileId, content }: { fileId: string; content: string }) => {
      const res = await apiRequest("PUT", `${API_BASE}/code/${fileId}`, { content });
      return res.json();
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [`${API_BASE}/code`, activeFileId] });
      setEditMode(false);
      setSavedBanner(true);
      setTimeout(() => setSavedBanner(false), 2500);
      toast({ title: "Code saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const startEdit = () => { if (!codeFile) return; setEditContent(codeFile.content); setEditMode(true); };
  const cancelEdit = () => { setEditMode(false); setEditContent(codeFile?.content ?? null); };
  const saveEdit = () => { if (!activeFileId || editContent === null) return; saveMut.mutate({ fileId: activeFileId, content: editContent }); };

  // Derive chart data from modelPerformance (last 8 runs)
  const modelPerf: any[] = overview?.modelPerformance ?? [];
  const chartData = modelPerf.map((m, i) => ({
    name: `#${i + 1} ${(m.name ?? "").slice(0, 10)}`,
    elasticity: m.globalPriceElasticity != null
      ? Number(m.globalPriceElasticity)
      : m.r2 != null ? Number(m.r2) : 0,
    fill: MODEL_COLORS[i % MODEL_COLORS.length],
  }));

  // Brand elasticity distribution from deployed model
  const elasticitySummary: { name: string; elasticity: number }[] =
    deployedModel?.modelWeights?.elasticitySummary ??
    (overview?.activeModel?.elasticitySummary) ?? [];
  const highlyElastic = elasticitySummary.filter(b => b.elasticity < -1).length;
  const inelastic = elasticitySummary.filter(b => b.elasticity >= -1 && b.elasticity < 0).length;
  const positive = elasticitySummary.filter(b => b.elasticity >= 0).length;
  const totalBrands = elasticitySummary.length;
  const elasticityDistData = [
    { band: "Highly Elastic (<−1)", count: highlyElastic, fill: "#ef4444" },
    { band: "Inelastic (−1 to 0)", count: inelastic, fill: "#3b82f6" },
    { band: "Positive (≥0)", count: positive, fill: "#22c55e" },
  ].filter(d => d.count > 0);

  return (
    <OrionLayout title="ML Orion Overview" subtitle="Price elasticity model factory — all numbers from live database" isLoading={isLoading}>
      <div className="mb-4">
        <OrionNav current="/cpg/price-elasticity/orion/overview" basePath="/cpg/price-elasticity/orion" />
      </div>

      {/* KPI Row — 7 cards matching baseline grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Total Runs" value={kpis.totalModels ?? "—"} />
        <KpiCard label="Deployed" value={kpis.deployedModels ?? "—"} color={(kpis.deployedModels ?? 0) > 0 ? "green" : "amber"} />
        <KpiCard
          label="Avg Global Elasticity"
          value={kpis.avgElasticity != null ? Number(kpis.avgElasticity).toFixed(3) : "—"}
        />
        <KpiCard label="Total Rows Processed" value={kpis.totalRowsProcessed != null ? Number(kpis.totalRowsProcessed).toLocaleString() : "—"} />
        <KpiCard
          label="Deployed Elasticity"
          value={kpis.deployedElasticity != null ? Number(kpis.deployedElasticity).toFixed(3) : "—"}
        />
        <KpiCard
          label="Deployed Converged"
          value={kpis.deployedConverged === null || kpis.deployedConverged === undefined ? "—" : kpis.deployedConverged ? "Yes" : "No"}
          color={kpis.deployedConverged ? "green" : "amber"}
        />
        <KpiCard label="Datasets" value={kpis.totalDatasets ?? "—"} />
      </div>


      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Left: Global Elasticity comparison */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="text-sm font-semibold mb-4">Global Elasticity — Last 8 Runs</h3>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No models yet. Run an experiment to see comparisons.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: any) => [Number(v).toFixed(3), "Global Elasticity"]} />
                <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                <ReferenceLine y={-1} stroke="#f97316" strokeDasharray="4 2" />
                <Bar dataKey="elasticity" name="Global Elasticity" radius={[2, 2, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Right: Brand Elasticity Distribution donut */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="text-sm font-semibold mb-1">Brand Elasticity Distribution</h3>
          <p className="text-xs text-muted-foreground mb-3">
            {deployedModel
              ? `From deployed model: ${deployedModel.name}`
              : "Deploy a model to see brand elasticity distribution"}
          </p>
          {totalBrands === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              No brand-level results yet — run a price elasticity experiment to see distribution.
            </p>
          ) : (
            <>
              <div className="relative flex justify-center">
                <PieChart width={200} height={180}>
                  <Pie
                    data={elasticityDistData}
                    dataKey="count"
                    nameKey="band"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {elasticityDistData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: any, name: any) => [
                      `${Number(v)} brand(s) (${totalBrands > 0 ? ((Number(v) / totalBrands) * 100).toFixed(0) : 0}%)`,
                      name,
                    ]}
                    contentStyle={{ fontSize: 11 }}
                  />
                </PieChart>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-base font-bold leading-tight">{totalBrands}</span>
                  <span className="text-[9px] text-muted-foreground">brands</span>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1 mb-3">
                {[
                  { band: "Highly Elastic (<−1)", count: highlyElastic, fill: "#ef4444" },
                  { band: "Inelastic (−1 to 0)", count: inelastic, fill: "#3b82f6" },
                  { band: "Positive (≥0)", count: positive, fill: "#22c55e" },
                ].map(d => (
                  <span key={d.band} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.fill }} />
                    {d.band}
                    {totalBrands > 0 && (
                      <span className="font-medium text-foreground">
                        {((d.count / totalBrands) * 100).toFixed(0)}%
                      </span>
                    )}
                  </span>
                ))}
              </div>
              <div className="flex gap-4 justify-center text-xs border-t pt-2">
                <span>
                  Global Elasticity:{" "}
                  <strong className={
                    (deployedModel?.modelWeights?.globalPriceElasticity ?? 0) < -1
                      ? "text-red-500"
                      : "text-blue-500"
                  }>
                    {(deployedModel?.modelWeights?.globalPriceElasticity ?? deployedModel?.r2) != null
                      ? Number(deployedModel?.modelWeights?.globalPriceElasticity ?? deployedModel?.r2).toFixed(3)
                      : "—"}
                  </strong>
                </span>
                <span>Brands: <strong>{totalBrands}</strong></span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── BACKEND CODE EXPLORER ── */}
      <div className="border rounded-lg bg-card mb-4 overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
          onClick={() => { setCodeOpen(o => !o); setEditMode(false); setEditContent(null); }}
        >
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-primary" />
            <div>
              <span className="text-sm font-semibold">Backend Code Explorer</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">Review and modify price elasticity ML pipeline source files — changes hot-reload immediately</p>
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
                { id: "elasticity_model", label: "Elasticity Model" },
                { id: "preprocessing", label: "Preprocessing" },
                { id: "aggregation", label: "Aggregation" },
                { id: "pipeline", label: "Pipeline" },
                { id: "storage", label: "Storage Layer" },
                { id: "models", label: "ORM Models" },
              ]).map((f: any) => (
                <button
                  key={f.id}
                  onClick={() => { setActiveFileId(f.id); setEditMode(false); setEditContent(null); }}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap ${activeFileId === f.id
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
                  <span className="font-mono text-foreground font-medium">
                    {activeFileId === "elasticity_model" ? "ML_backend/python-ml/cpg/price_elasticity/elasticity_model.py" :
                      activeFileId === "preprocessing" ? "ML_backend/python-ml/cpg/price_elasticity/preprocessing.py" :
                        activeFileId === "aggregation" ? "ML_backend/python-ml/cpg/price_elasticity/aggregation.py" :
                          activeFileId === "pipeline" ? "ML_backend/python-ml/cpg/price_elasticity/pipeline.py" :
                            activeFileId === "storage" ? "backend/storage.py" :
                              activeFileId === "models" ? "backend/models.py" : activeFileId}
                  </span>
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
                    <button onClick={startEdit} className="flex items-center gap-1 px-2 py-1 rounded border border-border hover:border-primary/50 hover:text-primary transition-colors">
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  ) : (
                    <>
                      <button onClick={cancelEdit} className="flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted transition-colors">
                        <X className="w-3 h-3" /> Cancel
                      </button>
                      <button onClick={() => setEditContent(codeFile.content)} className="flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted transition-colors">
                        <RotateCcw className="w-3 h-3" /> Reset
                      </button>
                      <button onClick={saveEdit} disabled={saveMut.isPending} className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                        <Save className="w-3 h-3" /> {saveMut.isPending ? "Deploying…" : "Deploy Changes"}
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

            {codeLoading && (
              <div className="h-64 flex items-center justify-center text-xs text-muted-foreground animate-pulse">Loading file…</div>
            )}

            {!codeLoading && codeFile && (
              editMode ? (
                <textarea
                  className="w-full font-mono text-[11px] leading-5 bg-gray-950 text-gray-100 p-4 resize-none outline-none border-0"
                  style={{ height: "520px", tabSize: 2 }}
                  value={editContent ?? ""}
                  onChange={e => setEditContent(e.target.value)}
                  spellCheck={false}
                  onKeyDown={e => {
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const start = e.currentTarget.selectionStart;
                      const end = e.currentTarget.selectionEnd;
                      const val = editContent ?? "";
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
          <p className="text-xs text-muted-foreground mt-1">
            All price elasticity models — deploy to activate production scoring
          </p>
        </div>
        {allModels.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            No models yet. Train your first model in the Experiment Lab.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {["Name", "Algorithm", "Status", "Global Elasticity", "Converged", "Brands Scored", "Rows", "Actions"].map(h => (
                    <th key={h} className="text-left p-3 font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allModels.map(m => {
                  const elas = (m as any).globalPriceElasticity ?? m.modelWeights?.globalPriceElasticity ?? m.r2 ?? null;
                  const converged = (m as any).modelConverged ?? m.modelWeights?.modelConverged ?? null;
                  const brands = (m as any).brandsScored ?? (m.modelWeights?.elasticitySummary ?? []).length;
                  const rows = (m as any).rowCount ?? m.modelWeights?.rowsProcessed ?? null;
                  return (
                    <tr key={m.id} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-medium max-w-[180px] truncate" title={m.name}>{m.name}</td>
                      <td className="p-3 text-muted-foreground">{m.algorithm}</td>
                      <td className="p-3"><StatusBadge status={m.isDeployed ? "Production" : m.status} /></td>
                      <td
                        className={`p-3 font-mono font-semibold ${elas != null && elas < -1 ? "text-red-600"
                          : elas != null && elas < 0 ? "text-blue-600"
                            : "text-green-600"
                          }`}
                      >
                        {elas != null ? Number(elas).toFixed(3) : "—"}
                      </td>
                      <td className="p-3">
                        {converged === null ? "—"
                          : converged
                            ? <span className="text-green-600 font-medium">Yes</span>
                            : <span className="text-amber-600 font-medium">No</span>}
                      </td>
                      <td className="p-3 font-mono">{brands > 0 ? brands : "—"}</td>
                      <td className="p-3 font-mono">{rows != null ? Number(rows).toLocaleString() : "—"}</td>
                      <td className="p-3">
                        {m.isDeployed ? (
                          <Button size="sm" variant="outline" className="h-6 text-xs gap-1"
                            onClick={() => undeployMut.mutate(m.id)} disabled={undeployMut.isPending}>
                            <PauseCircle className="w-3 h-3" /> Undeploy
                          </Button>
                        ) : (
                          <Button size="sm" className="h-6 text-xs gap-1"
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
