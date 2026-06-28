import { useState, useEffect } from "react";
import {
  Search,
  Bell,
  FolderOpen,
  Settings,
  LayoutDashboard,
  CheckCircle2,
  FileText,
  Scale,
  Activity,
  Plus,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Eye,
  XCircle,
} from "lucide-react";

// API Services - Yahan humne regenerateSummary add kar liya hai!
import {
  createCase,
  regenerateSummary,
  extractCharges,
  finalizeCharges,
  fetchPrecedents,
} from "../Services/caseService";

// Modular Components
import Step1Input from "../components/CaseFlowSteps/Step1Input";
import Step2Summary from "../components/CaseFlowSteps/Step2Summary";
import Step3Mapping from "../components/CaseFlowSteps/Step3Mapping";
import Step4Precedents from "../components/CaseFlowSteps/Step4Precedents";

const FLOW_STEPS = [
  { id: 1, label: "Case Input", icon: FileText },
  { id: 2, label: "Summary Review", icon: CheckCircle2 },
  { id: 3, label: "Section Mapping", icon: Scale },
  { id: 4, label: "Final Precedents", icon: Activity }
];

export default function NewCaseFlow({ onBack, resumeData }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hydrationLoading, setHydrationLoading] = useState(false); 
  
  const [description, setDescription] = useState("");
  const [summary, setSummary] = useState("");
  const [charges, setCharges] = useState([]);
  const [precedents, setPrecedents] = useState([]);
  const [caseId, setCaseId] = useState(null);

  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [isRawDocOpen, setIsRawDocOpen] = useState(false);
  const [activeHoverModal, setActiveHoverModal] = useState(null); 

  const [userInitials, setUserInitials] = useState("AI");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newIpc, setNewIpc] = useState("");
  const [newBns, setNewBns] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newExplanation, setNewExplanation] = useState("");

  const [rejectModal, setRejectModal] = useState({ open: false, targetSection: null });
  const [rejectionReason, setRejectionReason] = useState("");

  const userId = localStorage.getItem("user_id");
  const BASE_URL = import.meta.env.VITE_API_BASE_URL;

  // Fetch User Initials
  useEffect(() => {
    const fullName = localStorage.getItem("user_name") || "";
    if (fullName.trim()) {
      const parts = fullName.split(" ").filter(Boolean);
      if (parts.length >= 2) {
        setUserInitials((parts[0][0] + parts[1][0]).toUpperCase());
      } else if (parts.length === 1) {
        setUserInitials(parts[0].slice(0, 2).toUpperCase());
      }
    } else {
      const email = localStorage.getItem("user_email") || "AI";
      setUserInitials(email.slice(0, 2).toUpperCase());
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("legalai_token");
    localStorage.removeItem("user_id");
    localStorage.removeItem("user_name");
    localStorage.removeItem("user_email");
    sessionStorage.clear();
    window.location.reload();
  };

  // HYDRATION MATRIX RECOVERY: Restores the state of an existing/incomplete case
  useEffect(() => {
    const hydrateIncompleteCase = async () => {
      // Exit early if there is no case data to resume
      if (!resumeData || !resumeData.id) return;

      try {
        setHydrationLoading(true);
        setCaseId(resumeData.id);

        const cleanBaseUrl = BASE_URL.replace(/\/+$/, "");
        let activeNode = null;

        // Fetch the complete case profile from the backend database
        const directCaseUrl = `${cleanBaseUrl}/api/v1/cases/${resumeData.id}`;
        const directResp = await fetch(directCaseUrl);
        if (directResp.ok) {
          activeNode = await directResp.json();
        }

        // If we successfully retrieved the case data, begin restoring the UI state
        if (activeNode) {
          // Restore the raw input text and the AI/Lawyer summary
          setDescription(activeNode.raw_description || activeNode.description || "");
          const currentValidSummary = activeNode.llm_summary || activeNode.lawyer_approved_summary || "";
          setSummary(currentValidSummary);
          
          const currentStatus = resumeData.status || resumeData.currentStatus;

          // STEP 1: Extract charges from the backend response. 'applicable_charges' is the correct key.
          let rawChargesArray = activeNode.applicable_charges || activeNode.charges || activeNode.draft_charges || [];
          
          // Fallback safety: If charges are somehow missing but a summary exists, try re-extracting them.
          // We only do this if the case isn't fully completed yet to avoid overwriting finished data.
          if (currentStatus !== "completed" && rawChargesArray.length === 0 && currentValidSummary) {
            const rescueData = await extractCharges(resumeData.id, currentValidSummary);
            rawChargesArray = rescueData?.draft_charges || [];
          }

          // Retrieve any unsaved Approve/Reject decisions the user might have made previously from local browser storage
          const localSavedKey = `legalai_cache_case_${resumeData.id}`;
          const localDecisionCache = JSON.parse(localStorage.getItem(localSavedKey) || "{}");

          // STEP 2: Map the raw backend data into the exact format expected by the frontend Table component
          const formattedCharges = Array.isArray(rawChargesArray) 
            ? rawChargesArray.map((c) => {
                const currentSectionCode = c?.ipc_section || c?.section_code || c?.ipc_section_code || "";
                
                // Check if the user previously toggled this specific charge in local storage
                const cachedDecision = localDecisionCache[currentSectionCode];

                return {
                  id: c?.id || null,
                  ipc_section: currentSectionCode || "N/A",
                  bns_equivalent: c?.bns_equivalent || c?.bns_section || "N/A",
                  legal_category: c?.legal_category || "Statutory Check",
                  explanation: c?.explanation || c?.reason || c?.description || "",
                  confidence: c?.confidence || 85,
                  reason: (!c?.is_approved) ? (c?.rejection_reason || c?.explanation || "") : "", 
                  // Prioritize local unsaved decisions, otherwise use the backend's saved approval status
                  is_approved: cachedDecision !== undefined ? cachedDecision : (c?.is_approved !== undefined ? c.is_approved : null)
                };
              })
              // FILTER OUT REJECTED CHARGES: Keep only approved (true) or pending (null)
              .filter((charge) => charge.is_approved === true || charge.is_approved === null)
            : [];
              
          // STEP 3: Globally set the charges in state BEFORE deciding the step.
          // This ensures the table data is populated even if the user jumps straight to Step 4.
          setCharges(formattedCharges);

          // STEP 4: Route the user to the correct UI step based on the case's progress status
          if (currentStatus === "pending_summary_approval") {
            setStep(2);
          } else if (currentStatus === "completed") {
            try {
              // If the case is fully done, fetch precedents and jump straight to Step 4
              const precedentData = await fetchPrecedents(resumeData.id);
              setPrecedents(precedentData?.precedent_cases || []);
            } catch (pErr) {
              console.error("Precedent load failure", pErr);
            }
            setStep(4);
          } else {
            // For pending mapping workflows
            setStep(3);
          }
        }
      } catch (err) {
        console.error("💥 Hydration Track Failure:", err);
      } finally {
        setHydrationLoading(false);
      }
    };

    hydrateIncompleteCase();
  }, [resumeData, BASE_URL]);

  // Logic Handlers
  const toggleChargeStatus = (targetSectionCode, approvalState) => {
    if (!caseId || !targetSectionCode) return;

    if (approvalState === false) {
      setRejectModal({ open: true, targetSection: targetSectionCode });
      return; 
    }

    setCharges(prevCharges => {
      const updatedCharges = prevCharges.map((charge) => 
        charge.ipc_section === targetSectionCode ? { ...charge, is_approved: approvalState, reason: approvalState === true ? null : charge.reason } : charge
      );

      const localSavedKey = `legalai_cache_case_${caseId}`;
      const decisionMap = {};
      updatedCharges.forEach(c => {
        if (c.ipc_section && c.is_approved !== null) {
          decisionMap[c.ipc_section] = c.is_approved;
        }
      });

      localStorage.setItem(localSavedKey, JSON.stringify(decisionMap));
      return updatedCharges;
    });
  };

  const handleRejectConfirm = () => {
    if (!rejectionReason.trim()) return;

    setCharges(prevCharges => {
      const updatedCharges = prevCharges.map((charge) => 
        charge.ipc_section === rejectModal.targetSection 
          ? { ...charge, is_approved: false, reason: rejectionReason } 
          : charge
      );

      const localSavedKey = `legalai_cache_case_${caseId}`;
      const decisionMap = JSON.parse(localStorage.getItem(localSavedKey) || "{}");
      decisionMap[rejectModal.targetSection] = false;
      localStorage.setItem(localSavedKey, JSON.stringify(decisionMap));

      return updatedCharges;
    });

    setRejectModal({ open: false, targetSection: null });
    setRejectionReason("");
  };

  // ✅ THE FIX: DYNAMICALLY SWITCH BETWEEN CREATE & REGENERATE
  const handleGenerateSummary = async () => {
    if (description.trim().length < 100) return;
    try {
      setLoading(true);
      let data;
      // 🔄 If caseId exists, we are REGENERATING. Do not create a new case.
      if (caseId) {
        // You will need to import 'regenerateSummary' at the top of your file
        data = await regenerateSummary(caseId, description);
      } else {
        // 🆕 First time generating, create a new case
        data = await createCase(description, userId);
        setCaseId(data.id);
      }
      setSummary(data.llm_summary || data.lawyer_approved_summary || "");
      setIsEditingSummary(false);
      setStep(2);
    } catch (err) {
      console.error("Generate Summary Network Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveSummary = async () => {
    try {
      setLoading(true); 
      const data = await extractCharges(caseId, summary);
      if (!data?.draft_charges) return;
      const formattedCharges = data.draft_charges.map((c) => ({
        ...c,
        bns_section: c.bns_section || "N/A",
        reason: c.reason || "",
        is_approved: null,
        confidence: c?.confidence || 85
      }));
      setCharges(formattedCharges);
      setStep(3);
    } catch (err) {
      console.error("Approve Summary Network Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizeCharges = async () => {
    if (!allChargesEvaluated) return;

    try {
      setLoading(true);
      const approvedIds = charges.filter((c) => c?.is_approved && c?.id).map((c) => c.id);
      const rejectedData = charges
        .filter((c) => c?.is_approved === false && c?.id)
        .map((c) => ({ id: c.id, reason: c.reason || "No explanation provided" }));

      await finalizeCharges(caseId, approvedIds, rejectedData);
      localStorage.removeItem(`legalai_cache_case_${caseId}`);

      const precedentData = await fetchPrecedents(caseId);
      setPrecedents(precedentData?.precedent_cases || []);
      setStep(4);
    } catch (err) {
      console.error("Finalization Workflow Network Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddManualSection = (e) => {
    e.preventDefault();
    if (!newIpc.trim() || !newExplanation.trim()) return;

    const customRow = {
      ipc_section: newIpc,
      bns_section: newBns || "N/A",
      legal_category: newCategory || "Manual Entry",
      reason: newExplanation,
      confidence: 100, 
      is_approved: true
    };

    setCharges((prev) => {
      const appended = [...prev, customRow];
      const localSavedKey = `legalai_cache_case_${caseId}`;
      const decisionMap = JSON.parse(localStorage.getItem(localSavedKey) || "{}");
      decisionMap[customRow.ipc_section] = true;
      localStorage.setItem(localSavedKey, JSON.stringify(decisionMap));
      return appended;
    });
    setIsModalOpen(false);
  };

  // Derived Variables
  const approvedChargesCount = Array.isArray(charges) ? charges.filter(c => c?.is_approved === true).length : 0;
  const rejectedChargesCount = Array.isArray(charges) ? charges.filter(c => c?.is_approved === false).length : 0;
  const pendingChargesCount = Array.isArray(charges) ? charges.filter(c => c?.is_approved === null).length : 0;
  const allChargesEvaluated = Array.isArray(charges) && charges.length > 0 && charges.every((charge) => charge?.is_approved !== null);

  if (hydrationLoading) {
    return (
      <div className="flex h-screen w-screen bg-[#F8FAFC] items-center justify-center font-sans gap-2.5 text-[#0F172A]">
        <div className="w-5 h-5 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-bold tracking-tight">Reconstituting Mapped Code States and Summaries...</span>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#F8FAFC] font-sans text-[#0F172A] relative overflow-hidden">
      
      {/* Sidebar */}
      <aside className="w-64 bg-[#0F172A] flex flex-col shrink-0 shadow-[4px_0_24px_rgba(15,23,42,0.15)]">
        <div className="p-6 bg-gradient-to-br from-[#0F172A] to-[#1E3A8A] border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600/20 border border-blue-500/30 rounded-xl flex items-center justify-center text-blue-400">
              <Scale size={18} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-white leading-none">
                Legal<span className="text-blue-500">AI</span>
              </h1>
              <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mt-1">Enterprise Node</p>
            </div>
          </div>
        </div>

        <nav className="px-4 flex-1 py-6 space-y-1">
          <button onClick={onBack} className="w-full flex items-center gap-3 px-4 py-3.5 text-[#CBD5E1] hover:text-white hover:bg-slate-800/50 rounded-xl transition font-semibold text-sm text-left">
            <LayoutDashboard size={18} className="text-slate-400" /> Dashboard
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-[#CBD5E1] hover:text-white hover:bg-slate-800/50 rounded-xl transition font-semibold text-sm text-left">
            <FolderOpen size={18} className="text-slate-400" /> Cases
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3.5 bg-[#2563EB] text-white rounded-xl font-bold text-sm text-left shadow-md shadow-blue-900/20">
            <Plus size={18} strokeWidth={2.5} /> New Case
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-[#CBD5E1] hover:text-white hover:bg-slate-800/50 rounded-xl transition font-semibold text-sm text-left">
            <Settings size={18} className="text-slate-400" /> Settings
          </button>
        </nav>

        <div className="p-4 border-t border-slate-800/60 bg-slate-950/20">
          <button onClick={handleLogout} className="w-full text-center text-xs font-bold tracking-wider uppercase text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 border border-transparent hover:border-rose-900/30 px-4 py-3 rounded-xl transition-all duration-200">
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Viewport */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="bg-white border-b border-[#E2E8F0] px-8 py-5 flex justify-between items-center shrink-0">
          <div>
            <h1 className="text-lg font-extrabold text-[#0F172A] tracking-tight">
              {step === 1 && "Step 1: Enter Case Details & Evidence"}
              {step === 2 && "Step 2: Review & Verify Case Summary"}
              {step === 3 && "Step 3: Match IPC & BNS Legal Sections"}
              {step === 4 && "Step 4: View Matching Precedents & Citations"}
            </h1>
            <p className="text-xs font-semibold text-[#64748B] mt-0.5">Secure AI-assisted verification workflow</p>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="relative">
              <Search size={15} className="absolute left-3.5 top-3 text-slate-400" />
              <input placeholder="Search precedents..." className="border border-[#E2E8F0] rounded-xl bg-[#F8FAFC] pl-10 pr-4 py-2 text-xs w-64 focus:outline-none focus:border-[#3B82F6] transition" />
            </div>
            <Bell size={18} className="text-[#64748B] cursor-pointer hover:text-gray-900 transition" />
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#1E40AF] to-[#3B82F6] text-white flex items-center justify-center font-black text-xs tracking-wider shadow-sm border border-blue-400/20 select-none">
              {userInitials}
            </div>
          </div>
        </header>

        {/* View Raw Description Toggle */}
        {step > 1 && (
          <div className="bg-white border-b border-[#E2E8F0] px-8 py-3 flex flex-col shrink-0 transition-all duration-200">
            <button 
              onClick={() => setIsRawDocOpen(!isRawDocOpen)}
              className="flex items-center gap-1.5 text-xs font-bold text-[#1E40AF] hover:text-blue-700 w-fit transition select-none"
            >
              <Eye size={14} /> 
              {isRawDocOpen ? "Collapse Raw Case Narrative" : "View Raw Case Description Log"}
              {isRawDocOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {isRawDocOpen && (
              <div className="mt-2.5 p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs text-slate-600 leading-relaxed font-medium whitespace-pre-wrap max-h-32 overflow-auto animate-in fade-in slide-in-from-top-1 duration-150">
                {description}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-auto p-8 lg:p-12 space-y-8">
          {step > 1 && (
            <div className="max-w-5xl mx-auto bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-2xs">
              <div className="flex items-center justify-between relative">
                {FLOW_STEPS.map((s, index) => {
                  const StepIcon = s.icon;
                  const isCompleted = step > s.id;
                  const isActive = step === s.id;
                  return (
                    <div key={s.id} className="flex flex-col items-center flex-1 relative z-10">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                        isCompleted ? "bg-[#1E40AF] border-[#1E40AF] text-white" :
                        isActive ? "bg-blue-50 border-[#2563EB] text-[#1E40AF] font-bold shadow-sm scale-105" :
                        "bg-white border-[#E2E8F0] text-slate-400"
                      }`}>
                        {isCompleted ? <Check size={16} strokeWidth={3} /> : <StepIcon size={16} />}
                      </div>
                      <span className={`text-xs mt-2.5 font-bold tracking-tight ${isActive ? "text-[#1E40AF]" : "text-slate-400"}`}>
                        {s.label}
                      </span>
                      {index < FLOW_STEPS.length - 1 && (
                        <div className="absolute left-[calc(50%+1.25rem)] right-[-50%] top-5 h-[2px] bg-[#E2E8F0] z-[-1]">
                          <div className="h-full bg-[#1E40AF] transition-all duration-500" style={{ width: step > s.id ? '100%' : '0%' }}></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="max-w-5xl mx-auto">
            
            {/* STEP 1 */}
            {step === 1 && (
              <Step1Input 
                description={description}
                setDescription={setDescription}
                handleGenerateSummary={handleGenerateSummary}
                loading={loading}
              />
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <Step2Summary 
                description={description}
                summary={summary}
                setSummary={setSummary}
                isEditingSummary={isEditingSummary}
                setIsEditingSummary={setIsEditingSummary}
                loading={loading}
                setStep={setStep}
                handleGenerateSummary={handleGenerateSummary}
                handleApproveSummary={handleApproveSummary}
              />
            )}

            {/* STEP 3 & 4 */}
            {(step === 3 || step === 4) && (
              <div className="space-y-8 relative">
                <Step3Mapping 
                  summary={summary}
                  charges={charges}
                  approvedChargesCount={approvedChargesCount}
                  rejectedChargesCount={rejectedChargesCount}
                  pendingChargesCount={pendingChargesCount}
                  activeHoverModal={activeHoverModal}
                  setActiveHoverModal={setActiveHoverModal}
                  toggleChargeStatus={toggleChargeStatus}
                  setIsModalOpen={setIsModalOpen}
                  handleFinalizeCharges={handleFinalizeCharges}
                  loading={loading}
                  allChargesEvaluated={allChargesEvaluated}
                />
                
                {step === 4 && (
                  <div className="border-t border-[#E2E8F0] pt-6 mt-8">
                    <Step4Precedents precedents={precedents} />
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </main>

      {/* Reject Reason Modal */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100">
            <div className="px-6 py-4 border-b border-[#E2E8F0] flex justify-between items-center bg-rose-50">
              <h3 className="font-extrabold text-rose-700 text-sm tracking-tight flex items-center gap-1.5">
                <XCircle size={16} /> Provide Rejection Reason
              </h3>
              <button onClick={() => { setRejectModal({ open: false, targetSection: null }); setRejectionReason(""); }} className="text-rose-400 hover:text-rose-600 transition p-1 hover:bg-rose-100 rounded-lg">
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-bold text-[#64748B] uppercase tracking-wide text-[10px]">Reason for rejecting section {rejectModal.targetSection} *</label>
                <textarea 
                  required 
                  rows={4} 
                  autoFocus
                  placeholder="Explain why this legal section does not apply to this case..." 
                  value={rejectionReason} 
                  onChange={(e) => setRejectionReason(e.target.value)} 
                  className="w-full border border-[#E2E8F0] rounded-xl p-3 focus:outline-none focus:border-rose-400 bg-[#F8FAFC]/50 text-sm resize-none leading-relaxed" 
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button type="button" onClick={() => { setRejectModal({ open: false, targetSection: null }); setRejectionReason(""); }} className="px-4 py-2 rounded-xl border border-[#E2E8F0] hover:bg-slate-50 text-[#64748B] transition font-bold text-xs">Cancel</button>
                <button 
                  onClick={handleRejectConfirm}
                  disabled={!rejectionReason.trim()}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-sm text-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Entry Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100">
            <div className="px-6 py-4 border-b border-[#E2E8F0] flex justify-between items-center bg-[#F8FAFC]">
              <h3 className="font-extrabold text-[#0F172A] text-sm tracking-tight flex items-center gap-1.5">
                <Scale size={16} className="text-[#1E40AF]" /> Add Manual Statutory Section
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition p-1 hover:bg-slate-100 rounded-lg">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddManualSection} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="font-bold text-[#64748B] uppercase tracking-wide text-[10px]">IPC Section Code *</label>
                  <input type="text" required placeholder="e.g. IPC Section 420" value={newIpc} onChange={(e) => setNewIpc(e.target.value)} className="w-full border border-[#E2E8F0] rounded-xl p-2.5 focus:outline-none focus:border-[#3B82F6] bg-[#F8FAFC]/50 font-mono text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label className="font-bold text-[#64748B] uppercase tracking-wide text-[10px]">BNS Equivalent</label>
                  <input type="text" placeholder="e.g. BNS Section 318" value={newBns} onChange={(e) => setNewBns(e.target.value)} className="w-full border border-[#E2E8F0] rounded-xl p-2.5 focus:outline-none focus:border-[#3B82F6] bg-[#F8FAFC]/50 font-mono text-sm" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-[#64748B] uppercase tracking-wide text-[10px]">Legal Category</label>
                <input type="text" placeholder="e.g. Corporate Cheating" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="w-full border border-[#E2E8F0] rounded-xl p-2.5 focus:outline-none focus:border-[#3B82F6] bg-[#F8FAFC]/50 text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-[#64748B] uppercase tracking-wide text-[10px]">Case Offense Description *</label>
                <textarea required rows={4} placeholder="Provide explicit reasons for adding this section..." value={newExplanation} onChange={(e) => setNewExplanation(e.target.value)} className="w-full border border-[#E2E8F0] rounded-xl p-2.5 focus:outline-none focus:border-[#3B82F6] bg-[#F8FAFC]/50 text-sm resize-none leading-relaxed" />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 rounded-xl border border-[#E2E8F0] hover:bg-slate-50 text-[#64748B] transition font-bold text-xs">Cancel</button>
                <button type="submit" className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#1E40AF] to-[#3B82F6] text-white font-bold shadow-sm text-xs transition">Add to Table</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
