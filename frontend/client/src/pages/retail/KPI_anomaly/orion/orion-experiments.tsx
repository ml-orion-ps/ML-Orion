import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { FlaskConical, Database, Rocket, Zap, CheckCircle2, Trash2, Activity } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

type KpiAnomalyResult = {
  success: boolean;
  modelId?: number;
  modelName?: string;
  datasetId?: number;
  datasetName?: string;
  summary: {
    algorithm: string;
    totalRows: number;
    totalAnomalies: number;
    kpisProcessed: string[];
    kpiStats: Record<string, any>;
  };
  anomalies: any[];
};

type AnomalyModel = {
  id: number;
  name: string;
  datasetId: number;
  algorithm: string;
  status: string;
  isDeployed: boolean;
  trainedAt: string | null;
  modelWeights: {
    modelType?: string;
    summary?: KpiAnomalyResult["summary"];
  } | null;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const KPI_COLORS = ["#ef4444","#f59e0b","#3b82f6","#8b5cf6","#10b981","#ec4899","#14b8a6","#f43f5e","#84cc16","#06b6d4"];

// ── Formatters ─────────────────────────────────────────────────────────────────

const asNumber = (v: any) => v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";

// ── Component ──────────────────────────────────────────────────────────────────

export default function OrionExperiments() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [name,              setName]              = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [dateCol,           setDateCol]           = useState("Week_Start_Date");
  const [progress,          setProgress]          = useState(0);
  const [isRunning,         setIsRunning]         = useState(false);
  const [latestResult,      setLatestResult]      = useState<KpiAnomalyResult | null>(null);
  const [deleteTarget,      setDeleteTarget]      = useState<AnomalyModel | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: datasets = [] } = useQuery<any[]>({ queryKey: ["/api/retail/kpiAnomaly/datasets"] });
  const trainableDatasets = (datasets as any[]).filter((d: any) => d.rowCount > 0);

  const { data: allModels = [] } = useQuery<AnomalyModel[]>({
    queryKey: ["/api/retail/kpiAnomaly/models"],
    refetchOnWindowFocus: false,
  });

  const anomalyModels: AnomalyModel[] = (allModels as AnomalyModel[]).filter(
    (m) => m.modelWeights?.modelType === "kpi_anomaly"
  );

  const deployedCount = anomalyModels.filter((m) => m.isDeployed).length;
  const latestModel   = anomalyModels.length > 0
    ? [...anomalyModels].sort((a, b) => new Date(b.trainedAt ?? 0).getTime() - new Date(a.trainedAt ?? 0).getTime())[0]
    : null;

  // ── Mutations ──────────────────────────────────────────────────────────────

  const runMut = useMutation({
    mutationFn: async ({ datasetId, runName, dateColumn }: { datasetId: number; runName: string; dateColumn: string }) => {
      const res = await apiRequest("POST", `/api/retail/kpiAnomaly/datasets/${datasetId}/kpi-anomaly`, {
        name:    runName,
        dateCol: dateColumn,
      });
      return res.json() as Promise<KpiAnomalyResult>;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/models"] });
      setLatestResult(result);
      toast({
        title: "KPI anomaly detection complete",
        description: `${result.summary.totalAnomalies} anomalies across ${result.summary.kpisProcessed.length} KPI(s) in ${result.summary.totalRows.toLocaleString()} rows`,
      });
    },
    onError: (e: any) => toast({ title: "Detection failed", description: e.message, variant: "destructive" }),
  });

  const deployMut = useMutation({
    mutationFn: async (modelId: number) => {
      const res = await apiRequest("POST", `/api/retail/kpiAnomaly/models/${modelId}/deploy`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/models"] });
      toast({ title: "Model deployed" });
    },
    onError: (e: any) => toast({ title: "Deploy failed", description: e.message, variant: "destructive" }),
  });

  const undeployMut = useMutation({
    mutationFn: async (modelId: number) => {
      const res = await apiRequest("POST", `/api/retail/kpiAnomaly/models/${modelId}/undeploy`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/models"] });
      toast({ title: "Model undeployed" });
    },
    onError: (e: any) => toast({ title: "Undeploy failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (modelId: number) => {
      await apiRequest("DELETE", `/api/retail/kpiAnomaly/models/${modelId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/retail/kpiAnomaly/models"] });
      setDeleteTarget(null);
      toast({ title: "Experiment deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  // ── Run handler ────────────────────────────────────────────────────────────

  const handleRun = async () => {
    if (!selectedDatasetId) return toast({ title: "Select a dataset", variant: "destructive" });
    setIsRunning(true);
    setProgress(0);
    setLatestResult(null);
    const iv = setInterval(() => setProgress(p => (p >= 92 ? (clearInterval(iv), p) : p + Math.random() * 10)), 250);
    try {
      await runMut.mutateAsync({
        datasetId:   Number(selectedDatasetId),
        runName:     name.trim(),
        dateColumn:  dateCol.trim() || "Week_Start_Date",
      });
    } finally {
      clearInterval(iv);
      setProgress(100);
      setTimeout(() => { setIsRunning(false); setProgress(0); }, 800);
    }
  };

  // ── Chart data (latest 8 models) ───────────────────────────────────────────

  const last8 = anomalyModels.slice(-8);
  const chartData = last8.map((m, i) => {
    const s = m.modelWeights?.summary;
    const rate = s?.totalRows ? parseFloat(((s.totalAnomalies ?? 0) / s.totalRows * 100).toFixed(1)) : 0;
    return { name: `#${anomalyModels.indexOf(m) + 1}`, anomalyRate: rate, fill: KPI_COLORS[i % KPI_COLORS.length] };
  });

  // ── Saved result from selected dataset ────────────────────────────────────

  const savedResult = (() => {
    const ds    = trainableDatasets.find((d: any) => d.id === Number(selectedDatasetId));
    const saved = ds?.featureReport?.kpiAnomaly ?? ds?.feature_report?.kpiAnomaly;
    if (saved?.summary) return { success: true, summary: saved.summary, anomalies: saved.preview || [] } as KpiAnomalyResult;
    return null;
  })();

  const visibleResult = latestResult ?? savedResult;

  // KPI stats for result chart
  const resultKpiData = visibleResult
    ? Object.entries(visibleResult.summary.kpiStats as Record<string, any>)
        .map(([name, s]: [string, any]) => ({
          name,
          anomalies: (s.anomalyCount ?? s.total_anomalies ?? 0) as number,
        }))
        .sort((a, b) => b.anomalies - a.anomalies)
        .slice(0, 10)
    : [];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <OrionLayout title="Experiment Lab" subtitle="Run KPI anomaly detection experiments">
      <div className="mb-4"><OrionNav current="/retail/kpi-anomaly/orion/experiments" basePath="/retail/kpi-anomaly/orion" /></div>

      {/* KPI summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Experiments Run"  value={anomalyModels.length} />
        <KpiCard label="Deployed"         value={deployedCount} color={deployedCount > 0 ? "green" : "default"} />
        <KpiCard label="Latest Anomalies" value={latestModel?.modelWeights?.summary?.totalAnomalies?.toLocaleString() ?? "—"} color="amber" />
        <KpiCard label="Latest KPIs"      value={latestModel?.modelWeights?.summary?.kpisProcessed?.length ?? "—"} color="blue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* ── LEFT: Run Panel ──────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <FlaskConical className="w-4 h-4" /> New Experiment
            </h3>

            <div className="space-y-3">
              {/* Dataset selector */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Dataset</Label>
                <select
                  className="w-full border rounded px-3 py-1.5 text-sm bg-background"
                  value={selectedDatasetId}
                  onChange={e => setSelectedDatasetId(e.target.value)}
                  data-testid="select-dataset"
                >
                  <option value="">Select a dataset…</option>
                  {trainableDatasets.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name} ({d.rowCount.toLocaleString()} rows)</option>
                  ))}
                </select>
                {trainableDatasets.length === 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                    <Database className="w-3 h-3" /> Upload a dataset in the Data tab first.
                  </p>
                )}
              </div>

              {/* Run name */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Run Name (optional)</Label>
                <Input
                  placeholder="e.g. KPI Anomaly Q1 2024"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="text-sm h-8"
                  data-testid="input-run-name"
                />
              </div>

              {/* Date column */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Date Column</Label>
                <Input
                  placeholder="Week_Start_Date"
                  value={dateCol}
                  onChange={e => setDateCol(e.target.value)}
                  className="text-sm h-8 font-mono"
                  data-testid="input-date-col"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Column containing weekly date values</p>
              </div>

              {/* Algorithm info */}
              <div className="border rounded p-3 bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-semibold">Isolation Forest</span>
                  <Badge variant="secondary" className="text-[9px] h-4">Auto</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Unsupervised anomaly detection with SHAP explainability. Detects statistical outliers across all numeric KPI columns automatically.
                </p>
              </div>

              {/* Progress / run button */}
              {isRunning && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Running anomaly detection…</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              <Button
                className="w-full gap-2"
                onClick={handleRun}
                disabled={isRunning || !selectedDatasetId}
                data-testid="button-run-experiment"
              >
                {isRunning ? (
                  <><Activity className="w-4 h-4 animate-pulse" /> Detecting…</>
                ) : (
                  <><FlaskConical className="w-4 h-4" /> Run Detection</>
                )}
              </Button>
            </div>
          </div>

          {/* Anomaly Rate chart */}
          {chartData.length > 0 && (
            <div className="border rounded-lg p-4 bg-card">
              <h3 className="text-xs font-semibold mb-3 text-muted-foreground uppercase">Anomaly Rate History</h3>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={chartData} margin={{ left: -20 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} unit="%" />
                  <Tooltip formatter={(v: any) => `${v}%`} />
                  <Bar dataKey="anomalyRate" name="Anomaly Rate" radius={[2, 2, 0, 0]}>
                    {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── RIGHT: Results + Model List ──────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">

          {/* Latest result */}
          {visibleResult && (
            <div className="border rounded-lg p-4 bg-card space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <h3 className="text-sm font-semibold">Detection Results</h3>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="border rounded p-3 text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">Total Rows</p>
                  <p className="text-lg font-bold">{asNumber(visibleResult.summary.totalRows)}</p>
                </div>
                <div className="border rounded p-3 text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">Anomalies</p>
                  <p className="text-lg font-bold text-amber-600">{asNumber(visibleResult.summary.totalAnomalies)}</p>
                </div>
                <div className="border rounded p-3 text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">KPIs Analysed</p>
                  <p className="text-lg font-bold text-blue-600">{visibleResult.summary.kpisProcessed.length}</p>
                </div>
              </div>

              {/* Per-KPI breakdown */}
              {resultKpiData.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-2">Anomalies per KPI</p>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={resultKpiData} margin={{ left: -10 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 8 }} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip />
                      <Bar dataKey="anomalies" name="Anomaly Count" radius={[2, 2, 0, 0]}>
                        {resultKpiData.map((_, i) => <Cell key={i} fill={KPI_COLORS[i % KPI_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* KPI list */}
              <div>
                <p className="text-xs font-semibold mb-2">KPIs Processed</p>
                <div className="flex flex-wrap gap-1.5">
                  {visibleResult.summary.kpisProcessed.map(k => (
                    <Badge key={k} variant="secondary" className="text-[10px]">{k}</Badge>
                  ))}
                </div>
              </div>

              {latestResult?.modelId && (
                <Button
                  size="sm" className="gap-1.5"
                  onClick={() => deployMut.mutate(latestResult.modelId!)}
                  disabled={deployMut.isPending}
                  data-testid="button-deploy-latest"
                >
                  <Rocket className="w-3.5 h-3.5" /> Deploy This Model
                </Button>
              )}
            </div>
          )}

          {/* Experiment history */}
          <div className="border rounded-lg bg-card">
            <div className="p-3 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold">Experiment History</h3>
              <Badge variant="outline">{anomalyModels.length}</Badge>
            </div>

            {anomalyModels.length === 0 ? (
              <p className="text-xs text-muted-foreground p-6 text-center">No experiments yet. Run your first detection above.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {["Name", "Status", "Anomalies", "Rows", "KPIs", "Trained", "Actions"].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...anomalyModels].reverse().map(m => {
                      const s = m.modelWeights?.summary;
                      return (
                        <tr key={m.id} className="border-b hover:bg-muted/10" data-testid={`row-model-${m.id}`}>
                          <td className="px-3 py-2">
                            <p className="font-medium max-w-[160px] truncate">{m.name}</p>
                            <p className="text-[9px] text-muted-foreground">ID: {m.id}</p>
                          </td>
                          <td className="px-3 py-2"><StatusBadge status={m.isDeployed ? "deployed" : m.status} /></td>
                          <td className="px-3 py-2 font-mono text-amber-600 font-bold">{s?.totalAnomalies?.toLocaleString() ?? "—"}</td>
                          <td className="px-3 py-2 font-mono">{s?.totalRows?.toLocaleString() ?? "—"}</td>
                          <td className="px-3 py-2 font-mono">{s?.kpisProcessed?.length ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                            {m.trainedAt ? new Date(m.trainedAt).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              {m.isDeployed ? (
                                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                                  onClick={() => undeployMut.mutate(m.id)} disabled={undeployMut.isPending}
                                  data-testid={`button-undeploy-${m.id}`}>
                                  Undeploy
                                </Button>
                              ) : (
                                <Button size="sm" className="h-6 text-[10px] px-2 gap-1"
                                  onClick={() => deployMut.mutate(m.id)} disabled={deployMut.isPending}
                                  data-testid={`button-deploy-${m.id}`}>
                                  <Rocket className="w-3 h-3" /> Deploy
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-red-500 hover:text-red-600"
                                onClick={() => setDeleteTarget(m)}
                                data-testid={`button-delete-${m.id}`}>
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
      </div>

      {/* Delete confirm dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete experiment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and all associated data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              disabled={deleteMut.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OrionLayout>
  );
}
