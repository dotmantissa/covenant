"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { apiFetch } from "@/lib/client-api";
import { formatAddress, formatAtto, formatBp } from "@/lib/format";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";

type FacilityItem = {
  facilityId: string;
  lenderAddress: string;
  borrowerAddress: string;
  borrowerName: string;
  purpose: string;
  principalAtto: string;
  rateBp: number;
  stepUpBp: number;
  status: string;
  covenantCount: number;
  offsideCount: number;
  lenderEmail: string | null;
  borrowerEmail: string | null;
  position: {
    committedAtto: string;
    drawnAtto: string;
    effectiveRateBp: number;
    drawFrozen: boolean;
    accelerated: boolean;
  } | null;
};

export default function FacilitiesPage() {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const [facilities, setFacilities] = useState<FacilityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<"all" | "lender" | "borrower">("all");
  const [search, setSearch] = useState("");
  const [showDraftModal, setShowDraftModal] = useState(false);

  // Form state
  const [draftId, setDraftId] = useState("");
  const [draftBorrowerName, setDraftBorrowerName] = useState("");
  const [draftBorrowerAddress, setDraftBorrowerAddress] = useState("");
  const [draftPurpose, setDraftPurpose] = useState("");
  const [draftPrincipalGen, setDraftPrincipalGen] = useState("1000");
  const [draftRatePercent, setDraftRatePercent] = useState("7.5");
  const [draftStepUpPercent, setDraftStepUpPercent] = useState("2.0");
  const [draftTreasuryAddress, setDraftTreasuryAddress] = useState("");
  const [draftTreasuryRpc, setDraftTreasuryRpc] = useState("");
  const [draftGovernanceUrl, setDraftGovernanceUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchFacilities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = authenticated ? await getAccessToken() : null;
      const queryParam = roleFilter === "all" ? "?all=true" : `?role=${roleFilter}`;
      const res = await apiFetch<{ facilities: FacilityItem[] }>(
        `/api/facilities${queryParam}`,
        {},
        token,
      );
      setFacilities(res.facilities);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load facilities");
    } finally {
      setLoading(false);
    }
  }, [authenticated, roleFilter, getAccessToken]);

  useEffect(() => {
    if (ready) {
      void fetchFacilities();
    }
  }, [ready, fetchFacilities]);

  const handleCreateFacility = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);

    try {
      const token = await getAccessToken();
      const principalAtto = (BigInt(Math.floor(parseFloat(draftPrincipalGen) || 1)) * 10n ** 18n).toString();
      const rateBp = Math.round(parseFloat(draftRatePercent) * 100);
      const stepUpBp = Math.round(parseFloat(draftStepUpPercent) * 100);

      await apiFetch(
        "/api/facilities",
        {
          method: "POST",
          body: JSON.stringify({
            facilityId: draftId.trim(),
            borrowerName: draftBorrowerName.trim(),
            borrowerAddress: draftBorrowerAddress.trim(),
            purpose: draftPurpose.trim(),
            principalAtto,
            rateBp,
            stepUpBp,
            treasuryAddress: draftTreasuryAddress.trim(),
            treasuryRpcUrl: draftTreasuryRpc.trim(),
            governanceUrl: draftGovernanceUrl.trim(),
          }),
        },
        token,
      );

      setShowDraftModal(false);
      setDraftId("");
      setDraftBorrowerName("");
      setDraftBorrowerAddress("");
      setDraftPurpose("");
      await fetchFacilities();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create facility");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredFacilities = facilities.filter((f) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      f.facilityId.toLowerCase().includes(term) ||
      f.borrowerName.toLowerCase().includes(term) ||
      f.purpose.toLowerCase().includes(term) ||
      f.borrowerAddress.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-8">
      {/* Page Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 ledger-rule">
        <div className="space-y-1">
          <h1 className="font-serif text-3xl font-medium tracking-tight text-[var(--ink)]">
            Credit Facilities Register
          </h1>
          <p className="text-xs text-[var(--ink-2)]">
            Active loan agreements, capital commitments, and continuous covenant compliance.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void fetchFacilities()}
            className="p-2 rounded border border-[var(--rule)] text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--paper-2)] transition-colors cursor-pointer"
            title="Refresh from chain cache"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          {authenticated ? (
            <button
              type="button"
              onClick={() => setShowDraftModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[var(--ink)] text-[var(--paper)] text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Draft Facility</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => login()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[var(--ink)] text-[var(--paper)] text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
            >
              <span>Sign in to Draft</span>
            </button>
          )}
        </div>
      </div>

      {/* Register Filters & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 rounded bg-[var(--paper-2)] border border-[var(--rule)]">
          <button
            type="button"
            onClick={() => setRoleFilter("all")}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
              roleFilter === "all"
                ? "bg-[var(--paper)] text-[var(--ink)] shadow-xs"
                : "text-[var(--ink-2)] hover:text-[var(--ink)]"
            }`}
          >
            All Agreements
          </button>
          <button
            type="button"
            onClick={() => setRoleFilter("lender")}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
              roleFilter === "lender"
                ? "bg-[var(--paper)] text-[var(--ink)] shadow-xs"
                : "text-[var(--ink-2)] hover:text-[var(--ink)]"
            }`}
          >
            As Lender
          </button>
          <button
            type="button"
            onClick={() => setRoleFilter("borrower")}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
              roleFilter === "borrower"
                ? "bg-[var(--paper)] text-[var(--ink)] shadow-xs"
                : "text-[var(--ink-2)] hover:text-[var(--ink)]"
            }`}
          >
            As Borrower
          </button>
        </div>

        <div className="relative max-w-xs w-full">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-3)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search facilities or counterparties..."
            className="w-full pl-9 pr-3 py-1.5 rounded text-xs bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:outline-hidden focus:border-[var(--ink)]"
          />
        </div>
      </div>

      {/* Facilities Register Table */}
      {error ? (
        <div className="p-4 rounded border border-[rgba(168,48,30,0.2)] bg-[rgba(168,48,30,0.05)] text-xs text-[var(--breach)]">
          {error}
        </div>
      ) : filteredFacilities.length === 0 ? (
        <div className="text-center py-16 space-y-3 border border-dashed border-[var(--rule)] rounded">
          <div className="text-sm font-serif italic text-[var(--ink-2)]">
            {loading ? "Reading credit facilities from chain register..." : "No credit facilities found matching the selection."}
          </div>
          {!loading && authenticated && (
            <button
              type="button"
              onClick={() => setShowDraftModal(true)}
              className="text-xs text-[var(--ink)] underline underline-offset-2 hover:opacity-80"
            >
              Draft your first facility agreement
            </button>
          )}
        </div>
      ) : (
        <div className="border border-[var(--rule)] rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[var(--paper-2)] border-b border-[var(--rule)] text-[10px] font-mono uppercase tracking-wider text-[var(--ink-3)]">
                  <th className="py-3 px-4">Facility ID / Borrower</th>
                  <th className="py-3 px-4">Agreed Principal</th>
                  <th className="py-3 px-4">Committed / Drawn</th>
                  <th className="py-3 px-4">Effective Rate</th>
                  <th className="py-3 px-4">Covenants</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Console</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--rule)]">
                {filteredFacilities.map((f) => {
                  const isOffside = f.offsideCount > 0;
                  const isAccelerating = f.status === "accelerating" || f.position?.accelerated;
                  const isDrawFrozen = f.status === "draw_stopped" || f.position?.drawFrozen;

                  return (
                    <tr key={f.facilityId} className="ledger-row group">
                      <td className="py-3.5 px-4 space-y-1">
                        <div className="font-mono font-medium text-[var(--ink)]">
                          {f.facilityId}
                        </div>
                        <div className="text-[11px] text-[var(--ink-2)] font-serif italic">
                          {f.borrowerName}
                        </div>
                        <div className="text-[10px] font-mono text-[var(--ink-3)] truncate max-w-[200px]">
                          Borrower: {f.borrowerEmail ?? formatAddress(f.borrowerAddress)}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-mono tabular-numbers text-[var(--ink)]">
                        {formatAtto(f.principalAtto)}
                      </td>

                      <td className="py-3.5 px-4 font-mono tabular-numbers space-y-0.5">
                        <div className="text-[var(--ink)]">
                          {f.position ? formatAtto(f.position.committedAtto) : "Unfunded"}
                        </div>
                        <div className="text-[10px] text-[var(--ink-2)]">
                          Drawn: {f.position ? formatAtto(f.position.drawnAtto) : "0 GEN"}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-mono tabular-numbers text-[var(--ink)]">
                        {formatBp(f.position?.effectiveRateBp ?? f.rateBp)}
                        {f.stepUpBp > 0 && (
                          <span className="text-[10px] text-[var(--ink-3)] block">
                            +{formatBp(f.stepUpBp)} step-up
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 space-y-1">
                        <div className="font-mono tabular-numbers text-[var(--ink)]">
                          {f.covenantCount} covenants
                        </div>
                        {isOffside && (
                          <div className="inline-flex items-center gap-1 text-[10px] text-[var(--breach)] font-mono">
                            <AlertTriangle className="w-3 h-3" />
                            <span>{f.offsideCount} offside</span>
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${
                          isAccelerating
                            ? "bg-[rgba(168,48,30,0.1)] text-[var(--breach)] border border-[rgba(168,48,30,0.2)] font-semibold"
                            : isDrawFrozen
                            ? "bg-[rgba(168,48,30,0.06)] text-[var(--breach)] border border-[rgba(168,48,30,0.15)]"
                            : "bg-[var(--paper-2)] text-[var(--signal-ink)] border border-[var(--rule)]"
                        }`}>
                          {isAccelerating ? (
                            <ShieldAlert className="w-3 h-3" />
                          ) : isDrawFrozen ? (
                            <Lock className="w-3 h-3" />
                          ) : (
                            <CheckCircle2 className="w-3 h-3" />
                          )}
                          <span>{f.status.replace(/_/g, " ")}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <Link
                          href={`/facilities/${encodeURIComponent(f.facilityId)}`}
                          className="inline-flex items-center gap-1 text-xs text-[var(--ink)] font-medium hover:underline underline-offset-2"
                        >
                          <span>Manage</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Draft Facility Modal */}
      {showDraftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,26,35,0.6)] backdrop-blur-xs p-4 overflow-y-auto">
          <div className="max-w-xl w-full rounded border border-[var(--rule)] bg-[var(--paper)] p-6 space-y-6 shadow-xl my-8">
            <div className="flex items-center justify-between pb-3 ledger-rule">
              <h2 className="font-serif text-xl font-semibold text-[var(--ink)]">
                Draft Credit Facility Agreement
              </h2>
              <button
                type="button"
                onClick={() => setShowDraftModal(false)}
                className="text-[var(--ink-2)] hover:text-[var(--ink)] p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {submitError && (
              <div className="p-3 rounded bg-[rgba(168,48,30,0.08)] border border-[rgba(168,48,30,0.2)] text-xs text-[var(--breach)]">
                {submitError}
              </div>
            )}

            <form onSubmit={handleCreateFacility} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-mono text-[11px] text-[var(--ink-2)]">
                    Facility Identifier *
                  </label>
                  <input
                    type="text"
                    required
                    value={draftId}
                    onChange={(e) => setDraftId(e.target.value)}
                    placeholder="FAC-2026-001"
                    className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono focus:outline-hidden focus:border-[var(--ink)]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-mono text-[11px] text-[var(--ink-2)]">
                    Borrower Name / Entity *
                  </label>
                  <input
                    type="text"
                    required
                    value={draftBorrowerName}
                    onChange={(e) => setDraftBorrowerName(e.target.value)}
                    placeholder="Acme Operations LLC"
                    className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] focus:outline-hidden focus:border-[var(--ink)]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[11px] text-[var(--ink-2)]">
                  Borrower GenLayer Address *
                </label>
                <input
                  type="text"
                  required
                  value={draftBorrowerAddress}
                  onChange={(e) => setDraftBorrowerAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono focus:outline-hidden focus:border-[var(--ink)]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[11px] text-[var(--ink-2)]">
                  Facility Purpose / Terms Summary
                </label>
                <input
                  type="text"
                  value={draftPurpose}
                  onChange={(e) => setDraftPurpose(e.target.value)}
                  placeholder="Working capital line of credit with leverage covenants"
                  className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] focus:outline-hidden focus:border-[var(--ink)]"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="font-mono text-[11px] text-[var(--ink-2)]">
                    Principal (GEN) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={draftPrincipalGen}
                    onChange={(e) => setDraftPrincipalGen(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono focus:outline-hidden focus:border-[var(--ink)]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-mono text-[11px] text-[var(--ink-2)]">
                    Base Rate (%) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={draftRatePercent}
                    onChange={(e) => setDraftRatePercent(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono focus:outline-hidden focus:border-[var(--ink)]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-mono text-[11px] text-[var(--ink-2)]">
                    Step-up Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={draftStepUpPercent}
                    onChange={(e) => setDraftStepUpPercent(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono focus:outline-hidden focus:border-[var(--ink)]"
                  />
                </div>
              </div>

              <div className="space-y-1 pt-2">
                <label className="font-mono text-[11px] text-[var(--ink-2)]">
                  Optional Treasury Address (for on-chain treasury covenants)
                </label>
                <input
                  type="text"
                  value={draftTreasuryAddress}
                  onChange={(e) => setDraftTreasuryAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono focus:outline-hidden focus:border-[var(--ink)]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[11px] text-[var(--ink-2)]">
                  Optional Treasury RPC URL
                </label>
                <input
                  type="text"
                  value={draftTreasuryRpc}
                  onChange={(e) => setDraftTreasuryRpc(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono focus:outline-hidden focus:border-[var(--ink)]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[11px] text-[var(--ink-2)]">
                  Optional Governance URL (for prose covenant auditing)
                </label>
                <input
                  type="text"
                  value={draftGovernanceUrl}
                  onChange={(e) => setDraftGovernanceUrl(e.target.value)}
                  placeholder="https://governance.acme.com/proposals/..."
                  className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono focus:outline-hidden focus:border-[var(--ink)]"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 ledger-rule">
                <button
                  type="button"
                  onClick={() => setShowDraftModal(false)}
                  className="px-4 py-2 rounded border border-[var(--rule)] text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded bg-[var(--ink)] text-[var(--paper)] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
                >
                  {submitting ? "Signing & Deploying on Chain..." : "Sign & Create Agreement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
