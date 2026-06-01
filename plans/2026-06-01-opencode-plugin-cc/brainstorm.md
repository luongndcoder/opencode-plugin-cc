# Brainstorm — `opencode-plugin-cc`

**Date:** 2026-06-01
**Author:** brainstorm session (luongnd@mobio.io)
**Status:** awaiting user approval

---

## Vấn đề + yêu cầu

Xây 1 Claude Code plugin tên `opencode-plugin-cc` cho phép Claude Code (CC) **plan** và uỷ thác **execute** sang OpenCode (CLI agent opensource, hỗ trợ multi-provider — Ollama / Groq / OpenRouter / DeepSeek free tier).

Goal core:

- **Tiết kiệm chi phí** — CC giữ vai trò architect/reviewer (đắt nhưng cần thiết), OpenCode chạy execution với free model (rẻ/miễn phí).
- **Full orchestration** workflow: plan → exec → verify, có retry loop khi free model fail.
- Lấy cảm hứng kiến trúc từ `openai/codex-plugin-cc` nhưng wrap sang OpenCode.

---

## Stack context

- **Greenfield project** — `/Users/luongcoder/Documents/AI/opencode-plugin-cc` đang empty.
- Target runtime: Claude Code plugin (Node.js scripts + Markdown commands/agents/hooks).
- Executor target: OpenCode CLI (Bun runtime + Hono server + SQLite session store).
- Communication options khả dụng theo research:
  1. Subprocess: `opencode run "<prompt>" --path . --mode <plan|build> -f json`
  2. HTTP daemon: `opencode serve --port N` → REST API
  3. MCP bridge: `opencode server --acp` → stdio MCP server (chưa verify stable)

---

## Existing code liên quan

Không có (greenfield). Reference architecture chính:

- `openai/codex-plugin-cc` — plugin structure (`.codex-plugin/{agents,commands,hooks,scripts,skills}`) + master script `codex-companion.mjs` fork subprocess `codex review/rescue` + JSON stdout parse + file-based job tracking.
- Known issue codex-plugin-cc: high-volume stdout (>4KB) gây deadlock, `--background` flag parse fragile (issues #277, #279).

---

## Findings

| #   | Câu hỏi                                | Answer                                                 | Status              | Source                                       |
| --- | -------------------------------------- | ------------------------------------------------------ | ------------------- | -------------------------------------------- |
| 1   | Scope plugin?                          | Full orchestration (plan/exec/verify)                  | user-confirmed      | clarify Q1                                   |
| 2   | Verify strategy?                       | Hybrid — reviewer agent + test gate + retry max 2 lần  | user-confirmed      | clarify Q2                                   |
| 3   | codex-plugin-cc invocation pattern?    | Subprocess + JSON stdout + master companion script     | verified-by-source  | research §I                                  |
| 4   | OpenCode headless capability?          | Có `opencode run -f json` + `opencode serve` HTTP      | verified-by-source  | research §II                                 |
| 5   | OpenCode JSON output schema stable?    | MEDIUM confidence — schema có nhưng chưa stress-tested | flagged-risk        | research §V                                  |
| 6   | Free model provider sẽ dùng?           | Chưa chốt — defer vào `/be-plan` (config-level)        | deferred            | —                                            |
| 7   | Concurrent task execution có cần?      | Defer — MVP single task, scale sau                     | deferred            | YAGNI                                        |
| 8   | Plugin distribution (marketplace/git)? | Defer — git repo first                                 | deferred            | —                                            |

---

## 3 Approaches

### Option A — Subprocess + JSON Wrapper (clone codex-plugin-cc pattern)

**Mechanism:** Plugin fork subprocess `opencode run "<prompt>" --path <cwd> --mode <plan|build> -f json`, parse stdout JSON, return về CC.

**Plugin structure:**

```
opencode-plugin-cc/
├── .claude-plugin/plugin.json
├── agents/
│   └── opencode-reviewer.md         # reviewer agent (CC, đọc diff)
├── commands/
│   ├── oc-plan.md                   # CC plan task list (no opencode call)
│   ├── oc-exec.md                   # forward task → opencode-bridge.mjs
│   ├── oc-verify.md                 # spawn reviewer agent + run tests
│   ├── oc-status.md                 # poll background job
│   └── oc-result.md                 # fetch background result
├── hooks/
│   └── hooks.json                   # PostToolUse: auto-run reviewer sau exec
├── scripts/
│   ├── opencode-bridge.mjs          # main subprocess invoker
│   ├── stream-reader.mjs            # chunked stdout reader (tránh deadlock)
│   └── retry-loop.mjs               # retry logic max 2 lần
└── schemas/opencode-output.json     # JSON schema cho output validation
```

**Pros:**

- Leverage proven pattern (codex-plugin-cc đã chạy production).
- Zero daemon — không cần manage port/lifecycle.
- Compatible với mọi user setup (chỉ cần `opencode` CLI trong PATH).
- Implementation cost thấp nhất — ~7-10 file.

**Cons:**

- Subprocess overhead (~100-300ms spawn) — tích luỹ qua nhiều task.
- High-volume stdout deadlock risk (kế thừa từ codex-plugin-cc) — cần stream-reader chunked.
- JSON schema OpenCode chưa stable → parse fragile, version-drift bug.
- Không concurrent — task sequential.

---

### Option B — HTTP Daemon (opencode serve)

**Mechanism:** Plugin start `opencode serve --port 9999` lúc init, gọi REST API `POST /api/run`, poll status, fetch diff.

**Plugin structure:**

```
opencode-plugin-cc/
├── .claude-plugin/plugin.json
├── agents/opencode-reviewer.md
├── commands/oc-{plan,exec,verify,status,result}.md
├── hooks/
│   ├── hooks.json                   # SessionStart: ensure daemon running
│   └── ensure-daemon.mjs
└── scripts/
    ├── daemon-manager.mjs           # start/stop/health-check opencode serve
    ├── opencode-http-client.mjs     # REST client
    └── retry-loop.mjs
```

**Pros:**

- Stable transport (HTTP > stdout parsing) — codes rõ ràng, schema versioned.
- Concurrent execution sẵn — daemon manage queue.
- Background task built-in (webhook callback).
- Better error handling — HTTP 4xx/5xx + structured error body.

**Cons:**

- Daemon lifecycle phức tạp — port conflict, zombie process, crash recovery.
- Setup friction — user phải biết daemon đang chạy / restart khi update.
- Overhead init (~2-5s start daemon) cho task ngắn.
- Bug surface lớn hơn — cần health-check, log rotation, port binding strategy.

---

### Option C — MCP Server Bridge

**Mechanism:** Plugin register OpenCode như MCP server (`opencode server --acp` stdio MCP), CC gọi OpenCode tools native trong agentic loop.

**Plugin structure:**

```
opencode-plugin-cc/
├── .claude-plugin/plugin.json
├── mcp.json                         # register opencode MCP server
├── agents/opencode-reviewer.md
└── commands/oc-{plan,verify}.md    # exec không cần — CC tự gọi MCP tool
```

**Pros:**

- Tích hợp sâu nhất — OpenCode tool xuất hiện trong CC tool list native.
- CC tự quyết khi nào gọi OpenCode (agentic loop), không cần slash command thủ công.
- Type-safe — MCP có schema bắt buộc.
- Plugin minimum — chỉ ~3-4 file Markdown.

**Cons:**

- OpenCode MCP support **chưa verify stable** — research confidence MEDIUM, chưa thấy docs chính thức về `server --acp` schema.
- CC sẽ "tự ý" gọi OpenCode — mất control "khi nào delegate" → defeats verify gate strategy (user đã chốt Hybrid review).
- Khó implement retry loop + risk-tagging vì invocation nằm trong agentic loop của CC, không có rung mid-step.
- Debug khó hơn — MCP stdio protocol opaque hơn HTTP/subprocess.

---

## Trade-off Matrix

| Criterion          | A. Subprocess+JSON | B. HTTP Daemon   | C. MCP Bridge      |
| ------------------ | ------------------ | ---------------- | ------------------ |
| Performance        | Medium (spawn cost)| High (warm)      | High (in-loop)     |
| Complexity         | Low                | Medium-High      | Medium             |
| Reliability        | Medium (stdout)    | High (HTTP)      | Unknown (chưa thử) |
| Setup friction     | Low                | Medium           | Low                |
| Concurrent support | No                 | Yes              | Limited            |
| Time to MVP        | 2-3 ngày           | 5-7 ngày         | 3-4 ngày (rủi ro)  |
| Control over flow  | High               | High             | Low (CC tự gọi)    |
| Verify gate fit    | Tốt                | Tốt              | Yếu                |
| Risk surface       | Medium             | High             | High (untested)    |
| Reuse codex pattern| 100%               | 30%              | 0%                 |

---

## Hướng đề xuất: **Option A (Subprocess + JSON)** cho MVP

### Lý do

1. **Match user goal core** — user nói "tương tự codex-plugin-cc nhưng nối sang opencode". Option A clone pattern → MVP nhanh, ít risk, dễ debug nếu lỗi.
2. **Verify gate strategy phù hợp** — user chốt Hybrid review; cần plugin có control rõ ràng giữa các step (exec → review → test → retry). Subprocess invocation cho phép intercept output từng task → review từng diff. Option C mất control này.
3. **YAGNI** — concurrent execution, daemon HA, webhook chưa cần thiết cho MVP. Defer khi có pain point thực.
4. **Risk floor thấp** — không phụ thuộc OpenCode MCP/HTTP stability (cả 2 đều MEDIUM confidence trong research). Subprocess + JSON là path "well-trodden" nhất.
5. **Cost saving claim chứng minh được sớm** — chỉ cần 1 task exec qua OpenCode + free model là validate được hypothesis tiết kiệm; daemon/MCP setup làm slow time-to-feedback.

### Caveats / điều kiện

- **Phải implement chunked stdout reader** ngay từ MVP — KHÔNG chờ deadlock xảy ra (issue #277/279 của codex-plugin-cc là cảnh báo). Stream stdout qua `readline` interface, không buffer toàn bộ.
- **JSON output schema unstable** — phải có schema validator (Ajv) ở `schemas/opencode-output.json`, fail fast khi OpenCode bump version đổi schema. Pin OpenCode version trong README.
- **Reviewer agent prompt phải explicit** — agent đọc diff phải biết check: scope creep, security (SQL/XSS injection nếu touch web code), test coverage, tenant isolation (nếu repo Mobio backend). Không generic "review code này".
- **Retry loop bounded** — max 2 retry, mỗi retry feed-back: previous diff + reviewer feedback + test output. KHÔNG infinite loop.

### Khi nào chọn Option B (HTTP Daemon)

- Concurrent task > 1 task/lần (vd plugin sẽ dispatch 5 task song song).
- User pain point: subprocess spawn cost tích luỹ > 30% wall-clock.
- Cần webhook push thay vì poll (task >5 phút).
- → Lúc đó migrate sang B, giữ commands/agents interface cũ, chỉ thay scripts/.

### Khi nào chọn Option C (MCP)

- Khi OpenCode chính thức release MCP server stable (verify qua `opencode --version` + docs).
- User muốn CC "tự delegate" trong agentic loop, KHÔNG cần slash command thủ công.
- Verify strategy chuyển sang "trust OpenCode + test gate only" (user hiện đang chọn Hybrid → C không fit).

---

## Self-review inline

| Check                       | Result                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant isolation            | N/A — greenfield plugin, không touch Mobio data layer. Tuy nhiên reviewer-agent template cần include tenant-isolation check nếu plugin được dùng trên Mobio repo. |
| Schema/index migration      | N/A                                                                                                                                                                 |
| Event schema                | N/A — không có Kafka                                                                                                                                                |
| Breaking change             | Greenfield → no break                                                                                                                                               |
| PII / NĐ 13                 | Plugin không log/store PII; OpenCode prompt có thể chứa source code nội bộ — cần `.gitignore` cho `plans/` + cảnh báo trong README                                  |
| Observability               | Cần log trace mỗi subprocess call: `traceId` (uuid v4), command, duration, exit code. Stored at `plans/{date}-{slug}/trace.jsonl`                                   |
| YAGNI / KISS / DRY          | Pass — option A minimum file, reuse codex pattern; defer concurrent/daemon/MCP                                                                                      |
| Smallest correct change     | Pass — 7-10 file, không over-abstract                                                                                                                               |

---

## Rủi ro + mitigation

| Rủi ro                                              | Severity | Mitigation                                                                                                  |
| --------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| OpenCode JSON output schema đổi khi bump version    | High     | Pin OpenCode version trong `plugin.json` engines field + Ajv validate + fail fast với error message rõ      |
| Subprocess stdout deadlock với output lớn           | High     | Chunked stream reader từ MVP (Node `readline.createInterface` over child.stdout)                            |
| Free model output quality thấp → retry > 2 lần      | Medium   | Reviewer agent trả structured score; nếu 2 retry vẫn fail → escalate cho user (KHÔNG silent fail)            |
| Reviewer agent (CC) tốn token nhiều hơn dự kiến     | Medium   | Đo cost thực trên 5 task pilot; nếu reviewer > 40% total cost → simplify reviewer prompt hoặc downgrade |
| OpenCode CLI not in PATH → confusing error          | Low      | Plugin hook `SessionStart` check `opencode --version`, fail với hướng dẫn install                          |
| Plugin distribution / install path không chuẩn      | Low      | Follow Claude Code plugin spec (`.claude-plugin/plugin.json`)                                              |
| User repo có sensitive code → leak ra OpenCode model | Medium   | README cảnh báo + recommend opt-in per project + log prompt content vào trace để audit                       |

---

## Tiêu chí thành công + verify

1. **Functional MVP** — chạy được flow: `/oc-plan "task X"` → CC plan ra task list → `/oc-exec` → OpenCode execute → reviewer agent review diff → test pass → commit-ready diff hiện trong CC.
2. **Cost validation** — đo token cost 5 task pilot (vd: viết unit test, refactor function nhỏ, fix lint, write README section, generate CRUD endpoint). So sánh với chạy 100% trên CC. Target: tiết kiệm ≥ 50%.
3. **Reliability** — pilot 20 task; OpenCode fail < 30%, retry succeed > 70% trong fail case, reviewer catch wrong-output ≥ 80%.
4. **Setup smoke test** — fresh machine, install Claude Code + opencode + plugin, chạy 1 task end-to-end < 10 phút.
5. **Observability** — trace.jsonl đầy đủ field; user grep được "task nào fail vì lý do gì".

---

## Quyết định chưa chốt (defer sang `/be-plan`)

1. **Free model provider mặc định** — Ollama local? Groq llama? DeepSeek? → config-level, user chọn trong `opencode.json`.
2. **Plugin distribution** — git repo (clone & install) vs Claude Code marketplace? → khi MVP ổn.
3. **Concurrent execution** — defer cho phase 2.
4. **Risk-tagging adaptive verify** (option D từ verify question) — defer; nếu Hybrid quá đắt sẽ revisit.
5. **State persistence** — task history lưu ở đâu (plans/ vs SQLite)? → `/be-plan` quyết.

---

## Bước tiếp theo

1. ✅ Brainstorm xong (file này).
2. ▶️ User approve qua `ExitPlanMode`.
3. Tiếp theo: `/be-plan plans/2026-06-01-opencode-plugin-cc/brainstorm.md` để dựng plan kỹ thuật chi tiết (file structure, schema, retry algo, reviewer prompt template, test plan).
4. Sau plan: `/be-ship` MVP — implement Option A.
5. Pilot 5-20 task → đo cost saving thực tế → quyết phase 2.

---

## Unresolved questions

- Plugin có cần hỗ trợ task **không-code** (vd write doc, generate diagram)? Hay chỉ code execution? → ảnh hưởng reviewer prompt template.
- Khi OpenCode execute fail toàn bộ (vd model offline) — fallback về CC tự làm hay bail-out? → policy decision.
- Có cần "dry-run" mode (OpenCode plan + diff preview, KHÔNG apply file changes)? → UX decision.

---

## Addendum — 2026-06-01: Target `anomalyco/opencode` thay vì `sst/opencode`

User point `https://github.com/anomalyco/opencode`. Research xác minh (file `research/anomalyco-opencode-variant.md`):

- `anomalyco/opencode` **không phải fork** — là **chính thể OpenCode hiện tại** (project chuyển từ SST → Anomaly Innovations, issue [#705](https://github.com/anomalyco/opencode/issues/705)). MIT license, ~167K stars, actively maintained.
- `sst/opencode` legacy — SST team giờ focus infra, không phát triển opencode thêm.
- **CLI tương thích cao** với reference cũ: `opencode run "<prompt>"` + `opencode serve` + `--format json` đều giữ nguyên syntax.
- **Free model support cải thiện** — flag `--model free` random-select trong pool free models (Ollama / llama.cpp / LM Studio + 75+ provider qua Models.dev).
- **Known bug to avoid:** issue [#2923](https://github.com/anomalyco/opencode/issues/2923) — `--format json` + `--command` flag combo bị drop JSON output. Plugin **không được dùng combo này**.

### Điều chỉnh Option A (vẫn giữ recommendation):

1. **Target binary:** `anomalyco/opencode` (≥ v1.2 — free model mature từ version này). Pin version trong `.claude-plugin/plugin.json` engines field.
2. **Bridge invocation syntax:** `opencode run "<prompt>" --path <cwd> --format json` (chú ý là `--format json`, không phải `-f json` như viết trong sst legacy docs — cần verify lại trong `/be-plan` bằng `opencode run --help`).
3. **Avoid combo:** plugin KHÔNG truyền cả `--format json` + `--command` cùng lúc. Nếu cần custom command, dùng prompt-level direction thay vì flag.
4. **Default free model strategy:** `--model free` cho auto-select; user có thể override qua `.opencode.json` ở project root.
5. **Pre-flight check:** plugin hook `SessionStart` chạy `opencode --version` — fail rõ nếu < v1.2 hoặc binary thiếu, kèm link `https://github.com/anomalyco/opencode`.

### Bổ sung rủi ro:

| Rủi ro                                                      | Severity | Mitigation                                                                                |
| ----------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| Bug #2923 `--format json` + `--command` drop output         | Medium   | Plugin code cấm combo này (lint trong bridge); README ghi rõ                              |
| `anomalyco/opencode` còn dưới 2 năm tuổi → breaking change   | Medium   | Pin version exact; CI test khi bump; semver track release notes                            |
| `--model free` chọn model nào không deterministic            | Low      | Log model thực tế dùng vào trace.jsonl mỗi run; user override qua opencode config nếu cần |

Findings table bổ sung:

| #   | Câu hỏi                                | Answer                                                       | Status              | Source                        |
| --- | -------------------------------------- | ------------------------------------------------------------ | ------------------- | ----------------------------- |
| 9   | OpenCode binary target?                | `anomalyco/opencode` ≥ v1.2                                  | user-confirmed      | follow-up message             |
| 10  | CLI compat anomalyco vs sst?           | Tương thích cao (`run` / `serve` / `--format json` giữ syntax) | verified-by-research | research/anomalyco-…md       |
| 11  | Bug nào phải né?                       | `--format json` + `--command` combo → drop JSON              | verified-by-research | issue [#2923]                 |
| 12  | Free model selection?                  | `--model free` auto-select, override qua `.opencode.json`    | verified-by-research | anomalyco mintlify docs       |

**Quyết định:** giữ Option A, đổi target binary sang `anomalyco/opencode`. Không thay đổi architecture, không thay verify strategy. Sẵn sàng sang `/be-plan`.
