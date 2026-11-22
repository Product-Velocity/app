"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import {
  compareVersions,
  groupReleases,
  hasVersionUpdate,
  releasesSince,
  type ReleaseEntry,
  type VersionInfo,
} from "@/lib/app-version";

const POLL_MS = 5 * 60_000;

function parseBuildTimeReleases(): ReleaseEntry[] {
  try {
    const raw = process.env.NEXT_PUBLIC_APP_RELEASES;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReleaseEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type VersionState = {
  clientVersion: string;
  clientBuild: string;
  remote: VersionInfo | null;
  releases: ReleaseEntry[];
  updateAvailable: boolean;
  missed: ReleaseEntry[];
  whatsNewOpen: boolean;
};

const initialReleases = parseBuildTimeReleases();
const initialClientVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? initialReleases[0]?.version ?? "0.0.0";
const initialClientBuild = process.env.NEXT_PUBLIC_APP_BUILD ?? "";

let state: VersionState = {
  clientVersion: initialClientVersion,
  clientBuild: initialClientBuild,
  remote: null,
  releases: initialReleases,
  updateAvailable: false,
  missed: [],
  whatsNewOpen: false,
};

const listeners = new Set<() => void>();
function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): VersionState {
  return state;
}

export function applyRemoteVersion(info: VersionInfo) {
  const releases = info.releases?.length ? info.releases : state.releases;
  const updateAvailable = hasVersionUpdate(
    { version: state.clientVersion, build: state.clientBuild },
    { version: info.version, build: info.build },
  );
  const missed = updateAvailable ? releasesSince(state.clientVersion, releases) : [];
  state = {
    ...state,
    remote: info,
    releases,
    updateAvailable,
    missed,
  };
  emit();
}

export function setWhatsNewOpen(open: boolean) {
  if (state.whatsNewOpen === open) return;
  state = { ...state, whatsNewOpen: open };
  emit();
}

let inFlight: Promise<void> | null = null;
export function checkVersionNow(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = fetch("/api/version", {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
    .then(async (res) => {
      if (!res.ok) return;
      const data = (await res.json()) as VersionInfo;
      if (data && typeof data.version === "string") {
        applyRemoteVersion(data);
      }
    })
    .catch(() => {
      // network offline or transient error: stay quiet
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function reloadApp() {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}

let activePollers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function onVisibilityChange() {
  if (document.visibilityState === "visible") {
    void checkVersionNow();
  }
}

function useVersionPoller() {
  useEffect(() => {
    activePollers += 1;
    if (activePollers === 1) {
      void checkVersionNow();
      pollTimer = setInterval(() => {
        if (document.visibilityState === "visible") {
          void checkVersionNow();
        }
      }, POLL_MS);
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      activePollers = Math.max(0, activePollers - 1);
      if (activePollers === 0) {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, []);
}

export function useVersionStatus(): VersionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Shown in the top bar only when a newer deployment is live, giving a one-click Refresh button
 * plus a tooltip with the release summary. Also renders the shared "What's new" release notes dialog.
 */
export function VersionUpdateBanner() {
  useVersionPoller();
  const { updateAvailable, remote, missed, whatsNewOpen, releases, clientVersion, clientBuild } = useVersionStatus();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!whatsNewOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWhatsNewOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [whatsNewOpen]);

  const newest = missed[0] ?? remote?.latest ?? null;
  const targetVersion = remote?.version ?? newest?.version ?? clientVersion;
  const tooltip = newest
    ? `New in v${targetVersion}: ${newest.title}. Click to refresh.`
    : `New version v${targetVersion} is deployed. Click to refresh.`;

  return (
    <>
      {updateAvailable && (
        <div className="version-topbar-pill" role="status" aria-live="polite">
          <button
            type="button"
            className="version-refresh-pill"
            onClick={reloadApp}
            title={tooltip}
          >
            Update available (v{targetVersion}) · Refresh
          </button>
          <button
            type="button"
            className="version-whats-new-pill"
            onClick={() => setWhatsNewOpen(true)}
            title="See what was updated in this release"
          >
            What&rsquo;s new
          </button>
        </div>
      )}

      {whatsNewOpen && (
        <div
          className="dialog-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setWhatsNewOpen(false);
          }}
        >
          <div className="dialog version-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <h2 id={titleId}>What&rsquo;s new in Product Velocity</h2>
            <p className="muted version-dialog-sub">
              {updateAvailable && remote
                ? `Version ${remote.version} is now live. Refresh to get it.`
                : "The latest improvements to Product Velocity."}
            </p>

            {updateAvailable && (
              <div className="version-dialog-callout" role="region" aria-label="Update available">
                <div>
                  <strong>New version v{targetVersion} is ready.</strong>{" "}
                  {newest ? <span>{newest.title}.</span> : null}
                </div>
                <button type="button" className="btn btn-primary" onClick={reloadApp}>
                  Refresh to v{targetVersion}
                </button>
              </div>
            )}

            {releases.length === 0 ? (
              <p className="muted">No release notes found.</p>
            ) : (
              <div className="version-notes">
                {groupReleases(releases).map((day) => (
                  <section key={day.date} className="version-day" aria-label={day.label}>
                    <h3 className="version-day-head">{day.label}</h3>
                    {day.groups.map((group) => (
                      <div key={group.type} className="version-group">
                        <h4 className={`version-group-head version-group-${group.type}`}>{group.label}</h4>
                        <ul className="version-entry-list">
                          {group.entries.map((r) => {
                            const isNewer = compareVersions(r.version, clientVersion) > 0;
                            const isCurrent = r.version === clientVersion;
                            return (
                              <li key={r.version} className={`version-entry${isNewer ? " is-new" : ""}`}>
                                <p className="version-entry-title">
                                  {r.title}
                                  {isNewer && <span className="version-badge-new">New update</span>}
                                  {isCurrent && !isNewer && <span className="version-badge-current">You are here</span>}
                                </p>
                                {r.body && <p className="version-entry-body">{r.body}</p>}
                                <p className="version-entry-ver">Version {r.version}</p>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            )}

            <p className="muted version-dialog-foot">
              You are on version {clientVersion}
              {clientBuild ? ` (build ${clientBuild})` : ""}.
            </p>

            <div className="dialog-actions">
              {updateAvailable && (
                <button type="button" className="btn btn-primary" onClick={reloadApp}>
                  Refresh now
                </button>
              )}
              <button
                ref={closeRef}
                type="button"
                className={updateAvailable ? "btn" : "btn btn-primary"}
                onClick={() => setWhatsNewOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Footer inside the Account Menu dropdown. Shows the current version + build, a "What's new" button,
 * and—when a newer version is deployed—an inline update card with what changed and a "Refresh now" button.
 */
export function AccountVersionFooter({ onCloseMenu }: { onCloseMenu?: () => void }) {
  const { clientVersion, clientBuild, updateAvailable, remote, missed } = useVersionStatus();
  const newest = missed[0] ?? remote?.latest ?? null;
  const targetVersion = remote?.version ?? newest?.version ?? clientVersion;
  const extraCount = Math.max(0, missed.length - 1);

  return (
    <div className="account-version" title="Release log: docs/RELEASES.md">
      <div className="account-version-line">
        <span>
          app v{clientVersion}
          {clientBuild ? ` · build ${clientBuild}` : ""}
        </span>
        <button
          type="button"
          className="version-whats-new-btn"
          onClick={() => {
            onCloseMenu?.();
            setWhatsNewOpen(true);
          }}
        >
          What&rsquo;s new
        </button>
      </div>

      {updateAvailable && (
        <div className="account-update-card" role="status">
          <p className="account-update-heading">
            Update available: <strong>v{targetVersion}</strong>
            {remote?.build && remote.build !== clientBuild ? ` (${remote.build})` : ""}
          </p>
          {newest && (
            <p className="account-update-summary">
              {newest.title}.
              {extraCount > 0 ? ` (+${extraCount} more ${extraCount === 1 ? "release" : "releases"})` : ""}
            </p>
          )}
          <div className="account-update-actions">
            <button type="button" className="account-update-refresh" onClick={reloadApp}>
              Refresh to update
            </button>
            <button
              type="button"
              className="account-update-notes"
              onClick={() => {
                onCloseMenu?.();
                setWhatsNewOpen(true);
              }}
            >
              Release notes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
