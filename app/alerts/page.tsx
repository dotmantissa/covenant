"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { apiFetch } from "@/lib/client-api";
import { formatIsoDate } from "@/lib/format";
import { PageLoading } from "@/components/spinner";
import {
  ArrowRight,
  Check,
  RefreshCw,
} from "lucide-react";

type AlertItem = {
  id: number;
  facilityId: string;
  covenantIndex: number | null;
  kind: string;
  audience: string;
  severity: string;
  title: string;
  body: string;
  testId: number | null;
  readAt: string | null;
  createdAt: string;
};

export default function AlertsPage() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = authenticated ? await getAccessToken() : null;
      const url = unreadOnly ? "/api/alerts?unread=true" : "/api/alerts";
      const res = await apiFetch<{ alerts: AlertItem[] }>(url, {}, token);
      setAlerts(res.alerts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, [authenticated, unreadOnly, getAccessToken]);

  useEffect(() => {
    if (ready) {
      void fetchAlerts();
    }
  }, [ready, fetchAlerts]);

  const handleMarkRead = async (alertId: number) => {
    try {
      const token = await getAccessToken();
      await apiFetch("/api/alerts", {
        method: "POST",
        body: JSON.stringify({ alertId }),
      }, token);

      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, readAt: new Date().toISOString() } : a)),
      );
    } catch (err) {
      console.error("Failed to dismiss alert:", err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const token = await getAccessToken();
      await apiFetch("/api/alerts", {
        method: "POST",
        body: JSON.stringify({ markAll: true }),
      }, token);

      setAlerts((prev) =>
        prev.map((a) => ({ ...a, readAt: new Date().toISOString() })),
      );
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 ledger-rule">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-3xl font-medium tracking-tight text-[var(--ink)]">
              Compliance Alerts
            </h1>
            <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink-2)]">
              Real-time Notifications
            </span>
          </div>
          <p className="text-xs text-[var(--ink-2)]">
            Covenant offside notifications, cure period countdowns, and vault enforcement events.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setUnreadOnly(!unreadOnly)}
            className={`px-3 py-1.5 rounded text-xs font-medium border border-[var(--rule)] transition-colors cursor-pointer ${
              unreadOnly ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--ink-2)] hover:text-[var(--ink)] bg-[var(--paper-2)]"
            }`}
          >
            {unreadOnly ? "Showing Unread" : "All Alerts"}
          </button>

          {alerts.some((a) => !a.readAt) && (
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              className="px-3 py-1.5 rounded text-xs text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--paper-2)] border border-[var(--rule)] transition-colors cursor-pointer"
            >
              Mark all as read
            </button>
          )}

          <button
            type="button"
            onClick={() => void fetchAlerts()}
            className="p-2 rounded border border-[var(--rule)] text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--paper-2)] transition-colors cursor-pointer"
            title="Refresh alerts"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Alerts Register */}
      {error ? (
        <div className="p-4 rounded border border-[rgba(168,48,30,0.2)] bg-[rgba(168,48,30,0.05)] text-xs text-[var(--breach)]">
          {error}
        </div>
      ) : loading && alerts.length === 0 ? (
        <PageLoading message="Checking compliance alerts..." />
      ) : alerts.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-[var(--rule)] rounded space-y-2">
          <div className="font-serif italic text-sm text-[var(--ink-2)]">
            No compliance alerts on file.
          </div>
          <div className="text-xs text-[var(--ink-3)]">
            All credit covenants currently within agreed thresholds.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
          {alerts.map((a) => {
            const isUnread = !a.readAt;
            const isCritical = a.severity === "critical" || a.kind === "breach";

            return (
              <div
                key={a.id}
                className={`py-4 px-3 flex flex-col sm:flex-row sm:items-start justify-between gap-4 ledger-row ${
                  isUnread ? "bg-[rgba(48,197,202,0.03)]" : ""
                }`}
              >
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-[var(--ink)]">
                      {a.facilityId}
                    </span>
                    {a.covenantIndex !== null && (
                      <span className="text-[11px] font-mono text-[var(--ink-3)]">
                        Clause #{a.covenantIndex}
                      </span>
                    )}
                    <span className={`px-2 py-0.2 rounded text-[10px] font-mono uppercase tracking-wider ${
                      isCritical
                        ? "bg-[rgba(168,48,30,0.1)] text-[var(--breach)] border border-[rgba(168,48,30,0.2)]"
                        : "bg-[var(--paper-2)] text-[var(--signal-ink)] border border-[var(--rule)]"
                    }`}>
                      {a.kind.replace(/_/g, " ")}
                    </span>
                    {isUnread && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--signal)]" />
                    )}
                  </div>

                  <div className="font-medium text-xs text-[var(--ink)]">
                    {a.title}
                  </div>

                  {a.body && (
                    <div className="text-xs font-serif italic text-[var(--ink-2)] leading-relaxed">
                      {a.body}
                    </div>
                  )}

                  <div className="text-[10px] font-mono text-[var(--ink-3)] pt-0.5">
                    {formatIsoDate(a.createdAt)}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                  {a.testId && (
                    <Link
                      href={`/evidence/${a.testId}`}
                      className="text-xs font-mono text-[var(--ink-2)] hover:text-[var(--ink)] underline underline-offset-2 flex items-center gap-1"
                    >
                      <span>Citation</span>
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  )}

                  <Link
                    href={`/facilities/${encodeURIComponent(a.facilityId)}`}
                    className="text-xs font-mono text-[var(--ink)] hover:underline flex items-center gap-1"
                  >
                    <span>Facility</span>
                  </Link>

                  {isUnread && (
                    <button
                      type="button"
                      onClick={() => void handleMarkRead(a.id)}
                      className="p-1 rounded text-[var(--ink-3)] hover:text-[var(--ink)] cursor-pointer"
                      title="Dismiss alert"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
