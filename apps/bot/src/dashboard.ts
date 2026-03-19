import http from "node:http";
import { URL } from "node:url";

import type { Logger } from "./util/logger.js";
import type { JobRecord } from "./jobs/types.js";

type DashboardService = {
  listJobs(limit?: number): Promise<JobRecord[]>;
  getJob(jobId: string): Promise<JobRecord | null>;
  getLogInfo(jobId: string): Promise<{ preview: string | null }>;
};

export function startDashboardServer(
  port: number,
  host: string,
  service: DashboardService,
  logger: Logger,
): http.Server {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    try {
      if (url.pathname === "/api/jobs") {
        const jobs = await service.listJobs(50);
        return json(response, 200, { jobs });
      }

      if (url.pathname.startsWith("/api/jobs/")) {
        const jobId = url.pathname.replace("/api/jobs/", "");
        const job = await service.getJob(jobId);

        if (!job) {
          return json(response, 404, { error: "job not found" });
        }

        const logInfo = await service.getLogInfo(jobId);
        return json(response, 200, { job, log: logInfo.preview });
      }

      if (url.pathname === "/" || url.pathname.startsWith("/jobs/")) {
        return html(response, 200, renderPage());
      }

      return html(response, 404, "<h1>Not Found</h1>");
    } catch (error) {
      logger.error("Dashboard request failed", error);
      return json(response, 500, { error: "internal error" });
    }
  });

  server.listen(port, host, () => {
    logger.info(`Dashboard listening on http://${host}:${port}`);
  });

  return server;
}

function json(
  response: http.ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body, null, 2));
}

function html(
  response: http.ServerResponse,
  statusCode: number,
  body: string,
): void {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
  });
  response.end(body);
}

function renderPage(): string {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Automation Dashboard</title>
    <style>
      :root {
        --bg: #0f172a;
        --panel: #111827;
        --card: #1f2937;
        --muted: #94a3b8;
        --text: #e5eefc;
        --accent: #22c55e;
        --danger: #ef4444;
        --warn: #f59e0b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Iosevka Aile", "IBM Plex Sans", sans-serif;
        background:
          radial-gradient(circle at top right, rgba(34,197,94,.18), transparent 28%),
          linear-gradient(180deg, #020617 0%, var(--bg) 100%);
        color: var(--text);
      }
      a { color: inherit; }
      .wrap {
        width: min(1120px, calc(100% - 32px));
        margin: 0 auto;
        padding: 32px 0 48px;
      }
      h1 {
        font-size: clamp(28px, 4vw, 44px);
        margin: 0 0 8px;
      }
      .muted { color: var(--muted); }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: 360px 1fr;
        margin-top: 24px;
      }
      .panel {
        background: rgba(17,24,39,.82);
        border: 1px solid rgba(148,163,184,.18);
        border-radius: 18px;
        padding: 18px;
        backdrop-filter: blur(12px);
      }
      .job-list {
        display: grid;
        gap: 12px;
      }
      .job-item {
        display: block;
        background: rgba(31,41,55,.86);
        border: 1px solid rgba(148,163,184,.16);
        border-radius: 14px;
        padding: 14px;
        text-decoration: none;
      }
      .job-item:hover { border-color: rgba(34,197,94,.45); }
      .meta, pre { font-family: "IBM Plex Mono", monospace; }
      .meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        font-size: 13px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 12px;
        background: rgba(34,197,94,.16);
      }
      .danger { background: rgba(239,68,68,.16); }
      .warn { background: rgba(245,158,11,.16); }
      .details {
        display: grid;
        gap: 16px;
      }
      .cards {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      }
      .card {
        padding: 14px;
        border-radius: 14px;
        background: rgba(31,41,55,.78);
        border: 1px solid rgba(148,163,184,.14);
      }
      .card .label { color: var(--muted); font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .06em; }
      .card .value { font-size: 20px; }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        padding: 10px 8px;
        border-bottom: 1px solid rgba(148,163,184,.12);
        text-align: left;
        vertical-align: top;
      }
      pre {
        white-space: pre-wrap;
        background: rgba(2,6,23,.8);
        border: 1px solid rgba(148,163,184,.16);
        border-radius: 12px;
        padding: 14px;
        font-size: 12px;
      }
      @media (max-width: 900px) {
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Automation Dashboard</h1>
      <div class="muted">Kaggle Autopilot と Codex ジョブの実行状況を追跡します。</div>
      <div class="grid">
        <section class="panel">
          <h2>Jobs</h2>
          <div id="jobs" class="job-list"></div>
        </section>
        <section class="panel details">
          <div id="job-detail" class="muted">左のジョブを選ぶと詳細が表示されます。</div>
        </section>
      </div>
    </div>
    <script>
      const jobsEl = document.getElementById("jobs");
      const detailEl = document.getElementById("job-detail");

      function statusClass(status) {
        if (status === "failed") return "badge danger";
        if (status === "cancelled") return "badge warn";
        return "badge";
      }

      function readJobId() {
        const parts = location.pathname.split("/").filter(Boolean);
        return parts[0] === "jobs" ? parts[1] : null;
      }

      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
      }

      function renderJobList(jobs) {
        jobsEl.innerHTML = jobs.map((job) => {
          const summary = escapeHtml(job.summary ?? "-");
          return '<a class="job-item" href="/jobs/' + job.id + '">' +
            '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">' +
              '<strong>' + escapeHtml(job.tool) + '</strong>' +
              '<span class="' + statusClass(job.status) + '">' + escapeHtml(job.status) + '</span>' +
            '</div>' +
            '<div class="muted" style="margin-top:8px;">' + summary + '</div>' +
            '<div class="meta" style="margin-top:12px;">' +
              '<div><div class="muted">job_id</div><div>' + escapeHtml(job.id) + '</div></div>' +
              '<div><div class="muted">runner</div><div>' + escapeHtml(job.runner_id ?? job.target) + '</div></div>' +
            '</div>' +
          '</a>';
        }).join("");
      }

      function renderIterations(iterations) {
        if (!Array.isArray(iterations) || iterations.length === 0) {
          return '<div class="muted">iter 情報はまだありません。</div>';
        }

        return '<table><thead><tr><th>Iter</th><th>Metric</th><th>Strategy</th></tr></thead><tbody>' +
          iterations.map((item) =>
            '<tr>' +
              '<td class="meta">' + escapeHtml(item.index) + '</td>' +
              '<td>' + escapeHtml(item.metric_name ? item.metric_name + ': ' + (item.metric_value ?? '-') : (item.metric_value ?? '-')) + '</td>' +
              '<td>' + escapeHtml(item.strategy ?? '-') + '</td>' +
            '</tr>'
          ).join("") +
          '</tbody></table>';
      }

      function renderPlan(plan) {
        if (!plan) {
          return '<div class="muted">plan はまだありません。</div>';
        }

        return '<pre>' + escapeHtml(JSON.stringify(plan, null, 2)) + '</pre>';
      }

      function renderDetail(payload) {
        const job = payload.job;
        const progress = job.progress ?? {};
        detailEl.innerHTML = '' +
          '<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">' +
            '<div>' +
              '<h2 style="margin:0 0 6px;">' + escapeHtml(job.tool) + ' / ' + escapeHtml(job.id) + '</h2>' +
              '<div class="muted">' + escapeHtml(job.summary ?? '-') + '</div>' +
            '</div>' +
            '<span class="' + statusClass(job.status) + '">' + escapeHtml(job.status) + '</span>' +
          '</div>' +
          '<div class="cards">' +
            card('Phase', progress.phase ?? '-') +
            card('Iter', progress.current_iter ?? '-') +
            card('Best Metric', progress.best_metric_name ? progress.best_metric_name + ': ' + (progress.best_metric ?? '-') : (progress.best_metric ?? '-')) +
            card('Submit', progress.submission_status ?? '-') +
            card('Runner', job.runner_id ?? job.target) +
            card('Updated', progress.updated_at ?? job.updated_at) +
          '</div>' +
          '<section><h3>Strategy</h3><div>' + escapeHtml(progress.strategy_summary ?? progress.latest_agent_message ?? '-') + '</div></section>' +
          '<section><h3>Iterations</h3>' + renderIterations(progress.iterations) + '</section>' +
          '<section><h3>Plan</h3>' + renderPlan(progress.plan) + '</section>' +
          '<section><h3>Log Tail</h3><pre>' + escapeHtml(payload.log ?? '-') + '</pre></section>';
      }

      function card(label, value) {
        return '<div class="card"><div class="label">' + escapeHtml(label) + '</div><div class="value">' + escapeHtml(value) + '</div></div>';
      }

      async function refresh() {
        const jobsPayload = await fetch('/api/jobs').then((res) => res.json());
        renderJobList(jobsPayload.jobs ?? []);

        const jobId = readJobId() || jobsPayload.jobs?.[0]?.id;
        if (!jobId) {
          detailEl.innerHTML = '<div class="muted">ジョブがまだありません。</div>';
          return;
        }

        const payload = await fetch('/api/jobs/' + jobId).then((res) => res.json());
        if (payload.error) {
          detailEl.innerHTML = '<div class="muted">' + escapeHtml(payload.error) + '</div>';
          return;
        }

        renderDetail(payload);
      }

      refresh();
      setInterval(refresh, 5000);
    </script>
  </body>
</html>`;
}
