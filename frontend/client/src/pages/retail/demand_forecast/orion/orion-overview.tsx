import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Rocket, PauseCircle, Code2, ChevronUp, ChevronDown,
  FileCode, CheckCircle2, Pencil, X, RotateCcw, Save, Sparkles,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const API_BASE = "/api/retail/demand_forecast";
const MODEL_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

const asNumber = (v: any) =>
  v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";

const cleanModelName = (value: any) => {
  if (!value) return null;
  const text = String(value).trim();
  const m = text.match(/^Auto\s*\((.+)\)$/i);
  return m?.[1] || text;
};

const getRunBestModel = (run: any) =>
  cleanModelName(run.bestModel) ||
  cleanModelName(run.modelWeights?.bestModel) ||
  cleanModelName(run.modelWeights?.summary?.bestModel) ||
  cleanModelName(run.algorithm) ||
  "—";

type ModelType = {
  id: number;
  name: string;
  algorithm: string;
  status: string;
  trainedAt: string;
  isDeployed: boolean;
  mape: number;
  wmape: number;
  rmse: number;
  r2: number;
  actualUnits?: number;
  forecastUnits?: number;
  modelWeights?: any;
};

type CodeFileTab = { id: string; label: string; description: string };
type CodeFileContent = {
  id: string; label: string; description: string;
  content: string; lines: number; lastModified: string;
};

export default function OrionOverview() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [codeOpen, setCodeOpen] = useState(true);
  const [activeFileId, setActiveFileId] = useState("train_model");
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState(false);

  const { data: overview, isLoading } = useQuery<any>({
    queryKey: [`${API_BASE}/orion/overview`],
  });
  const { data: models = [] } = useQuery<ModelType[]>({
    queryKey: [`${API_BASE}/models`],
  });
  const { data: outcomeData } = useQuery<any>({
    queryKey: [`${API_BASE}/orion/outcome-analysis`],
  });
  const { data: codeFiles } = useQuery<CodeFileTab[]>({
    queryKey: [`${API_BASE}/code/files`],
  });
  const { data: codeFile, isLoading: codeLoading } = useQuery<CodeFileContent>({
    queryKey: [`${API_BASE}/code`, activeFileId],
    enabled: codeOpen && Boolean(activeFileId),
  });

  const deployMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `${API_BASE}/orion/model-runs/${id}/deploy`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`${API_BASE}/models`] });
      qc.invalidateQueries({ queryKey: [`${API_BASE}/orion/overview`] });
      toast({ title: "Model deployed to production" });
    },
  });

  const demoteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `${API_BASE}/orion/model-runs/${id}/demote`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`${API_BASE}/models`] });
      qc.invalidateQueries({ queryKey: [`${API_BASE}/orion/overview`] });
      toast({ title: "Model demoted" });
    },
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

  // KPIs derived from model list (demand forecast runs only)
  const totalRuns = (models as ModelType[]).length;
  const deployedCount = (models as ModelType[]).filter(m => m.isDeployed).length;
  const wmapes = (models as ModelType[])
    .map(m => m.wmape)
    .filter(v => v != null)
    .map(Number);
  const bestWmape = wmapes.length > 0 ? Math.min(...wmapes) : null;
  const forecastAccuracy = bestWmape != null ? 100 - bestWmape : null;

  const kpis = overview?.kpis || {};

  // Chart data from outcome-analysis
  const wmapeByRun = (outcomeData?.wmapeByRun || []).slice(-8);
  const actualVsForecast = (outcomeData?.actualVsForecast || []).slice(-6);

  // Registry sorted newest first
  const forecastRuns = [...(models as ModelType[])].sort(
    (a, b) => new Date(b.trainedAt || 0).getTime() - new Date(a.trainedAt || 0).getTime()
  );

  const filePathLabel: Record<string, string> = {
    train_model: "ML_backend/python-ml/retail/demand_forecast/retail_demand_forecast_main.py",
    train_tune: "ML_backend/python-ml/retail/demand_forecast/train_tune_model.py",
    data_prep: "ML_backend/python-ml/retail/demand_forecast/data_prep.py",
    feature_selection: "ML_backend/python-ml/retail/demand_forecast/feature_selection.py",
    storage: "backend/storage.py",
    engine: "backend/services/custom_features.py",
    ml_service: "backend/services/ml_service.py",
    schema: "backend/schemas.py",
  };

  return (
    <OrionLayout
      title="ML Orion Overview"
      subtitle="Demand forecast — all numbers from live database"
      isLoading={isLoading}
    >
      <div className="mb-4">
        <OrionNav current="/retail/demand_forecast/orion/overview" basePath="/retail/demand_forecast/orion" />
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Total Forecast Runs" value={totalRuns} />
        <KpiCard
          label="Deployed"
          value={deployedCount}
          trend={deployedCount > 0 ? "up" : undefined}
        />
        <KpiCard
          label="Best WMAPE"
          value={bestWmape != null ? `${bestWmape.toFixed(1)}%` : "—"}
          color={
            bestWmape == null ? "default" : bestWmape < 15 ? "green" : bestWmape < 25 ? "amber" : "red"
          }
        />
        <KpiCard
          label="Forecast Accuracy"
          value={forecastAccuracy != null ? `${forecastAccuracy.toFixed(1)}%` : "—"}
          trend={forecastAccuracy != null && forecastAccuracy > 80 ? "up" : undefined}
        />
        <KpiCard
          label="Rows Forecasted"
          value={kpis.uniqueRowsScored ? Number(kpis.uniqueRowsScored).toLocaleString() : "—"}
        />
        <KpiCard
          label="Forecasted Units"
          value={kpis.forecastedUnits ? Number(kpis.forecastedUnits).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
        />
        <KpiCard label="Datasets" value={kpis.totalDatasets ?? "—"} />
        <KpiCard
          label="Avg WMAPE"
          value={kpis.avgWmape != null ? `${Number(kpis.avgWmape).toFixed(1)}%` : "—"}
        />
      </div>

      {/* ── Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* WMAPE by Run */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="text-sm font-semibold mb-4">WMAPE by Run</h3>
          {wmapeByRun.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No forecast runs yet. Go to Experiment Lab to run your first model.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={wmapeByRun} margin={{ left: -10 }}>
                <XAxis dataKey="run" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit="%" />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)}%`, "WMAPE"]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="wmape" name="WMAPE" radius={[2, 2, 0, 0]}>
                  {wmapeByRun.map((_: any, i: number) => (
                    <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Actual vs Forecast */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="text-sm font-semibold mb-4">Actual vs Forecast Units</h3>
          {actualVsForecast.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No forecast data yet. Train a model with a dataset to see comparisons.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={actualVsForecast} margin={{ left: -10 }}>
                <XAxis dataKey="run" tick={{ fontSize: 10 }} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
                />
                <Tooltip
                  formatter={(v: any, name: string) => [Number(v).toLocaleString(), name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="actualUnits" name="Actual Units" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                <Bar dataKey="forecastUnits" name="Forecast Units" fill="#10b981" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
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
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Review and modify demand forecast pipeline source files — changes hot-reload immediately
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!codeOpen && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                {(codeFiles || []).length} files accessible
              </span>
            )}
            {codeOpen
              ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </button>

        {codeOpen && (
          <div className="border-t">
            {/* File tabs */}
            <div className="flex items-center gap-0 border-b bg-muted/20 overflow-x-auto">
              {(codeFiles || [
                { id: "train_model", label: "ML Trainer" },
                { id: "train_tune", label: "Train & Tune" },
                { id: "data_prep", label: "Data Prep" },
                { id: "feature_selection", label: "Feature Selection" },
                { id: "storage", label: "Storage Layer" },
                { id: "engine", label: "Feature Engine" },
                { id: "ml_service", label: "ML Service" },
                { id: "schema", label: "Data Schema" },
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

            {/* File meta + edit controls */}
            {codeFile && !codeLoading && (
              <div className="flex items-center justify-between px-4 py-2 bg-muted/10 border-b text-[10px] text-muted-foreground">
                <div className="flex items-center gap-4">
                  <span className="font-mono text-foreground font-medium">
                    {filePathLabel[activeFileId] ?? activeFileId}
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
                    <button
                      onClick={startEdit}
                      className="flex items-center gap-1 px-2 py-1 rounded border border-border hover:border-primary/50 hover:text-primary transition-colors"
                      data-testid="button-edit-code"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={cancelEdit}
                        className="flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
                        data-testid="button-cancel-edit"
                      >
                        <X className="w-3 h-3" /> Cancel
                      </button>
                      <button
                        onClick={() => setEditContent(codeFile.content)}
                        className="flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
                        data-testid="button-reset-code"
                      >
                        <RotateCcw className="w-3 h-3" /> Reset
                      </button>
                      <button
                        onClick={saveEdit}
                        disabled={saveMut.isPending}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                        data-testid="button-save-code"
                      >
                        <Save className="w-3 h-3" />
                        {saveMut.isPending ? "Saving…" : "Save Changes"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* File description banner */}
            {codeFile && !codeLoading && (
              <div className="px-4 py-2 border-b bg-blue-500/5 border-blue-500/20">
                <p className="text-[10px] text-blue-800 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 flex-shrink-0" />
                  {codeFile.description}
                </p>
              </div>
            )}

            {codeLoading && (
              <div className="h-64 flex items-center justify-center text-xs text-muted-foreground animate-pulse">
                Loading file…
              </div>
            )}

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
                      setTimeout(() => {
                        e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 2;
                      }, 0);
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

      {/* ── FORECAST MODEL REGISTRY ── */}
      <div className="border rounded-lg bg-card">
        <div className="p-4 border-b">
          <h3 className="text-sm font-semibold">Forecast Model Registry</h3>
          <p className="text-xs text-muted-foreground mt-1">
            All demand forecast runs — deploy to activate SKU-level scoring
          </p>
        </div>

        {forecastRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            No models yet. Run your first experiment in the Experiment Lab.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {["Run Name", "Best Model", "WMAPE", "MAPE", "RMSE", "R²", "Actual Units", "Forecast Units", "Status", "Actions"].map(h => (
                    <th key={h} className="text-left p-3 font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {forecastRuns.map((m: ModelType) => (
                  <tr
                    key={m.id}
                    className="border-t hover:bg-muted/30 transition-colors"
                    data-testid={`row-model-${m.id}`}
                  >
                    <td className="p-3 font-medium max-w-[180px] truncate" title={m.name}>
                      {m.name}
                    </td>
                    <td className="p-3 font-semibold whitespace-nowrap">{getRunBestModel(m)}</td>
                    <td className={`p-3 font-mono font-semibold ${
                      m.wmape == null ? "" : m.wmape < 15 ? "text-emerald-600" : m.wmape < 25 ? "text-amber-600" : "text-red-600"
                    }`}>
                      {m.wmape != null ? `${Number(m.wmape).toFixed(1)}%` : "—"}
                    </td>
                    <td className="p-3 font-mono">
                      {m.mape != null ? Number(m.mape).toFixed(2) : "—"}
                    </td>
                    <td className="p-3 font-mono">
                      {m.rmse != null ? Number(m.rmse).toFixed(2) : "—"}
                    </td>
                    <td className="p-3 font-mono">
                      {m.r2 != null ? Number(m.r2).toFixed(3) : "—"}
                    </td>
                    <td className="p-3 font-mono">{asNumber(m.actualUnits)}</td>
                    <td className="p-3 font-mono">{asNumber(m.forecastUnits)}</td>
                    <td className="p-3">
                      <StatusBadge status={m.isDeployed ? "deployed" : m.status} />
                    </td>
                    <td className="p-3">
                      {m.isDeployed ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs gap-1"
                          onClick={() => demoteMut.mutate(m.id)}
                          disabled={demoteMut.isPending}
                          data-testid={`button-demote-${m.id}`}
                        >
                          <PauseCircle className="w-3 h-3" /> Demote
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="h-6 text-xs gap-1"
                          onClick={() => deployMut.mutate(m.id)}
                          disabled={deployMut.isPending}
                          data-testid={`button-deploy-${m.id}`}
                        >
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
