// import { useState } from "react";
// import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
// import { apiRequest } from "@/lib/queryClient";
// import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
// import { Button } from "@/components/ui/button";
// import { Badge } from "@/components/ui/badge";
// import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
// import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
// import { useToast } from "@/hooks/use-toast";
// import { Trash2, PlayCircle, StopCircle, Target, CheckCircle, XCircle, AlertTriangle, Activity, TrendingUp, TrendingDown, ShieldCheck, Send } from "lucide-react";
// import type { MlModel } from "@shared/schema";

// function DriftBar({ label, value, threshold, color = "amber" }: { label: string; value: number; threshold: number; color?: "green" | "amber" | "red" }) {
//   const pct = Math.min(value * 100, 100);
//   const barColor = value < threshold * 0.5 ? "bg-emerald-500" : value < threshold ? "bg-amber-500" : "bg-red-500";
//   return (
//     <div className="space-y-0.5">
//       <div className="flex justify-between text-[10px]">
//         <span className="text-muted-foreground">{label}</span>
//         <span className={`font-mono font-bold ${value >= threshold ? "text-red-400" : value >= threshold * 0.5 ? "text-amber-400" : "text-emerald-400"}`}>{value.toFixed(3)}</span>
//       </div>
//       <div className="h-2 bg-muted rounded overflow-hidden">
//         <div className={`h-full ${barColor} rounded`} style={{ width: `${pct}%` }} />
//       </div>
//       <div className="flex justify-end">
//         <span className="text-[9px] text-muted-foreground">threshold: {threshold}</span>
//       </div>
//     </div>
//   );
// }

// function getMonitoringStatus(model: MlModel, predCount: number, totalActiveCustomers: number): { status: string; label: string } {
//   if (!model.isDeployed) return { status: "stale", label: "Not Deployed" };
//   if (predCount === 0) return { status: "stale", label: "Stale �� No Predictions" };
//   const coverage = totalActiveCustomers > 0 ? predCount / totalActiveCustomers : 0;
//   if (coverage < 0.3) return { status: "at risk", label: "At Risk �� Low Coverage" };
//   return { status: "healthy", label: "Healthy" };
// }

// export default function OrionDeployPage() {
//   const qc = useQueryClient();
//   const { toast } = useToast();
//   const [scoringModelId, setScoringModelId] = useState<number | null>(null);
//   const [deleteId, setDeleteId] = useState<number | null>(null);
//   const [approvalModel, setApprovalModel] = useState<MlModel | null>(null);
//   const [approvalNotes, setApprovalNotes] = useState("");
//   const [approvalAction, setApprovalAction] = useState<"approve" | "reject">("approve");
//   const [monitorTab, setMonitorTab] = useState<"overview" | "drift" | "coverage">("overview");

//   const { data: modelsRaw = [] } = useQuery<MlModel[]>({ queryKey: ["/api/cpg/promoUplift/models"] });
//   const { data: predictions = [] } = useQuery<any[]>({ queryKey: ["/api/cpg/promoUplift/predictions"] });
//   const { data: custStats } = useQuery<{ total: number; active: number; churned: number }>({ queryKey: ["/api/customers/stats"] });

//   const models = modelsRaw as any[];
//   const deployedModels = models.filter(m => m.isDeployed);
//   const availableModels = models.filter(m => !m.isDeployed && m.status === "trained");
//   const totalPredCount = (predictions as any[]).length;
//   const totalActiveCustomers = custStats?.active ?? 500;

//   function predCountForModel(modelId: number) {
//     return (predictions as any[]).filter((p: any) => p.modelId === modelId).length;
//   }

//   const deployMut = useMutation({
//     mutationFn: (id: number) => apiRequest("POST", `/api/cpg/promoUplift/models/${id}/deploy`, {}),
//     onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/models"] }); toast({ title: "Model deployed" }); },
//     onError: (e: any) => toast({ title: "Deploy failed", description: e.message, variant: "destructive" }),
//   });

//   const undeployMut = useMutation({
//     mutationFn: (id: number) => apiRequest("POST", `/api/cpg/promoUplift/models/${id}/undeploy`, {}),
//     onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/models"] }); toast({ title: "Model undeployed" }); },
//     onError: (e: any) => toast({ title: "Undeploy failed", description: e.message, variant: "destructive" }),
//   });

//   const scoreMut = useMutation({
//     mutationFn: (id: number) => apiRequest("POST", `/api/cpg/promoUplift/models/${id}/predict-customers`, {}),
//     onSuccess: (data: any) => {
//       qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/predictions"] });
//       toast({ title: `Scored ${data.predicted} customers` });
//       setScoringModelId(null);
//     },
//     onError: (e: any) => { toast({ title: "Scoring failed", description: e.message, variant: "destructive" }); setScoringModelId(null); },
//   });

//   const deleteMut = useMutation({
//     mutationFn: (id: number) => apiRequest("DELETE", `/api/cpg/promoUplift/models/${id}`),
//     onSuccess: () => {
//       qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/models"] });
//       qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/predictions"] });
//       toast({ title: "Model deleted" });
//       setDeleteId(null);
//     },
//     onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
//   });

//   const approveMut = useMutation({
//     mutationFn: ({ id, notes, action }: { id: number; notes: string; action: string }) =>
//       apiRequest("POST", `/api/cpg/promoUplift/models/${id}/approve`, { approvedBy: "ml-ops-lead", approvalNotes: notes, action }),
//     onSuccess: () => {
//       qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/models"] });
//       toast({ title: `Model ${approvalAction === "approve" ? "approved" : "rejected"}` });
//       setApprovalModel(null);
//       setApprovalNotes("");
//     },
//     onError: (e: any) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
//   });

//   // Drift metrics (deterministic per model based on AUC/accuracy)
//   function getDriftMetrics(m: any) {
//     const seed = (m.auc || 0.8) * 100;
//     const psi = parseFloat(((1 - (m.auc || 0.8)) * 0.4 + 0.02).toFixed(3));
//     const ks = parseFloat(((m.accuracy || 0.8) * 0.15).toFixed(3));
//     const featureDrift = parseFloat((psi * 1.2).toFixed(3));
//     const targetDrift = parseFloat((ks * 0.8).toFixed(3));
//     const predDrift = parseFloat((psi * 0.9).toFixed(3));
//     const segmentDrift = parseFloat(((1 - (m.recall || 0.8)) * 0.25).toFixed(3));
//     return { psi, ks, featureDrift, targetDrift, predDrift, segmentDrift };
//   }

//   const avgAuc = deployedModels.length
//     ? parseFloat((deployedModels.reduce((s, m) => s + (m.auc || 0), 0) / deployedModels.length).toFixed(4))
//     : 0;

//   const healthyCount = deployedModels.filter(m => getMonitoringStatus(m, predCountForModel(m.id), totalActiveCustomers).status === "healthy").length;
//   const atRiskCount = deployedModels.filter(m => getMonitoringStatus(m, predCountForModel(m.id), totalActiveCustomers).status === "at risk").length;
//   const staleCount = deployedModels.filter(m => getMonitoringStatus(m, predCountForModel(m.id), totalActiveCustomers).status === "stale").length;

//   const deleteTarget = models.find(m => m.id === deleteId);

//   return (
//     <OrionLayout title="Deploy & Scoring" subtitle="Production model management, drift monitoring, and approval workflow">
//       <div className="space-y-4">
//         <OrionNav current="/cpg/promo-uplift/orion/deploy" basePath="/cpg/promo-uplift/orion" />

//         {/* KPI Row */}
//         <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
//           <KpiCard label="Deployed Models" value={deployedModels.length} color="green" testId="kpi-deployed" />
//           <KpiCard label="Healthy" value={healthyCount} color="green" testId="kpi-healthy" />
//           <KpiCard label="At Risk" value={atRiskCount} color={atRiskCount > 0 ? "amber" : "green"} testId="kpi-at-risk" />
//           <KpiCard label="Stale" value={staleCount} color={staleCount > 0 ? "amber" : "green"} testId="kpi-stale" />
//           <KpiCard label="Avg AUC" value={avgAuc ? avgAuc.toFixed(4) : "��"} color="blue" testId="kpi-auc" />
//           <KpiCard label="Total Predictions" value={totalPredCount.toLocaleString()} testId="kpi-predictions" />
//         </div>

//         {/* ── PRODUCTION MODELS ── */}
//         <div className="bg-card border rounded-lg overflow-hidden">
//           <div className="px-4 py-3 border-b flex items-center justify-between">
//             <h3 className="text-sm font-semibold flex items-center gap-2">
//               <CheckCircle className="w-4 h-4 text-emerald-500" />Production Models
//             </h3>
//             <span className="text-[10px] text-muted-foreground">{deployedModels.length} deployed</span>
//           </div>
//           {deployedModels.length === 0 ? (
//             <div className="p-8 text-center text-muted-foreground text-xs">
//               No models deployed. Deploy a model from the available list below.
//             </div>
//           ) : (
//             <div className="overflow-x-auto">
//               <table className="w-full text-xs">
//                 <thead>
//                   <tr className="border-b bg-muted/30">
//                     {["Model", "Algorithm", "AUC", "Accuracy", "Predictions", "Deployed", "Status", "Approval", "Actions"].map(h => (
//                       <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium">{h}</th>
//                     ))}
//                   </tr>
//                 </thead>
//                 <tbody>
//                   {deployedModels.map(m => {
//                     const predCount = predCountForModel(m.id);
//                     const monStatus = getMonitoringStatus(m, predCount, totalActiveCustomers);
//                     return (
//                       <tr key={m.id} className="border-b hover:bg-muted/10" data-testid={`row-deployed-${m.id}`}>
//                         <td className="px-3 py-2 font-medium max-w-[160px] truncate">{m.name}</td>
//                         <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
//                         <td className="px-3 py-2 font-mono font-bold text-primary">{m.auc?.toFixed(4) ?? "��"}</td>
//                         <td className="px-3 py-2 font-mono">{m.accuracy ? `${(m.accuracy * 100).toFixed(1)}%` : "��"}</td>
//                         <td className="px-3 py-2 font-mono">{predCount.toLocaleString()}</td>
//                         <td className="px-3 py-2 text-muted-foreground">{m.deployedAt ? new Date(m.deployedAt).toLocaleDateString() : "��"}</td>
//                         <td className="px-3 py-2"><StatusBadge status={monStatus.label.split(" �� ")[0]} /></td>
//                         <td className="px-3 py-2">
//                           <StatusBadge status={m.approvalStatus === "approved" ? "Approved" : m.approvalStatus === "rejected" ? "Rejected" : "Pending"} />
//                         </td>
//                         <td className="px-3 py-2">
//                           <div className="flex items-center gap-1">
//                             <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-primary/10 hover:text-primary"
//                               onClick={() => { setScoringModelId(m.id); scoreMut.mutate(m.id); }}
//                               disabled={scoreMut.isPending && scoringModelId === m.id}
//                               title="Score customers" data-testid={`button-score-${m.id}`}>
//                               <Target className="w-3 h-3" />
//                             </Button>
//                             <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
//                               onClick={() => { setApprovalModel(m); setApprovalNotes(""); setApprovalAction(m.approvalStatus === "approved" ? "reject" : "approve"); }}
//                               title="Submit for approval" data-testid={`button-approve-${m.id}`}>
//                               <ShieldCheck className="w-3 h-3" />
//                             </Button>
//                             <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
//                               onClick={() => undeployMut.mutate(m.id)} title="Undeploy"
//                               data-testid={`button-undeploy-${m.id}`}>
//                               <StopCircle className="w-3 h-3" />
//                             </Button>
//                             <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
//                               onClick={() => setDeleteId(m.id)} title="Delete"
//                               data-testid={`button-delete-deployed-${m.id}`}>
//                               <Trash2 className="w-3 h-3" />
//                             </Button>
//                           </div>
//                         </td>
//                       </tr>
//                     );
//                   })}
//                 </tbody>
//               </table>
//             </div>
//           )}
//         </div>

//         {/* ── MONITORING ── */}
//         {deployedModels.length > 0 && (
//           <div className="bg-card border rounded-lg overflow-hidden">
//             <div className="px-4 py-3 border-b flex items-center justify-between">
//               <h3 className="text-sm font-semibold flex items-center gap-2">
//                 <Activity className="w-4 h-4 text-blue-500" />Model Monitoring
//               </h3>
//               <div className="flex gap-1">
//                 {(["overview", "drift", "coverage"] as const).map(t => (
//                   <button key={t} onClick={() => setMonitorTab(t)} data-testid={`tab-monitor-${t}`}
//                     className={`px-3 py-1 text-[10px] rounded font-medium transition-colors ${monitorTab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
//                     {t.charAt(0).toUpperCase() + t.slice(1)}
//                   </button>
//                 ))}
//               </div>
//             </div>

//             {monitorTab === "overview" && (
//               <div className="p-4">
//                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
//                   {deployedModels.map(m => {
//                     const predCount = predCountForModel(m.id);
//                     const monStatus = getMonitoringStatus(m, predCount, totalActiveCustomers);
//                     const drift = getDriftMetrics(m);
//                     const coverage = totalActiveCustomers > 0 ? ((predCount / totalActiveCustomers) * 100).toFixed(1) : "0.0";
//                     const driftAlert = drift.psi > 0.2 || drift.featureDrift > 0.25;
//                     return (
//                       <div key={m.id} className="border rounded-lg p-4 space-y-2" data-testid={`card-monitor-${m.id}`}>
//                         <div className="flex items-start justify-between">
//                           <div>
//                             <p className="text-xs font-semibold truncate max-w-[180px]">{m.name}</p>
//                             <p className="text-[10px] text-muted-foreground">{m.algorithm}</p>
//                           </div>
//                           <StatusBadge status={monStatus.label.split(" �� ")[0]} />
//                         </div>
//                         <div className="grid grid-cols-3 gap-2 text-center">
//                           <div className="bg-muted/30 rounded p-2">
//                             <p className="text-[10px] text-muted-foreground">AUC</p>
//                             <p className="text-sm font-mono font-bold text-primary">{m.auc?.toFixed(4)}</p>
//                           </div>
//                           <div className="bg-muted/30 rounded p-2">
//                             <p className="text-[10px] text-muted-foreground">Predictions</p>
//                             <p className="text-sm font-mono font-bold">{predCount.toLocaleString()}</p>
//                           </div>
//                           <div className="bg-muted/30 rounded p-2">
//                             <p className="text-[10px] text-muted-foreground">Coverage</p>
//                             <p className="text-sm font-mono font-bold">{coverage}%</p>
//                           </div>
//                         </div>
//                         {driftAlert && (
//                           <div className="flex items-center gap-1.5 text-[10px] text-amber-500 bg-amber-500/10 rounded px-2 py-1">
//                             <AlertTriangle className="w-3 h-3 shrink-0" />
//                             Drift detected �� PSI {drift.psi.toFixed(3)} (threshold: 0.20)
//                           </div>
//                         )}
//                         {m.approvalStatus === "approved" && (
//                           <div className="flex items-center gap-1.5 text-[10px] text-emerald-500 bg-emerald-500/10 rounded px-2 py-1">
//                             <ShieldCheck className="w-3 h-3 shrink-0" />
//                             Approved by {m.approvedBy} on {m.approvedAt ? new Date(m.approvedAt).toLocaleDateString() : "��"}
//                           </div>
//                         )}
//                       </div>
//                     );
//                   })}
//                 </div>
//               </div>
//             )}

//             {monitorTab === "drift" && (
//               <div className="p-4 space-y-6">
//                 {deployedModels.map(m => {
//                   const drift = getDriftMetrics(m);
//                   return (
//                     <div key={m.id} className="space-y-3">
//                       <div className="flex items-center gap-2">
//                         <p className="text-xs font-semibold">{m.name}</p>
//                         <span className="text-muted-foreground text-[10px]">�� {m.algorithm}</span>
//                       </div>
//                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
//                         <div className="space-y-2">
//                           <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Distribution Drift</p>
//                           <DriftBar label="PSI (Population Stability)" value={drift.psi} threshold={0.2} />
//                           <DriftBar label="KS Statistic" value={drift.ks} threshold={0.1} />
//                           <DriftBar label="Feature Drift Score" value={drift.featureDrift} threshold={0.25} />
//                         </div>
//                         <div className="space-y-2">
//                           <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Prediction Drift</p>
//                           <DriftBar label="Target Drift" value={drift.targetDrift} threshold={0.15} />
//                           <DriftBar label="Prediction Distribution Drift" value={drift.predDrift} threshold={0.2} />
//                           <DriftBar label="Segment Drift" value={drift.segmentDrift} threshold={0.1} />
//                         </div>
//                       </div>
//                     </div>
//                   );
//                 })}
//               </div>
//             )}

//             {monitorTab === "coverage" && (
//               <div className="p-4">
//                 <div className="space-y-3">
//                   <p className="text-[10px] text-muted-foreground">Prediction coverage of active customer base ({totalActiveCustomers.toLocaleString()} active customers). Total predictions in system: <strong className="text-foreground">{totalPredCount.toLocaleString()}</strong></p>
//                   {deployedModels.map(m => {
//                     const predCount = predCountForModel(m.id);
//                     const pct = totalActiveCustomers > 0 ? (predCount / totalActiveCustomers) * 100 : 0;
//                     const highRisk = (predictions as any[]).filter((p: any) => p.modelId === m.id && p.riskCategory === "high").length;
//                     const medRisk = (predictions as any[]).filter((p: any) => p.modelId === m.id && p.riskCategory === "medium").length;
//                     const lowRisk = predCount - highRisk - medRisk;
//                     return (
//                       <div key={m.id} className="space-y-1.5" data-testid={`coverage-${m.id}`}>
//                         <div className="flex justify-between text-xs">
//                           <span className="font-medium truncate max-w-[200px]">{m.name}</span>
//                           <div className="flex gap-3 text-[10px] text-muted-foreground">
//                             <span className="text-red-400">{highRisk} high</span>
//                             <span className="text-amber-400">{medRisk} med</span>
//                             <span className="text-emerald-400">{lowRisk} low</span>
//                             <span className="font-mono font-bold text-foreground">{predCount.toLocaleString()} total</span>
//                           </div>
//                         </div>
//                         <div className="flex gap-px h-4 rounded overflow-hidden">
//                           {predCount > 0 && (
//                             <>
//                               <div className="bg-red-500/70" style={{ flex: highRisk }} />
//                               <div className="bg-amber-500/70" style={{ flex: medRisk }} />
//                               <div className="bg-emerald-500/70" style={{ flex: lowRisk }} />
//                             </>
//                           )}
//                           {predCount === 0 && <div className="flex-1 bg-muted" />}
//                         </div>
//                         <div className="flex justify-between text-[9px] text-muted-foreground">
//                           <span>Coverage: {pct.toFixed(1)}% of {totalActiveCustomers} active customers ({predCount} scored)</span>
//                           {predCount === 0 && <span className="text-amber-400">Run scoring to generate predictions</span>}
//                         </div>
//                       </div>
//                     );
//                   })}
//                 </div>
//               </div>
//             )}
//           </div>
//         )}

//         {/* ── AVAILABLE TO DEPLOY ── */}
//         <div className="bg-card border rounded-lg overflow-hidden">
//           <div className="px-4 py-3 border-b">
//             <h3 className="text-sm font-semibold">Available to Deploy</h3>
//             <p className="text-[10px] text-muted-foreground mt-0.5">{availableModels.length} trained models ready for deployment</p>
//           </div>
//           {availableModels.length === 0 ? (
//             <div className="p-8 text-center text-muted-foreground text-xs">
//               No trained models available. Train a model in the Experiments page.
//               <div className="mt-2">
//                 <a href="/orion/experiments" className="text-primary underline text-xs">Go to Experiments →</a>
//               </div>
//             </div>
//           ) : (
//             <div className="overflow-x-auto">
//               <table className="w-full text-xs">
//                 <thead>
//                   <tr className="border-b bg-muted/30">
//                     {["Model", "Algorithm", "AUC", "F1", "Accuracy", "Trained", "Approval", "Actions"].map(h => (
//                       <th key={h} className="text-left px-3 py-2 text-muted-foreground">{h}</th>
//                     ))}
//                   </tr>
//                 </thead>
//                 <tbody>
//                   {availableModels.map(m => (
//                     <tr key={m.id} className="border-b hover:bg-muted/10" data-testid={`row-available-${m.id}`}>
//                       <td className="px-3 py-2 font-medium max-w-[160px] truncate">{m.name}</td>
//                       <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
//                       <td className="px-3 py-2 font-mono font-bold text-primary">{m.auc?.toFixed(4) ?? "��"}</td>
//                       <td className="px-3 py-2 font-mono">{m.f1Score?.toFixed(4) ?? "��"}</td>
//                       <td className="px-3 py-2 font-mono">{m.accuracy ? `${(m.accuracy * 100).toFixed(1)}%` : "��"}</td>
//                       <td className="px-3 py-2 text-muted-foreground">{m.trainedAt ? new Date(m.trainedAt).toLocaleDateString() : "��"}</td>
//                       <td className="px-3 py-2">
//                         <StatusBadge status={m.approvalStatus === "approved" ? "Approved" : m.approvalStatus === "rejected" ? "Rejected" : "Pending"} />
//                       </td>
//                       <td className="px-3 py-2">
//                         <div className="flex gap-1">
//                           <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-emerald-500/10 hover:text-emerald-500"
//                             onClick={() => deployMut.mutate(m.id)} title="Deploy"
//                             data-testid={`button-deploy-${m.id}`}>
//                             <PlayCircle className="w-3 h-3" />
//                           </Button>
//                           <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
//                             onClick={() => { setApprovalModel(m); setApprovalNotes(""); setApprovalAction("approve"); }}
//                             title="Submit for approval" data-testid={`button-request-approval-${m.id}`}>
//                             <Send className="w-3 h-3" />
//                           </Button>
//                           <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
//                             onClick={() => setDeleteId(m.id)} title="Delete"
//                             data-testid={`button-delete-available-${m.id}`}>
//                             <Trash2 className="w-3 h-3" />
//                           </Button>
//                         </div>
//                       </td>
//                     </tr>
//                   ))}
//                 </tbody>
//               </table>
//             </div>
//           )}
//         </div>

//         {/* ── ALL MODELS (monitoring table) ── */}
//         {models.filter(m => m.status !== "training").length > 0 && (
//           <div className="bg-card border rounded-lg overflow-hidden">
//             <div className="px-4 py-3 border-b">
//               <h3 className="text-sm font-semibold">All Models �� Monitoring Overview</h3>
//             </div>
//             <div className="overflow-x-auto">
//               <table className="w-full text-xs">
//                 <thead>
//                   <tr className="border-b bg-muted/30">
//                     {["Model", "Algorithm", "Deployed", "AUC", "Predictions", "Monitor Status", "Approval", "Actions"].map(h => (
//                       <th key={h} className="text-left px-3 py-2 text-muted-foreground">{h}</th>
//                     ))}
//                   </tr>
//                 </thead>
//                 <tbody>
//                   {models.filter(m => m.status !== "training").map(m => {
//                     const predCount = predCountForModel(m.id);
//                     const monStatus = getMonitoringStatus(m, predCount, totalActiveCustomers);
//                     return (
//                       <tr key={m.id} className="border-b hover:bg-muted/10" data-testid={`row-monitor-${m.id}`}>
//                         <td className="px-3 py-2 font-medium max-w-[140px] truncate">{m.name}</td>
//                         <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
//                         <td className="px-3 py-2">
//                           {m.isDeployed
//                             ? <span className="text-emerald-500 font-medium">Yes</span>
//                             : <span className="text-muted-foreground">No</span>}
//                         </td>
//                         <td className="px-3 py-2 font-mono">{m.auc?.toFixed(4) ?? "��"}</td>
//                         <td className="px-3 py-2 font-mono">{predCount.toLocaleString()}</td>
//                         <td className="px-3 py-2"><StatusBadge status={monStatus.label.split(" �� ")[0]} /></td>
//                         <td className="px-3 py-2">
//                           <StatusBadge status={m.approvalStatus === "approved" ? "Approved" : m.approvalStatus === "rejected" ? "Rejected" : "Pending"} />
//                         </td>
//                         <td className="px-3 py-2">
//                           <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
//                             onClick={() => setDeleteId(m.id)} data-testid={`button-delete-monitor-${m.id}`}>
//                             <Trash2 className="w-3 h-3" />
//                           </Button>
//                         </td>
//                       </tr>
//                     );
//                   })}
//                 </tbody>
//               </table>
//             </div>
//           </div>
//         )}
//       </div>

//       {/* Delete Dialog */}
//       <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
//         <AlertDialogContent>
//           <AlertDialogHeader>
//             <AlertDialogTitle>Delete Model</AlertDialogTitle>
//             <AlertDialogDescription>
//               Delete <strong>{deleteTarget?.name}</strong>? All associated predictions will also be removed. This cannot be undone.
//             </AlertDialogDescription>
//           </AlertDialogHeader>
//           <AlertDialogFooter>
//             <AlertDialogCancel>Cancel</AlertDialogCancel>
//             <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
//               onClick={() => deleteId && deleteMut.mutate(deleteId)}>
//               Delete Model
//             </AlertDialogAction>
//           </AlertDialogFooter>
//         </AlertDialogContent>
//       </AlertDialog>

//       {/* Approval Dialog */}
//       <Dialog open={!!approvalModel} onOpenChange={() => setApprovalModel(null)}>
//         <DialogContent>
//           <DialogHeader>
//             <DialogTitle className="flex items-center gap-2">
//               <ShieldCheck className="w-4 h-4 text-primary" />Model Approval
//             </DialogTitle>
//           </DialogHeader>
//           <div className="space-y-4">
//             <div className="bg-muted/30 rounded p-3 space-y-1 text-xs">
//               <div className="flex justify-between"><span className="text-muted-foreground">Model</span><span className="font-medium">{approvalModel?.name}</span></div>
//               <div className="flex justify-between"><span className="text-muted-foreground">Algorithm</span><span>{approvalModel?.algorithm}</span></div>
//               <div className="flex justify-between"><span className="text-muted-foreground">AUC</span><span className="font-mono text-primary">{approvalModel?.auc?.toFixed(4)}</span></div>
//               <div className="flex justify-between"><span className="text-muted-foreground">Current Status</span><StatusBadge status={approvalModel?.approvalStatus === "approved" ? "Approved" : approvalModel?.approvalStatus === "rejected" ? "Rejected" : "Pending"} /></div>
//             </div>
//             <div className="flex gap-2">
//               <button onClick={() => setApprovalAction("approve")}
//                 className={`flex-1 py-2 rounded text-xs font-medium border transition-colors ${approvalAction === "approve" ? "bg-emerald-500 text-white border-emerald-500" : "border-border text-muted-foreground hover:bg-muted/20"}`}
//                 data-testid="button-approval-approve">
//                 ✓ Approve
//               </button>
//               <button onClick={() => setApprovalAction("reject")}
//                 className={`flex-1 py-2 rounded text-xs font-medium border transition-colors ${approvalAction === "reject" ? "bg-red-500 text-white border-red-500" : "border-border text-muted-foreground hover:bg-muted/20"}`}
//                 data-testid="button-approval-reject">
//                 ✗ Reject
//               </button>
//             </div>
//             <div>
//               <label className="text-[10px] text-muted-foreground uppercase">Notes (optional)</label>
//               <textarea
//                 className="mt-1 w-full text-xs bg-background border rounded px-2 py-1.5 resize-none"
//                 rows={3}
//                 placeholder="Add approval notes, conditions, or rejection reason..."
//                 value={approvalNotes}
//                 onChange={e => setApprovalNotes(e.target.value)}
//                 data-testid="input-approval-notes"
//               />
//             </div>
//           </div>
//           <DialogFooter>
//             <Button variant="outline" size="sm" onClick={() => setApprovalModel(null)}>Cancel</Button>
//             <Button size="sm"
//               className={approvalAction === "approve" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}
//               onClick={() => approvalModel && approveMut.mutate({ id: approvalModel.id, notes: approvalNotes, action: approvalAction })}
//               disabled={approveMut.isPending}
//               data-testid="button-submit-approval">
//               {approvalAction === "approve" ? "Approve Model" : "Reject Model"}
//             </Button>
//           </DialogFooter>
//         </DialogContent>
//       </Dialog>
//     </OrionLayout>
//   );
// }
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { OrionLayout, KpiCard, StatusBadge, OrionNav } from "@/components/orion-layout";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Trash2, PlayCircle, StopCircle, CheckCircle, XCircle, AlertTriangle, Activity, TrendingUp, TrendingDown, ShieldCheck, Send, Sparkles, Brain, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { MlModel } from "@shared/schema";

const PROMO_COLORS = ["#FFD822","#3b82f6","#a78bfa","#f97316","#22c55e","#ec4899","#14b8a6","#f43f5e","#84cc16","#06b6d4","#8b5cf6","#fb923c","#34d399","#60a5fa","#c084fc"];
const CUSTOM_TOOLTIP_STYLE = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "10px" };

function getPromoData(m: any) {
  const summary = (m.modelWeights?.summary) || {};
  const metrics = summary.metrics || {};
  return {
    r2:           metrics.r2   as number | undefined,
    rmse:         metrics.rmse as number | undefined,
    mae:          metrics.mae  as number | undefined,
    rowCount:     summary.rowCount    as number | undefined,
    featureCount: summary.featureCount as number | undefined,
    promoColumns: (summary.promoColumnsUsed || []) as string[],
    promoSummary: (summary.promoSummary || {}) as Record<string, any>,
    totals:       (summary.totals || {}) as Record<string, any>,
  };
}

function getPromoStatus(m: any) {
  if (!m.isDeployed) return { status: "stale", label: "Not Deployed" };
  const r2 = getPromoData(m).r2 ?? m.auc ?? 0;
  if (r2 >= 0.7) return { status: "healthy", label: "Healthy" };
  if (r2 >= 0.4) return { status: "at risk", label: "At Risk" };
  return { status: "stale", label: "Low R²" };
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "high") return <span className="text-[9px] px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-700 font-medium">High</span>;
  if (severity === "medium") return <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 font-medium">Medium</span>;
  return <span className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground font-medium">Low</span>;
}

function InsightCard({ rec }: { rec: any }) {
  const border = rec.severity === "high" ? "border-red-500/35 bg-red-500/5" : rec.severity === "medium" ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card";
  const Icon = rec.icon === "trend-up" ? ArrowUpRight : rec.icon === "trend-down" ? TrendingDown : rec.icon === "sparkle" ? Sparkles : rec.icon === "shield" ? ShieldCheck : AlertTriangle;
  const iconColor = rec.severity === "high" ? "text-red-600" : rec.severity === "medium" ? "text-amber-600" : "text-muted-foreground";
  return (
    <div className={`border rounded-lg p-4 space-y-2 ${border}`} data-testid={`rec-card-${rec.id}`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${iconColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-semibold">{rec.title}</span>
            <SeverityBadge severity={rec.severity} />
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">{rec.category}</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{rec.detail}</p>
        </div>
      </div>
      {rec.action && (
        <div className="ml-7 border border-dashed border-primary/20 rounded px-3 py-2 bg-primary/5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Recommended Action</p>
          <p className="text-xs text-foreground">{rec.action}</p>
        </div>
      )}
    </div>
  );
}

function generateInsights(m: any): any[] {
  const { r2, rmse, promoSummary, promoColumns } = getPromoData(m);
  const r2Val = r2 ?? m.auc ?? 0;
  const recs: any[] = [];
  if (r2Val < 0.4) {
    recs.push({ id: "r2_low", severity: "high", category: "Model Fit", icon: "shield",
      title: "Low R² — Model Fit Needs Improvement",
      detail: `R² of ${r2Val.toFixed(4)} means the model explains less than 40% of sales variance. Uplift estimates may be unreliable.`,
      action: "Check for outliers in sales_units, verify price/competitor prices are populated, and consider adding more control variables." });
  } else if (r2Val < 0.7) {
    recs.push({ id: "r2_med", severity: "medium", category: "Model Fit", icon: "sparkle",
      title: "Moderate R² — Room for Improvement",
      detail: `R² of ${r2Val.toFixed(4)} is acceptable but could be stronger. Additional control features may improve precision.`,
      action: "Add store fixed effects, competitor price ratios, or lagged sales as additional control variables." });
  } else {
    recs.push({ id: "r2_good", severity: "low", category: "Model Fit", icon: "shield",
      title: "Strong Model Fit",
      detail: `R² of ${r2Val.toFixed(4)} — the model explains a high proportion of sales variance and uplift estimates are reliable.`,
      action: "Schedule quarterly retraining to keep the model aligned with evolving market dynamics." });
  }
  const mechanics = Object.entries(promoSummary);
  if (mechanics.length > 0) {
    const sorted = [...mechanics].sort((a: any, b: any) => (b[1].totalUpliftUnits || 0) - (a[1].totalUpliftUnits || 0));
    const [bestMech, bestStats] = sorted[0] as [string, any];
    recs.push({ id: "best_promo", severity: "low", category: "Promo Effectiveness", icon: "trend-up",
      title: `Best Performer: ${bestMech}`,
      detail: `${bestMech} delivers the highest total uplift of ${(bestStats.totalUpliftUnits || 0).toFixed(0)} units across ${bestStats.activeRows || 0} active rows (avg ${((bestStats.avgPctUplift || 0) * 100).toFixed(1)}% lift).`,
      action: `Prioritise ${bestMech} in upcoming promotions. Analyse store/region breakdown to identify highest-ROI zones.` });
    const [worstMech, worstStats] = sorted[sorted.length - 1] as [string, any];
    if (sorted.length > 1 && (worstStats.totalUpliftUnits || 0) < (bestStats.totalUpliftUnits || 0) * 0.1) {
      recs.push({ id: "weak_promo", severity: "medium", category: "Promo Effectiveness", icon: "trend-down",
        title: `Low Impact: ${worstMech}`,
        detail: `${worstMech} delivers only ${(worstStats.totalUpliftUnits || 0).toFixed(0)} units of uplift — significantly below the top performer.`,
        action: `Review ${worstMech} deployment strategy. Evaluate whether trade spend is justified given low incremental volume.` });
    }
  }
  if (promoColumns.length > 8) {
    recs.push({ id: "many_promos", severity: "low", category: "Coverage", icon: "sparkle",
      title: `${promoColumns.length} Promo Mechanics Active`,
      detail: `The model detected and evaluated ${promoColumns.length} active promo mechanics. Comprehensive coverage enables robust portfolio-level ROI analysis.`,
      action: "Use the ROI calculator to assign trade spend per mechanic and compare incremental revenue vs. cost." });
  }
  if (rmse != null && rmse > 50) {
    recs.push({ id: "rmse_high", severity: "medium", category: "Model Fit", icon: "sparkle",
      title: "High Prediction Error (RMSE)",
      detail: `RMSE of ${rmse.toFixed(1)} units indicates large prediction errors. Outlier rows or missing features may be driving this.`,
      action: "Filter extreme sales_units outliers and verify that all numeric columns are correctly populated before re-training." });
  }
  return recs.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity as string] ?? 3) - ({ high: 0, medium: 1, low: 2 }[b.severity as string] ?? 3));
}

export default function OrionDeployPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [approvalModel, setApprovalModel] = useState<MlModel | null>(null);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [approvalAction, setApprovalAction] = useState<"approve" | "reject">("approve");
  const [monitorModelId, setMonitorModelId] = useState<number | null>(null);
  const [monitorTab, setMonitorTab] = useState<"health" | "trends" | "drivers" | "insights">("health");

  const { data: modelsRaw = [] } = useQuery<MlModel[]>({ queryKey: ["/api/cpg/promoUplift/models"] });

  const models = modelsRaw as any[];
  const deployedModels = models.filter(m => m.isDeployed);
  const availableModels = models.filter(m => !m.isDeployed && m.status === "trained");

  const activeMonitorId = monitorModelId ?? deployedModels[0]?.id ?? null;
  const activeMonitorModel = models.find(m => m.id === activeMonitorId);
  const activePromoData = activeMonitorModel ? getPromoData(activeMonitorModel) : null;

  const deployMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/cpg/promoUplift/models/${id}/deploy`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/models"] }); toast({ title: "Model deployed" }); },
    onError: (e: any) => toast({ title: "Deploy failed", description: e.message, variant: "destructive" }),
  });

  const undeployMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/cpg/promoUplift/models/${id}/undeploy`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/models"] }); toast({ title: "Model undeployed" }); },
    onError: (e: any) => toast({ title: "Undeploy failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/cpg/promoUplift/models/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/models"] });
      toast({ title: "Model deleted" });
      setDeleteId(null);
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const approveMut = useMutation({
    mutationFn: ({ id, notes, action }: { id: number; notes: string; action: string }) =>
      apiRequest("POST", `/api/cpg/promoUplift/models/${id}/approve`, { approvedBy: "ml-ops-lead", approvalNotes: notes, action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cpg/promoUplift/models"] });
      toast({ title: `Model ${approvalAction === "approve" ? "approved" : "rejected"}` });
      setApprovalModel(null);
      setApprovalNotes("");
    },
    onError: (e: any) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const avgR2 = deployedModels.length
    ? parseFloat((deployedModels.reduce((s, m) => s + (getPromoData(m).r2 ?? m.auc ?? 0), 0) / deployedModels.length).toFixed(4))
    : 0;
  const healthyCount = deployedModels.filter(m => getPromoStatus(m).status === "healthy").length;
  const atRiskCount  = deployedModels.filter(m => getPromoStatus(m).status === "at risk").length;
  const staleCount   = deployedModels.filter(m => getPromoStatus(m).status === "stale").length;
  const deleteTarget = models.find(m => m.id === deleteId);

  const promoChartData = activePromoData
    ? Object.entries(activePromoData.promoSummary)
        .map(([name, stats]: [string, any]) => ({
          name,
          totalUplift: parseFloat((stats.totalUpliftUnits || 0).toFixed(1)),
          avgPctUplift: parseFloat(((stats.avgPctUplift || 0) * 100).toFixed(2)),
          activeRows: stats.activeRows || 0,
        }))
        .sort((a, b) => b.totalUplift - a.totalUplift)
    : [];

  return (
    <OrionLayout title="Deploy & Scoring" subtitle="Production model management, uplift monitoring, and AI-powered observability">
      <div className="space-y-4">
        <OrionNav current="/cpg/promo-uplift/orion/deploy" basePath="/cpg/promo-uplift/orion" />

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <KpiCard label="Deployed Models" value={deployedModels.length} color="green" testId="kpi-deployed" />
          <KpiCard label="Healthy" value={healthyCount} color="green" testId="kpi-healthy" />
          <KpiCard label="At Risk" value={atRiskCount} color={atRiskCount > 0 ? "amber" : "green"} testId="kpi-at-risk" />
          <KpiCard label="Stale" value={staleCount} color={staleCount > 0 ? "amber" : "green"} testId="kpi-stale" />
          <KpiCard label="Avg R²" value={avgR2 ? avgR2.toFixed(4) : "—"} color="blue" testId="kpi-r2" />
          <KpiCard label="Promo Runs" value={String(models.filter(m => m.status === "trained").length)} testId="kpi-runs" />
        </div>

        {/* ── PRODUCTION MODELS ── */}
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />Production Models
            </h3>
            <span className="text-[10px] text-muted-foreground">{deployedModels.length} deployed</span>
          </div>
          {deployedModels.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-xs">No models deployed. Deploy a model from the available list below.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {["Model", "Algorithm", "R²", "RMSE", "Promo Cols", "Deployed", "Status", "Approval", "Actions"].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deployedModels.map(m => {
                    const pd = getPromoData(m);
                    const monStatus = getPromoStatus(m);
                    return (
                      <tr key={m.id} className="border-b hover:bg-muted/10" data-testid={`row-deployed-${m.id}`}>
                        <td className="px-3 py-2 font-medium max-w-[160px] truncate">{m.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
                        <td className="px-3 py-2 font-mono font-bold text-primary">{(pd.r2 ?? m.auc)?.toFixed(4) ?? "—"}</td>
                        <td className="px-3 py-2 font-mono">{pd.rmse != null ? pd.rmse.toFixed(3) : "—"}</td>
                        <td className="px-3 py-2 font-mono">{pd.promoColumns.length > 0 ? pd.promoColumns.length : "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.deployedAt ? new Date(m.deployedAt).toLocaleDateString() : "—"}</td>
                        <td className="px-3 py-2"><StatusBadge status={monStatus.label} /></td>
                        <td className="px-3 py-2">
                          <StatusBadge status={m.approvalStatus === "approved" ? "Approved" : m.approvalStatus === "rejected" ? "Rejected" : "Pending"} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
                              onClick={() => { setApprovalModel(m); setApprovalNotes(""); setApprovalAction(m.approvalStatus === "approved" ? "reject" : "approve"); }}
                              title="Approve/reject" data-testid={`button-approve-${m.id}`}>
                              <ShieldCheck className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
                              onClick={() => undeployMut.mutate(m.id)} title="Undeploy" data-testid={`button-undeploy-${m.id}`}>
                              <StopCircle className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
                              onClick={() => setDeleteId(m.id)} title="Delete" data-testid={`button-delete-deployed-${m.id}`}>
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

        {/* ── MODEL OBSERVABILITY ── */}
        {deployedModels.length > 0 && (
          <div className="bg-card border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-500" />
                <h3 className="text-sm font-semibold">Model Observability</h3>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {deployedModels.length > 1 && (
                  <select className="text-[10px] bg-muted border border-border rounded px-2 py-1 text-foreground"
                    value={activeMonitorId ?? ""}
                    onChange={e => { setMonitorModelId(Number(e.target.value)); setMonitorTab("health"); }}
                    data-testid="select-monitor-model">
                    {deployedModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                )}
                <div className="flex gap-1">
                  {(["health","trends","drivers","insights"] as const).map(t => (
                    <button key={t} onClick={() => setMonitorTab(t)} data-testid={`tab-monitor-${t}`}
                      className={`px-3 py-1 text-[10px] rounded font-medium transition-colors ${monitorTab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── HEALTH TAB ── */}
            {monitorTab === "health" && activePromoData && activeMonitorModel && (
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">R² Score</p>
                    <p className={`text-xl font-mono font-bold ${(activePromoData.r2 ?? 0) >= 0.7 ? "text-emerald-700" : (activePromoData.r2 ?? 0) >= 0.4 ? "text-amber-700" : "text-red-600"}`}>
                      {(activePromoData.r2 ?? activeMonitorModel.auc)?.toFixed(4) ?? "—"}
                    </p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">explains variance</p>
                  </div>
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">RMSE</p>
                    <p className="text-xl font-mono font-bold">{activePromoData.rmse?.toFixed(3) ?? "—"}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">avg prediction error</p>
                  </div>
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">MAE</p>
                    <p className="text-xl font-mono font-bold">{activePromoData.mae?.toFixed(3) ?? "—"}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">mean abs error</p>
                  </div>
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">Row Count</p>
                    <p className="text-xl font-mono font-bold">{activePromoData.rowCount?.toLocaleString() ?? "—"}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">training rows</p>
                  </div>
                  <div className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">Promo Mechanics</p>
                    <p className="text-xl font-mono font-bold text-primary">{activePromoData.promoColumns.length}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">active evaluated</p>
                  </div>
                </div>
                {Object.keys(activePromoData.promoSummary).length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 border-b bg-muted/20">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Promo Mechanics — Uplift Summary</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b bg-muted/10">
                            {["Mechanic","Active Rows","Total Uplift Units","Avg % Uplift"].map(h => (
                              <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(activePromoData.promoSummary)
                            .sort((a: any, b: any) => (b[1].totalUpliftUnits || 0) - (a[1].totalUpliftUnits || 0))
                            .map(([mech, stats]: [string, any]) => (
                              <tr key={mech} className="border-b hover:bg-muted/10">
                                <td className="px-3 py-2 font-mono font-semibold text-primary">{mech}</td>
                                <td className="px-3 py-2 font-mono">{(stats.activeRows || 0).toLocaleString()}</td>
                                <td className="px-3 py-2 font-mono font-bold">
                                  <span className={(stats.totalUpliftUnits || 0) >= 0 ? "text-emerald-700" : "text-red-600"}>
                                    {(stats.totalUpliftUnits || 0) >= 0 ? "+" : ""}{(stats.totalUpliftUnits || 0).toFixed(1)}
                                  </span>
                                </td>
                                <td className="px-3 py-2 font-mono">
                                  <span className={(stats.avgPctUplift || 0) >= 0 ? "text-emerald-700" : "text-red-600"}>
                                    {(stats.avgPctUplift || 0) >= 0 ? "+" : ""}{((stats.avgPctUplift || 0) * 100).toFixed(2)}%
                                  </span>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── TRENDS TAB ── */}
            {monitorTab === "trends" && activePromoData && (
              <div className="p-4 space-y-6">
                {promoChartData.length > 0 ? (
                  <>
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-primary" />Total Uplift Units by Promo Mechanic
                      </h4>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={promoChartData} margin={{ top: 8, right: 12, left: 0, bottom: 50 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                          <XAxis dataKey="name" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} angle={-35} textAnchor="end" interval={0} />
                          <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                          <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v: any) => `${(v as number).toFixed(1)} units`} />
                          <Bar dataKey="totalUplift" name="Total Uplift Units" radius={[3,3,0,0]}>
                            {promoChartData.map((_: any, idx: number) => <Cell key={idx} fill={PROMO_COLORS[idx % PROMO_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-blue-400" />Average % Uplift by Promo Mechanic
                      </h4>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={promoChartData} margin={{ top: 8, right: 12, left: 0, bottom: 50 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                          <XAxis dataKey="name" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} angle={-35} textAnchor="end" interval={0} />
                          <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `${v}%`} />
                          <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} formatter={(v: any) => `${(v as number).toFixed(2)}%`} />
                          <Bar dataKey="avgPctUplift" name="Avg % Uplift" radius={[3,3,0,0]}>
                            {promoChartData.map((_: any, idx: number) => <Cell key={idx} fill={PROMO_COLORS[idx % PROMO_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                ) : (
                  <div className="p-8 text-center text-xs text-muted-foreground">No promo mechanics data available for this model.</div>
                )}
              </div>
            )}

            {/* ── DRIVERS TAB ── */}
            {monitorTab === "drivers" && activePromoData && (
              <div className="p-4 space-y-5">
                {promoChartData.length > 0 ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {promoChartData.slice(0, 6).map((d: any, idx: number) => {
                        const maxUplift = promoChartData[0]?.totalUplift || 1;
                        const pct = Math.max(0, Math.min(100, (d.totalUplift / maxUplift) * 100));
                        return (
                          <div key={d.name} className="border rounded-lg p-3 space-y-2" data-testid={`driver-card-${d.name}`}>
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="text-[11px] font-mono font-semibold text-primary">{d.name}</p>
                                <p className="text-[9px] text-muted-foreground">{d.activeRows.toLocaleString()} active rows</p>
                              </div>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 font-bold">#{idx + 1}</span>
                            </div>
                            <div className="h-2 bg-muted rounded overflow-hidden">
                              <div className="h-full rounded bg-primary" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="flex justify-between text-[9px]">
                              <span className="text-muted-foreground">Uplift: <span className="font-mono text-emerald-700 font-bold">{d.totalUplift >= 0 ? "+" : ""}{d.totalUplift.toFixed(1)} units</span></span>
                              <span className="text-muted-foreground font-mono">{d.avgPctUplift >= 0 ? "+" : ""}{d.avgPctUplift.toFixed(2)}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="border border-emerald-500/30 rounded-lg p-3 bg-emerald-500/5">
                        <h5 className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <ArrowUpRight className="w-3 h-3" />Top Performing Mechanics
                        </h5>
                        {promoChartData.filter(d => d.totalUplift > 0).slice(0, 5).map(d => (
                          <div key={d.name} className="flex justify-between text-[10px] py-0.5">
                            <span className="font-mono text-emerald-800">{d.name}</span>
                            <span className="text-emerald-700 font-bold">+{d.totalUplift.toFixed(1)} units</span>
                          </div>
                        ))}
                      </div>
                      <div className="border border-blue-500/30 rounded-lg p-3 bg-blue-500/5">
                        <h5 className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <Brain className="w-3 h-3" />Mechanic Coverage
                        </h5>
                        {promoChartData.map(d => (
                          <div key={d.name} className="flex justify-between text-[10px] py-0.5">
                            <span className="font-mono text-blue-800">{d.name}</span>
                            <span className="text-blue-700 font-medium">{d.activeRows.toLocaleString()} rows</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-8 text-center text-xs text-muted-foreground">No driver data available. Run promo uplift analysis first.</div>
                )}
              </div>
            )}

            {/* ── INSIGHTS TAB ── */}
            {monitorTab === "insights" && activeMonitorModel && (
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2 p-3 rounded-lg border border-blue-500/30 bg-blue-500/5">
                  <Sparkles className="w-4 h-4 text-blue-700 flex-shrink-0" />
                  <p className="text-[11px] text-blue-800">
                    ML Orion analysed promo uplift results, model fit metrics, and mechanic performance to generate these prioritised recommendations.
                  </p>
                </div>
                {generateInsights(activeMonitorModel).map(rec => <InsightCard key={rec.id} rec={rec} />)}
              </div>
            )}
          </div>
        )}

        {/* ── AVAILABLE TO DEPLOY ── */}
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">Available to Deploy</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">{availableModels.length} trained models ready for deployment</p>
          </div>
          {availableModels.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-xs">
              No trained models available. Train a model in the Experiments page.
              <div className="mt-2"><a href="/cpg/promo-uplift/orion/experiments" className="text-primary underline text-xs">Go to Experiments →</a></div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {["Model", "Algorithm", "R²", "RMSE", "Promo Cols", "Trained", "Approval", "Actions"].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {availableModels.map(m => {
                    const pd = getPromoData(m);
                    return (
                      <tr key={m.id} className="border-b hover:bg-muted/10" data-testid={`row-available-${m.id}`}>
                        <td className="px-3 py-2 font-medium max-w-[160px] truncate">{m.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.algorithm}</td>
                        <td className="px-3 py-2 font-mono font-bold text-primary">{(pd.r2 ?? m.auc)?.toFixed(4) ?? "—"}</td>
                        <td className="px-3 py-2 font-mono">{pd.rmse != null ? pd.rmse.toFixed(3) : "—"}</td>
                        <td className="px-3 py-2 font-mono">{pd.promoColumns.length > 0 ? pd.promoColumns.length : "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.trainedAt ? new Date(m.trainedAt).toLocaleDateString() : "—"}</td>
                        <td className="px-3 py-2">
                          <StatusBadge status={m.approvalStatus === "approved" ? "Approved" : m.approvalStatus === "rejected" ? "Rejected" : "Pending"} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-emerald-500/10 hover:text-emerald-500"
                              onClick={() => deployMut.mutate(m.id)} title="Deploy" data-testid={`button-deploy-${m.id}`}>
                              <PlayCircle className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-500"
                              onClick={() => { setApprovalModel(m); setApprovalNotes(""); setApprovalAction("approve"); }}
                              title="Submit for approval" data-testid={`button-request-approval-${m.id}`}>
                              <Send className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
                              onClick={() => setDeleteId(m.id)} title="Delete" data-testid={`button-delete-available-${m.id}`}>
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

      {/* Delete Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Model</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteTarget?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMut.mutate(deleteId)}>
              Delete Model
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Approval Dialog */}
      <Dialog open={!!approvalModel} onOpenChange={() => setApprovalModel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />Model Approval
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-muted/30 rounded p-3 space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Model</span><span className="font-medium">{approvalModel?.name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Algorithm</span><span>{approvalModel?.algorithm}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">R²</span><span className="font-mono text-primary">{approvalModel?.auc?.toFixed(4)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span>
                <StatusBadge status={approvalModel?.approvalStatus === "approved" ? "Approved" : approvalModel?.approvalStatus === "rejected" ? "Rejected" : "Pending"} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setApprovalAction("approve")}
                className={`flex-1 py-2 rounded text-xs font-medium border transition-colors ${approvalAction === "approve" ? "bg-emerald-500 text-white border-emerald-500" : "border-border text-muted-foreground hover:bg-muted/20"}`}
                data-testid="button-approval-approve">✓ Approve</button>
              <button onClick={() => setApprovalAction("reject")}
                className={`flex-1 py-2 rounded text-xs font-medium border transition-colors ${approvalAction === "reject" ? "bg-red-500 text-white border-red-500" : "border-border text-muted-foreground hover:bg-muted/20"}`}
                data-testid="button-approval-reject">✗ Reject</button>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Notes (optional)</label>
              <textarea
                className="mt-1 w-full text-xs bg-background border rounded px-2 py-1.5 resize-none"
                rows={3}
                placeholder="Add approval notes, conditions, or rejection reason..."
                value={approvalNotes}
                onChange={e => setApprovalNotes(e.target.value)}
                data-testid="input-approval-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setApprovalModel(null)}>Cancel</Button>
            <Button size="sm"
              className={approvalAction === "approve" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}
              onClick={() => approvalModel && approveMut.mutate({ id: approvalModel.id, notes: approvalNotes, action: approvalAction })}
              disabled={approveMut.isPending}
              data-testid="button-submit-approval">
              {approvalAction === "approve" ? <><CheckCircle className="w-3.5 h-3.5 mr-1.5" />Approve Model</> : <><XCircle className="w-3.5 h-3.5 mr-1.5" />Reject Model</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OrionLayout>
  );
}

