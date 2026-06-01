# Gap Analysis — `opencode-plugin-cc` v0.1.0 vs `openai/codex-plugin-cc`

**Date:** 2026-06-01
**Reference audit:** [`codex-plugin-cc-feature-audit.md`](codex-plugin-cc-feature-audit.md)
**Mục đích:** Liệt kê feature codex có mà opencode-plugin-cc CHƯA có, prioritize cho roadmap.

---

## Inventory đối chiếu

| Component         | codex-plugin-cc                                                | opencode-plugin-cc v0.1.0                                            | Diff |
| ----------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- | ---- |
| Commands          | 7 (review / adversarial-review / rescue / status / result / cancel / setup) | 5 (oc-plan / oc-exec / oc-verify / oc-status_v2 / oc-result_v2) | **-3 real, -2 placeholder** |
| Agents            | 1 (codex-rescue, forwarder)                                    | 1 (opencode-reviewer, JSON-verdict)                                  | 0    |
| Hooks             | 3 (SessionStart / SessionEnd / Stop-review-gate)               | 1 (SessionStart preflight)                                           | **-2** |
| Scripts           | 4+ (companion / broker / lifecycle / stop-gate + lib/)         | 5 (cli / opencode-bridge / retry-loop / stream-reader / schema-validator) | role-different |
| Skills            | 3 (cli-runtime / result-handling / gpt-5-4-prompting)          | 0                                                                    | **-3** |
| Schemas           | 1 (review-output)                                              | 1 (opencode-output)                                                  | **0 nhưng khác mục đích** |
| Prompts dir       | 2 (adversarial-review / stop-review-gate)                      | 0 (system msg baked vào command markdown)                            | **-2 (refactor)** |
| State persistence | jobs/<id>.json + state.json + logs                             | trace.jsonl per-cwd only                                             | **gap major** |
| Background jobs   | Full (jobId + fork + status + cancel + resume)                 | Synchronous only (placeholders cho status/result)                    | **gap major** |
| Concurrency       | Broker pattern (multiplex N CC → 1 Codex app-server)           | Sequential, không broker                                             | **gap, v2** |

---

## Gap chi tiết theo nhóm

### Nhóm A — Commands thiếu

| # | Feature                          | codex-plugin-cc                                        | opencode-plugin-cc | Severity | Justification                                                                                       |
| - | -------------------------------- | ------------------------------------------------------ | ------------------ | -------- | --------------------------------------------------------------------------------------------------- |
| A1 | Standalone `/oc-review`         | `/codex:review` — read-only review git diff hiện tại    | Không (review chỉ trong `/oc-exec` retry loop) | **P0** | User cần review code đã có sẵn (commit unstaged) mà không cần delegate execute. Read-only, an toàn. |
| A2 | `/oc-adversarial-review`        | `/codex:adversarial-review` steerable, find-reasons-NOT-to-ship | Không                              | **P1** | Adversarial posture quan trọng cho security-critical change. OpenCode reviewer hiện default cooperative. |
| A3 | `/oc-cancel`                    | `/codex:cancel <jobId>` SIGTERM running process        | Không                              | **P0** | MVP synchronous — không có job để cancel. Nhưng nếu task timeout (5min), user kẹt chờ. Cần Ctrl-C handler ít nhất. |
| A4 | `/oc-setup`                     | `/codex:setup --enable-review-gate`                    | Không (chỉ có SessionStart hook warn)         | **P1** | Setup wizard verify install + opt-in review gate. UX onboarding tốt hơn warning thầm.               |
| A5 | `/oc-status` real impl          | `/codex:status [jobId]` list active/recent jobs        | Placeholder v2                     | **P1** | Phụ thuộc background job system (gap C2). Khi có background, status mandatory.                       |
| A6 | `/oc-result` real impl          | `/codex:result [jobId]` fetch completed output         | Placeholder v2                     | **P1** | Phụ thuộc background job system. Khi có background, result mandatory.                                |

### Nhóm B — Hooks thiếu

| # | Hook                            | codex-plugin-cc                                            | opencode-plugin-cc | Severity | Justification                                                                                  |
| - | ------------------------------- | ---------------------------------------------------------- | ------------------ | -------- | ---------------------------------------------------------------------------------------------- |
| B1 | `SessionEnd` lifecycle          | `session-lifecycle-hook.mjs SessionEnd` — persist state    | Không              | **P1** | MVP không có state để persist (trace.jsonl auto-append). Khi thêm background jobs → mandatory. |
| B2 | `Stop` review-gate (opt-in)     | `stop-review-gate-hook.mjs` — block stop nếu critical finding | Không           | **P1** | Safety net: ngăn user accidentally exit khi reviewer flag critical issue. Tuỳ opt-in.          |
| B3 | `PreToolUse` guard (potential)  | Không (codex không có)                                     | Không              | n/a      | Có thể add cho `Bash` tool: block `rm -rf /` nếu opencode prompt suggest, nhưng overkill MVP.  |

### Nhóm C — State + Background job system

| # | Feature                          | codex-plugin-cc                                                | opencode-plugin-cc | Severity | Justification                                                                                       |
| - | -------------------------------- | -------------------------------------------------------------- | ------------------ | -------- | --------------------------------------------------------------------------------------------------- |
| C1 | jobId tracking + state files     | `~/.codex/plugin-state/jobs/<jobId>.json` + `.log`             | Không (chỉ trace.jsonl append) | **P1** | Foundation cho /status, /result, /cancel, /rescue --resume.                                          |
| C2 | Background fork                  | `--background` flag → returns jobId ngay, run async             | Không              | **P1** | Long task >1 phút không block CC. Hiện synchronous chờ tới 5 phút timeout.                          |
| C3 | Session resumption (`--resume`)  | `/codex:rescue --resume` tiếp tục thread cũ                     | Không              | **P2** | UX nice-to-have. OpenCode session ID không expose ra plugin → cần thiết kế bridge.                  |
| C4 | Cross-session safety             | Issue #82 (cancel-without-jobId race) — codex bị BUG, opencode chưa | Chưa có concept job → no race | **P3** | Khi build job system → tránh bug này (require jobId explicit hoặc scope per-session).               |

### Nhóm D — Concurrency / Broker

| # | Feature                       | codex-plugin-cc                                  | opencode-plugin-cc | Severity | Justification                                                                                  |
| - | ----------------------------- | ------------------------------------------------ | ------------------ | -------- | ---------------------------------------------------------------------------------------------- |
| D1 | App-server broker             | `app-server-broker.mjs` — N requests → 1 socket  | Không (sequential) | **P2** | Codex CLI single-session. OpenCode `serve` mode hỗ trợ concurrent natively. Có thể skip broker nếu chuyển sang HTTP daemon (Option B từ brainstorm). |
| D2 | Concurrent task in `/oc-exec all` | `/codex:rescue` foreground/background mix       | Sequential only    | **P2** | Hiện `/oc-exec all` chạy task tuần tự. Có thể parallel khi nhiều task độc lập.                 |

### Nhóm E — Reviewer / Schema chặt

| # | Feature                                       | codex-plugin-cc                                              | opencode-plugin-cc                                              | Severity | Justification                                                       |
| - | --------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| E1 | Reviewer output JSON schema strict            | `schemas/review-output.schema.json` (verdict/findings/next_steps) | Không có schema cho reviewer agent (chỉ có schema cho opencode CLI output) | **P0** | Reviewer agent trả JSON nhưng plugin parse free-form → fragile. Cần Ajv validate. |
| E2 | Confidence score 0–1 per finding              | ✓                                                            | Không                                                           | **P2** | Codex confidence dùng để rank findings. Nice-to-have.               |
| E3 | Severity enum + line range strict             | ✓ (critical/high/medium/low + line_start/line_end)           | Reviewer prompt có gợi ý severity nhưng không enforce trong code | **P1** | Khi build /oc-review standalone → cần để filter findings.           |
| E4 | Adversarial system prompt separate            | `prompts/adversarial-review.md` standalone                   | Không (system msg trong agent markdown)                          | **P2** | Refactor concern; tốt cho A/B test multiple reviewer modes.         |

### Nhóm F — Skills

| # | Feature                            | codex-plugin-cc                                          | opencode-plugin-cc | Severity | Justification                                                                |
| - | ---------------------------------- | -------------------------------------------------------- | ------------------ | -------- | ---------------------------------------------------------------------------- |
| F1 | `opencode-cli-runtime` skill       | `codex-cli-runtime` SKILL.md với rules forwarding        | Không              | **P3** | Skill = Claude Code feature riêng. Plugin có thể không cần. Refactor concern. |
| F2 | `opencode-result-handling` skill   | `codex-result-handling` SKILL.md                         | Không              | **P3** | Same.                                                                         |
| F3 | Model-specific prompting skill     | `gpt-5-4-prompting`                                      | Không              | **P3** | Có thể add prompting tip riêng cho free model (`groq-llama-prompting` etc.). |

### Nhóm G — Configuration

| # | Feature                              | codex-plugin-cc                                       | opencode-plugin-cc                                | Severity | Justification                                                                                   |
| - | ------------------------------------ | ----------------------------------------------------- | ------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| G1 | Plugin-level config file             | `~/.codex/config.toml` + `.codex/config.toml`         | Không (dùng opencode.json của opencode CLI)        | **P2** | Plugin-specific config (max-retry, default model, trace path, review-gate enable) nên tách riêng. |
| G2 | Project-level override               | ✓ project `.codex/config.toml` trumps user            | Không                                             | **P2** | Cho phép per-project tuning (vd Mobio repo dùng Ollama local cho privacy).                      |
| G3 | Reasoning effort flag                | `--effort none\|minimal\|low\|medium\|high\|xhigh`    | Không (OpenCode hỗ trợ `--variant high/max/minimal`) | **P2** | Add `--effort` flag cho `/oc-exec` → pass-through tới OpenCode `--variant`.                    |

---

## Roadmap đề xuất

### v0.2.0 — Parity Sprint (P0)

Focus: bịt 3 gap critical cho production-ready.

1. **E1 — Reviewer output schema strict** (`schemas/reviewer-output.json` + Ajv validate trong `/oc-exec` flow). Avoid fragile parsing.
2. **A1 — `/oc-review` standalone command** — read-only review trên git diff hiện tại (uncommitted hoặc branch vs main). Spawn opencode với agent `plan` mode + reviewer subagent.
3. **A3 — `/oc-cancel` + timeout UX** — Ctrl-C handler + cancel command (cho cả MVP sync timeout). Foundation cho async sau.

Effort: ~6h dev (3 phase TDD).

### v0.3.0 — Background Jobs (P1 nhóm C + A)

Foundation: build job system → unlock A4/A5/A6/B1/B2.

4. **C1 + C2 — Job state machine + background fork**
   - `~/.opencode-plugin/jobs/<jobId>.json`
   - `/oc-exec --background` returns jobId immediately
5. **A5 — `/oc-status [jobId]` real impl**
6. **A6 — `/oc-result [jobId]` real impl**
7. **B1 — `SessionEnd` hook** persist active jobs
8. **A4 — `/oc-setup` wizard** verify install + opt-in flags
9. **B2 — `Stop` review-gate hook** (opt-in via `/oc-setup --enable-review-gate`)

Effort: ~15-20h dev.

### v0.4.0 — Adversarial + Reasoning (P1+P2)

10. **A2 — `/oc-adversarial-review`** với separate prompt file (E4)
11. **E3 — Severity enum + line range strict** trong schema
12. **G3 — `--effort` flag pass-through**
13. **G1 + G2 — Plugin-level config** (`~/.opencode-plugin/config.json` + project override)

Effort: ~8h dev.

### v0.5.0 — Concurrency (P2)

14. **D1 / D2 — Daemon mode (Option B từ brainstorm gốc)** — switch hoặc bổ sung HTTP daemon (`opencode serve`), KHÔNG cần broker vì OpenCode đã hỗ trợ concurrent natively.
15. **C3 — Session resumption** (`--resume`)

Effort: ~12h dev.

### Defer (P3, possibly never)

- F1/F2/F3 skills — Claude Code skill model có giá trị low cho plugin này.
- Adversarial mode advanced (multi-pass, panel) — overkill.

---

## Tổng kết

| Mức      | Số gap | Đề xuất                                                                                    |
| -------- | ------ | ------------------------------------------------------------------------------------------ |
| P0       | 3      | v0.2.0 next sprint — reviewer schema + standalone review + cancel/timeout UX                |
| P1       | 8      | v0.3.0 + v0.4.0 — background jobs foundation rồi adversarial + config                       |
| P2       | 6      | v0.5.0 — daemon concurrency + reasoning + resumption                                        |
| P3       | 3      | Defer — skill model + advanced adversarial                                                  |

**Khuyến nghị bước kế:**

1. Chạy **pilot phase-08** trước (validate hypothesis chi phí). KHÔNG xây v0.2.0 nếu pilot không đạt ≥50% saving — bịt gap không cứu được sản phẩm fail product-market fit.
2. Nếu pilot pass → kick off v0.2.0 sprint với 3 P0 gap. Đó là điểm bùng nổ về tính an toàn (schema), khả năng dùng (standalone review), và UX (cancel).
3. Background jobs (v0.3.0) là biggest engineering effort — chỉ làm khi confirm user dùng cho task >1 phút (vd refactor large codebase).
