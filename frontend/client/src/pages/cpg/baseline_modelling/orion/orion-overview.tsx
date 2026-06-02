import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, PieChart, Pie } from "recharts";
import { Button } from "@/components/ui/button";
import {
  Rocket,
  PauseCircle,
  Code2,
  ChevronUp,
  ChevronDown,
  FileCode,
  CheckCircle2,
  Pencil,
  X,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const BAR_COLORS = ["#3b82f6", "#8b5cf6", "#10b981"];

type CodeFileTab = {
  id: string;
  label: string;
  description: string;
};

type CodeFileContent = {
  id: string;
  label: string;
  description: string;
  content: string;
  lines: number;
  lastModified: string;
};

export default function OrionOverview() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [codeOpen, setCodeOpen] = useState(true);
  const [activeFileId, setActiveFileId] = useState("train_model");
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/cpg/baseline_modelling/orion/overview"] });
  const { data: models } = useQuery<any[]>({ queryKey: ["/api/cpg/baseline_modelling/models"] });
  const { data: modelRiskDist } = useQuery<any>({
    queryKey: ["/api/cpg/baseline_modelling/orion/risk-distribution", selectedModelId],
    queryFn: () =>
      fetch(`/api/cpg/baseline_modelling/orion/risk-distribution${selectedModelId ? `?modelId=${selectedModelId}` : ""}`)
        .then(r => r.json()),
  });
  const { data: codeFiles } = useQuery<CodeFileTab[]>({
    queryKey: ["/api/cpg/baseline_modelling/code/files"],
  });
  const {
    data: codeFile,
    isLoading: codeLoading,
  } = useQuery<CodeFileContent>({
    queryKey: ["/api/cpg/baseline_modelling/code", activeFileId],
    enabled: codeOpen && Boolean(activeFileId),
  });

  const deployMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/cpg/baseline_modelling/models/${id}/deploy`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/cpg/baseline_modelling/models"] }); qc.invalidateQueries({ queryKey: ["/api/cpg/baseline_modelling/orion/overview"] }); toast({ title: "Model deployed" }); },
  });
  const undeployMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/cpg/baseline_modelling/models/${id}/undeploy`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/cpg/baseline_modelling/models"] }); qc.invalidateQueries({ queryKey: ["/api/cpg/baseline_modelling/orion/overview"] }); toast({ title: "Model undeployed" }); },
  });
  const saveMut = useMutation({
    mutationFn: async ({ fileId, content }: { fileId: string; content: string }) => {
      const response = await apiRequest("PUT", `/api/cpg/baseline_modelling/code/${fileId}`, { content });
      return response.json();
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/api/cpg/baseline_modelling/code", activeFileId] });
      setEditMode(false);
      setSavedBanner(true);
      setTimeout(() => setSavedBanner(false), 2500);
      toast({ title: "Code saved" });
    },
    onError: (error: any) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  const startEdit = () => {
    if (!codeFile) return;
    setEditContent(codeFile.content);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setEditContent(codeFile?.content ?? null);
  };

  const saveEdit = () => {
    if (!activeFileId || editContent === null) return;
    saveMut.mutate({ fileId: activeFileId, content: editContent });
  };

  const kpis = data?.kpis || {};

  // risk-distribution API returns { distribution: { low, medium, high, veryHigh }, ... }
  const activeDist = modelRiskDist?.distribution || { low: 0, medium: 0, high: 0, veryHigh: 0 };

  const perfData = (data?.modelPerformance || []).slice(0, 6);

  // Filter models to only trained ones for the dropdown
  const trainedModels = (models || []).filter(
    (m: any) => ["trained", "ready", "deployed", "production"].includes(
      String(m.status || "").toLowerCase()
    ) || m.isDeployed
  );

  return (
    <OrionLayout title="CPG Baseline Modelling — Orion Overview" subtitle="Baseline prediction model factory — all numbers from live database" isLoading={isLoading}>
      <div className="mb-4"><OrionNav current="/cpg/baseline-modelling/orion/overview" basePath="/cpg/baseline-modelling/orion" /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Total Runs" value={kpis.totalModels ?? "—"} />
        <KpiCard label="Deployed" value={kpis.deployedModels ?? "—"} trend={kpis.deployedModels > 0 ? "up" : undefined} />
        <KpiCard label="Avg R² (Deployed)" value={kpis.avgR2 != null ? kpis.avgR2.toFixed(3) : "—"} trend="up" />
        <KpiCard label="Total Rows Scored" value={kpis.totalRowsScored?.toLocaleString() ?? "—"} />
        <KpiCard label="Avg WMAPE (Deployed)" value={kpis.avgWmape != null ? `${(kpis.avgWmape * 100).toFixed(1)}%` : "—"} />
        <KpiCard label="Datasets" value={kpis.totalDatasets ?? "—"} />
        <KpiCard label="Promo Effect Units" value={kpis.totalPromoEffectUnits?.toLocaleString() ?? "—"} trend="up" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="text-sm font-semibold mb-4">Baseline Run Performance</h3>
          {perfData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No baseline runs yet. Go to Experiment Lab to run your first prediction.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={perfData} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="r2" name="R²" fill={BAR_COLORS[0]} radius={[2, 2, 0, 0]} />
                <Bar dataKey="wmape" name="WMAPE" fill={BAR_COLORS[1]} radius={[2, 2, 0, 0]} />
                <Bar dataKey="mae" name="MAE" fill={BAR_COLORS[2]} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold">SKU Baseline Deviation Distribution</h3>
            <select
              className="text-xs border rounded px-2 py-1 bg-background"
              value={selectedModelId ?? ""}
              onChange={e => setSelectedModelId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Baseline (All SKUs)</option>
              {trainedModels.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.algorithm})
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {selectedModelId
              ? `Showing predictions from selected model`
              : "Same data powering Command Center — single source of truth"}
          </p>
          {(() => {
            const bands = [
              { band: "Very High (≥30%)", count: activeDist.veryHigh || 0, fill: "#dc2626" },
              { band: "High (15–30%)",    count: activeDist.high     || 0, fill: "#f97316" },
              { band: "Medium (5–15%)",   count: activeDist.medium   || 0, fill: "#f59e0b" },
              { band: "On Track (<5%)",   count: activeDist.low      || 0, fill: "#22c55e" },
            ];
            const total = bands.reduce((s, d) => s + d.count, 0);
            const pieData = bands.filter(d => d.count > 0);
            const avgWmape = modelRiskDist?.avgWmape;
            const modelCount = modelRiskDist?.modelCount ?? 0;
            return total === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                No trained models yet — run a baseline experiment to see deviation distribution.
              </p>
            ) : (
              <>
                {/* Donut chart with center label */}
                <div className="relative flex justify-center">
                  <PieChart width={200} height={180}>
                    <Pie
                      data={pieData}
                      dataKey="count"
                      nameKey="band"
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip
                      formatter={(v: any, name: any) => [
                        `${Number(v).toLocaleString()} rows (${total > 0 ? ((Number(v) / total) * 100).toFixed(1) : 0}%)`,
                        name,
                      ]}
                      contentStyle={{ fontSize: 11 }}
                    />
                  </PieChart>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-base font-bold leading-tight">{total.toLocaleString()}</span>
                    <span className="text-[9px] text-muted-foreground">total rows</span>
                  </div>
                </div>
                {/* Legend */}
                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1 mb-3">
                  {bands.map(d => (
                    <span key={d.band} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.fill }} />
                      {d.band}
                      {total > 0 && (
                        <span className="font-medium text-foreground">
                          {((d.count / total) * 100).toFixed(0)}%
                        </span>
                      )}
                    </span>
                  ))}
                </div>
                {/* Footer metrics */}
                <div className="flex gap-4 justify-center text-xs border-t pt-2">
                  <span>
                    Avg WMAPE:{" "}
                    <strong className={avgWmape != null && avgWmape > 0.15 ? "text-red-500" : "text-emerald-500"}>
                      {avgWmape != null ? `${(avgWmape * 100).toFixed(1)}%` : "—"}
                    </strong>
                  </span>
                  <span>Models: <strong>{modelCount}</strong></span>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* ── BACKEND CODE EXPLORER ── */}
      <div className="border rounded-lg bg-card mb-4 overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
          onClick={() => { setCodeOpen(o => !o); setEditMode(false); setEditContent(null); }}
          data-testid="button-toggle-code-explorer"
        >
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-primary" />
            <div>
              <span className="text-sm font-semibold">Backend Code Explorer</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">Review and modify ML pipeline source files — changes hot-reload immediately</p>
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
                { id: "train_model", label: "ML Trainer" },
                { id: "schema", label: "Data Schema" },
                { id: "storage", label: "Storage Layer" },
                { id: "engine", label: "Feature Engine" },
                { id: "ml_service", label: "ML Service" },
              ]).map((f: any) => (
                <button
                  key={f.id}
                  onClick={() => { setActiveFileId(f.id); setEditMode(false); setEditContent(null); }}
                  data-testid={`tab-code-${f.id}`}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeFileId === f.id
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
                    {activeFileId === "train_model" ? "ML_backend/python-ml/cpg/baseline_modelling/baseline_prediction.py" :
                     activeFileId === "schema" ? "fastapi_server/schemas.py" :
                     activeFileId === "storage" ? "fastapi_server/storage.py" :
                     activeFileId === "engine" ? "fastapi_server/services/custom_features.py" :
                     activeFileId === "seed" ? "fastapi_server/storage.py" :
                     activeFileId === "ml_service" ? "fastapi_server/services/ml_service.py" :
                     activeFileId === "models" ? "fastapi_server/models.py" : activeFileId}
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
                    <button onClick={startEdit} className="flex items-center gap-1 px-2 py-1 rounded border border-border hover:border-primary/50 hover:text-primary transition-colors" data-testid="button-edit-code">
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  ) : (
                    <>
                      <button onClick={cancelEdit} className="flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted transition-colors" data-testid="button-cancel-edit">
                        <X className="w-3 h-3" /> Cancel
                      </button>
                      <button onClick={() => setEditContent(codeFile.content)} className="flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted transition-colors" data-testid="button-reset-code">
                        <RotateCcw className="w-3 h-3" /> Reset
                      </button>
                      <button onClick={saveEdit} disabled={saveMut.isPending} className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50" data-testid="button-save-code">
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
            {codeLoading && <div className="h-64 flex items-center justify-center text-xs text-muted-foreground animate-pulse">Loading file…</div>}
            {!codeLoading && codeFile && (
              editMode ? (
                <textarea
                  className="w-full font-mono text-[11px] leading-5 bg-gray-950 text-gray-100 p-4 resize-none outline-none border-0"
                  style={{ height: "520px", tabSize: 2 }}
                  value={editContent ?? ""}
                  onChange={e => setEditContent(e.target.value)}
                  spellCheck={false}
                  data-testid="textarea-code-editor"
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

      <div className="border rounded-lg bg-card">
        <div className="p-4 border-b">
          <h3 className="text-sm font-semibold">Model Registry</h3>
          <p className="text-xs text-muted-foreground mt-1">Manage all trained models — deploy to activate baseline scoring</p>
        </div>
        {(!models || models.length === 0) ? (
          <p className="text-sm text-muted-foreground text-center py-10">No models yet. Train your first model in the Experiment Lab.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {["Name", "Algorithm", "Status", "R²", "WMAPE", "MAE", "RMSE", "Rows Scored", "Actions"].map(h => (
                    <th key={h} className="text-left p-3 font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {models.map((m: any) => (
                  <tr key={m.id} className="border-t hover:bg-muted/30 transition-colors" data-testid={`row-model-${m.id}`}>
                    <td className="p-3 font-medium max-w-[180px] truncate" title={m.name}>{m.name}</td>
                    <td className="p-3 text-muted-foreground">{m.algorithm}</td>
                    <td className="p-3"><StatusBadge status={m.isDeployed ? "Production" : m.status} /></td>
                    <td className="p-3 font-semibold text-blue-600">{m.r2 != null ? m.r2.toFixed(3) : "—"}</td>
                    <td className="p-3">{m.wmape != null ? `${(m.wmape * 100).toFixed(1)}%` : "—"}</td>
                    <td className="p-3">{m.mae != null ? m.mae.toFixed(2) : "—"}</td>
                    <td className="p-3">{m.rmse != null ? m.rmse.toFixed(2) : "—"}</td>
                    <td className="p-3">{m.rowCount?.toLocaleString() ?? "—"}</td>
                    <td className="p-3">
                      {m.isDeployed ? (
                        <Button size="sm" variant="outline" className="h-6 text-xs gap-1" data-testid={`button-undeploy-${m.id}`}
                          onClick={() => undeployMut.mutate(m.id)} disabled={undeployMut.isPending}>
                          <PauseCircle className="w-3 h-3" /> Undeploy
                        </Button>
                      ) : (
                        <Button size="sm" className="h-6 text-xs gap-1" data-testid={`button-deploy-${m.id}`}
                          onClick={() => deployMut.mutate(m.id)} disabled={deployMut.isPending}>
                          <Rocket className="w-3 h-3" /> Deploy
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </OrionLayout>
  );
}
