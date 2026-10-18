"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { canvas, tokenSettingsUrl, type CanvasStatus, type Course, type CourseItem, type IndexStatus, type LoginState, type School } from "@/lib/canvas";
import type { Material } from "@/lib/materials";

/**
 * Connect to Canvas, inline under the text box. Two steps the first time:
 * find the school, paste an access token. Once connected, pick a course:
 * the server reads it in the background and the tutor pulls from it on
 * demand as it teaches. Individual items can still be attached by hand.
 */
export function CanvasPanel({
  course,
  onCourse,
  onMaterial,
  onSkipped,
  onClose,
}: {
  course: Course | null;
  onCourse: (c: Course | null) => void;
  onMaterial: (m: Material) => void;
  onSkipped: (name: string) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<CanvasStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relogin, setRelogin] = useState(false);

  useEffect(() => {
    canvas
      .status()
      .then(setStatus)
      .catch(() => setError("The tutor server is not running, so Canvas cannot be reached."));
  }, []);

  return (
    <div className="border-t border-neutral-100 px-2 pb-2 pt-3 text-[14px]" data-testid="canvas-panel">
      <div className="flex items-center justify-between">
        <div className="font-medium">
          Canvas
          {status?.connected && (
            <span className="ml-2 font-normal text-neutral-500">
              {status.domain} · {status.user}
              {status.auth === "cookie" && " · browser login"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {status?.connected && status.auth === "cookie" && !relogin && (
            <button className="ui-btn text-[12px] text-neutral-500" onClick={() => setRelogin(true)} title="Browser logins expire after a day or two">
              Log in again
            </button>
          )}
          {status?.connected && (
            <button
              className="ui-btn text-[12px] text-neutral-500"
              onClick={() => {
                onCourse(null);
                canvas.disconnect().then(() => setStatus({ connected: false }));
              }}
            >
              Disconnect
            </button>
          )}
          <button className="ui-btn text-neutral-400" onClick={onClose} aria-label="Close Canvas">
            ✕
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-[13px] text-[var(--coral)]">{error}</p>}
      {status && !status.connected && <Connect onConnected={setStatus} />}
      {status?.connected && status.auth === "cookie" && relogin && <BrowserLogin domain={status.domain!} onConnected={(s) => { setStatus(s); setRelogin(false); }} onCancel={() => setRelogin(false)} />}
      {status?.connected && (course ? <CourseView course={course} onChange={() => onCourse(null)} onMaterial={onMaterial} onSkipped={onSkipped} /> : <CourseList onPick={onCourse} />)}
    </div>
  );
}

function Connect({ onConnected }: { onConnected: (s: CanvasStatus) => void }) {
  const [school, setSchool] = useState<School | null>(null);
  const [query, setQuery] = useState("");
  // Results are tagged with the query they answer; stale ones simply stop matching.
  const [found, setFound] = useState<{ q: string; schools: School[] } | null>(null);
  const schools = found && found.q === query ? found.schools : [];
  const [searching, setSearching] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viaBrowser, setViaBrowser] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // Search as they type, a beat after the last keystroke.
  useEffect(() => {
    abort.current?.abort();
    if (query.trim().length < 2) return;
    const ctl = new AbortController();
    abort.current = ctl;
    const t = window.setTimeout(() => {
      setSearching(true);
      canvas
        .schools(query, ctl.signal)
        .then((s) => {
          if (!ctl.signal.aborted) setFound({ q: query, schools: s });
        })
        .catch((e: Error) => {
          if (!ctl.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!ctl.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [query]);

  const connect = async () => {
    if (!school || !token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onConnected(await canvas.connect(school.domain, token));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!school) {
    return (
      <div className="mt-2">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-neutral-400">Step 1 of 2 · Find your school</div>
        <input
          autoFocus
          className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 outline-none focus:border-[var(--teal)]"
          placeholder="School name, or your Canvas address (canvas.school.edu)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Find your school"
        />
        {searching && <p className="mt-1 text-[12px] text-neutral-400">Searching...</p>}
        {error && <p className="mt-1 text-[12px] text-[var(--coral)]">{error}</p>}
        {schools.length > 0 && (
          <ul className="mt-2 max-h-56 divide-y divide-neutral-100 overflow-auto rounded-lg border border-neutral-200 bg-white">
            {schools.map((s) => (
              <li key={s.domain}>
                <button className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-neutral-50" onClick={() => setSchool(s)}>
                  <span>{s.name}</span>
                  {s.name !== s.domain && <span className="text-[12px] text-neutral-500">{s.domain}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!searching && query.trim().length >= 2 && schools.length === 0 && !error && <p className="mt-1 text-[12px] text-neutral-500">No match. Try the Canvas address itself, like canvas.school.edu.</p>}
      </div>
    );
  }

  if (viaBrowser) {
    return (
      <div className="mt-2">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-neutral-400">Step 2 of 2 · Log in to Canvas</div>
        <BrowserLogin domain={school.domain} onConnected={onConnected} onCancel={() => setViaBrowser(false)} />
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-neutral-400">Step 2 of 2 · Get an access token</div>
      <p className="mt-1 text-[13px] text-neutral-600">
        <button className="underline decoration-neutral-300 hover:text-[var(--ink)]" onClick={() => setSchool(null)}>
          {school.name}
        </button>
        . In Canvas, open{" "}
        <a className="text-[var(--teal)] underline" href={tokenSettingsUrl(school.domain)} target="_blank" rel="noreferrer">
          Account → Settings
        </a>
        , scroll to Approved Integrations, click <b>+ New Access Token</b>, and paste the token here. It stays on this machine.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          autoFocus
          type="password"
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-[13px] outline-none focus:border-[var(--teal)]"
          placeholder="Paste the access token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") connect();
          }}
          aria-label="Canvas access token"
        />
        <button className="ui-btn primary px-4" onClick={connect} disabled={busy || !token.trim()}>
          {busy ? "Checking..." : "Connect"}
        </button>
      </div>
      {error && <p className="mt-1 text-[12px] text-[var(--coral)]">{error}</p>}
      <p className="mt-2 text-[13px] text-neutral-600">
        No <b>+ New Access Token</b> button? Some schools switch it off.{" "}
        <button className="text-[var(--teal)] underline" onClick={() => setViaBrowser(true)}>
          Log in through a browser window instead
        </button>
        .
      </p>
    </div>
  );
}

/**
 * The server opens Chrome on the school's Canvas login; the student signs in
 * there (SSO and Duo included) and this polls until the session is in.
 */
function BrowserLogin({ domain, onConnected, onCancel }: { domain: string; onConnected: (s: CanvasStatus) => void; onCancel: () => void }) {
  const [state, setState] = useState<LoginState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: number | null = null;
    const poll = () =>
      canvas
        .loginState()
        .then((s) => {
          if (stop) return;
          setState(s);
          if (s.state === "waiting") timer = window.setTimeout(poll, 1500);
          else if (s.state === "done") onConnected({ connected: true, domain: s.domain, user: s.user, auth: "cookie" });
        })
        .catch((e: Error) => {
          if (!stop) setError(e.message);
        });
    canvas
      .login(domain)
      .then((s) => {
        if (stop) return;
        setState(s);
        if (s.state === "waiting") timer = window.setTimeout(poll, 1500);
      })
      .catch((e: Error) => {
        if (!stop) setError(e.message);
      });
    return () => {
      stop = true;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  const cancel = () => {
    canvas.cancelLogin().catch(() => {});
    onCancel();
  };

  if (error || state?.state === "failed") {
    return (
      <div className="mt-1">
        <p className="text-[13px] text-[var(--coral)]">{error ?? (state?.state === "failed" ? state.error : "")}</p>
        <button className="ui-btn mt-2 text-[12px]" onClick={cancel}>
          Back
        </button>
      </div>
    );
  }
  return (
    <div className="mt-1">
      <p className="text-[13px] text-neutral-600">
        A browser window is opening on <b>{domain}</b>. Sign in there the way you always do (your school login, Duo and all). This page updates by itself once you are in, and the window closes. Nothing about the login is stored except the Canvas session, on this machine.
      </p>
      <p className="mt-2 flex items-center gap-2 text-[12px] text-neutral-500">
        <span className="ui-pulse inline-block h-2 w-2 rounded-full bg-[var(--teal)]" />
        Waiting for the login...
        <button className="ui-btn ml-auto text-[12px]" onClick={cancel}>
          Cancel
        </button>
      </p>
    </div>
  );
}

function CourseList({ onPick }: { onPick: (c: Course) => void }) {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    canvas.courses().then(setCourses).catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <p className="mt-2 text-[13px] text-[var(--coral)]">{error}</p>;
  if (!courses) return <p className="mt-2 text-[13px] text-neutral-500">Loading your courses...</p>;
  return (
    <div className="mt-2">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-neutral-400">Which course is this for?</div>
      {courses.length === 0 && <p className="mt-1 text-[13px] text-neutral-500">No active courses on this account.</p>}
      <ul className="mt-2 max-h-56 divide-y divide-neutral-100 overflow-auto rounded-lg border border-neutral-200 bg-white">
        {courses.map((c) => (
          <li key={c.id}>
            <button className="flex w-full items-baseline gap-2 px-3 py-2 text-left hover:bg-neutral-50" onClick={() => onPick(c)}>
              <span className="truncate">{c.name}</span>
              <span className="shrink-0 text-[12px] text-neutral-500">{c.code}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The chosen course: start reading it on the server, show progress, and offer the item list for hand-picking. */
function CourseView({ course, onChange, onMaterial, onSkipped }: { course: Course; onChange: () => void; onMaterial: (m: Material) => void; onSkipped: (name: string) => void }) {
  const [index, setIndex] = useState<IndexStatus | null>(null);
  const [browse, setBrowse] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: number | null = null;
    const poll = () =>
      canvas
        .indexStatus(course.id)
        .then((s) => {
          if (stop) return;
          setIndex(s);
          if (s.state === "indexing") timer = window.setTimeout(poll, 1500);
        })
        .catch((e: Error) => {
          if (!stop) setError(e.message);
        });
    canvas
      .index(course)
      .then((s) => {
        if (stop) return;
        setIndex(s);
        if (s.state === "indexing") timer = window.setTimeout(poll, 1500);
      })
      .catch((e: Error) => {
        if (!stop) setError(e.message);
      });
    return () => {
      stop = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [course]);

  const progress =
    !index || index.state === "indexing"
      ? `Reading the course${index ? ` · ${index.done} of ${index.items} items` : ""}...`
      : index.state === "failed"
        ? `Could not read the course: ${index.error}`
        : `${index.items} items read · the tutor pulls slides, pages and assignments from them as it teaches`;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <span className="truncate font-medium">{course.name}</span>
        <span className="shrink-0 text-[12px] text-neutral-500">{course.code}</span>
        <button className="ui-btn ml-auto text-[12px]" onClick={onChange}>
          Change course
        </button>
      </div>
      <p className={`mt-1 text-[13px] ${index?.state === "failed" ? "text-[var(--coral)]" : "text-neutral-500"}`} aria-live="polite">
        {progress}
      </p>
      {error && <p className="mt-1 text-[12px] text-[var(--coral)]">{error}</p>}
      <button className="mt-1 text-[12px] text-neutral-500 underline decoration-neutral-300 hover:text-[var(--ink)]" onClick={() => setBrowse((v) => !v)}>
        {browse ? "Hide the item list" : "Or attach specific items by hand"}
      </button>
      {browse && <ItemList course={course} onMaterial={onMaterial} onSkipped={onSkipped} />}
    </div>
  );
}

function ItemList({ course, onMaterial, onSkipped }: { course: Course; onMaterial: (m: Material) => void; onSkipped: (name: string) => void }) {
  const [items, setItems] = useState<CourseItem[] | null>(null);
  const [filter, setFilter] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    canvas.items(course.id).then(setItems).catch((e: Error) => setError(e.message));
  }, [course]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const map = new Map<string, CourseItem[]>();
    for (const it of items ?? []) {
      if (q && !it.name.toLowerCase().includes(q)) continue;
      const list = map.get(it.group) ?? [];
      list.push(it);
      map.set(it.group, list);
    }
    return Array.from(map.entries());
  }, [items, filter]);

  const add = async (it: CourseItem) => {
    const key = `${it.kind}:${it.id}`;
    setLoading((s) => new Set(s).add(key));
    try {
      const r = await canvas.material(course.id, it);
      if (r.material) {
        onMaterial({ name: `${course.code || course.name}: ${r.material.name}`, text: r.material.text });
        setAdded((s) => new Set(s).add(key));
      }
      if (r.skipped) onSkipped(r.skipped);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  };

  if (error) return <p className="mt-2 text-[13px] text-[var(--coral)]">{error}</p>;
  if (items === null) return <p className="mt-2 text-[13px] text-neutral-500">Loading pages, assignments and files...</p>;
  if (items.length === 0) return <p className="mt-2 text-[13px] text-neutral-500">Nothing readable in this course (the teacher may have hidden pages and files).</p>;
  return (
    <>
      <input className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--teal)]" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter course items" />
      <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-neutral-200 bg-white">
        {groups.map(([group, list]) => (
          <div key={group}>
            <div className="sticky top-0 bg-neutral-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{group}</div>
            <ul className="divide-y divide-neutral-100">
              {list.map((it) => {
                const key = `${it.kind}:${it.id}`;
                const done = added.has(key);
                const busy = loading.has(key);
                return (
                  <li key={key} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="w-5 shrink-0 text-center text-[12px] text-neutral-400" title={it.kind}>
                      {it.kind === "file" ? "📄" : it.kind === "assignment" ? "✎" : "¶"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{it.name}</span>
                    {it.size != null && <span className="shrink-0 text-[11px] text-neutral-400">{Math.max(1, Math.round(it.size / 1024))} KB</span>}
                    <button className={`ui-btn h-7 text-[12px]${done ? " is-on" : ""}`} onClick={() => add(it)} disabled={busy || done} aria-label={`Add ${it.name}`}>
                      {done ? "Added" : busy ? "Reading..." : "+ Add"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
