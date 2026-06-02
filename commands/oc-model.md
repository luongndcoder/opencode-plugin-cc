---
description: List opencode models (free + paid OpenCode Zen) and let the user pick which one /oc-exec uses. Saves the choice per project.
---

# /oc-model — Choose the executor model

OpenCode có **free model** (chất lượng khác nhau) và **paid model (OpenCode Zen)** rẻ + chất lượng cao hơn. Lệnh này liệt kê model + cost để user chọn; lựa chọn lưu vào `<cwd>/.opencode-plugin/config.json` và dùng cho mọi `/opencode-plugin-cc:oc-exec` sau đó.

> Định hướng: **Claude (Pro) plan → OpenCode (Zen) execute**. Vì Zen rất rẻ nên có thể dùng paid model để execute mà tổng chi phí vẫn thấp hơn nhiều so với để Claude tự code.
>
> **QUAN TRỌNG — namespace lệnh.** Mọi lệnh gợi ý cho user PHẢI ở dạng `/opencode-plugin-cc:oc-*`.

## Flow

1. **List models** — Bash:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/model-selector.mjs" --list --all
   ```
   Trả JSON `{ includes_paid: true, models: [{ id, input, output, free, context, toolcall }] }`.
   Sort: free trước (tốt nhất trước), rồi paid (rẻ nhất trước). `input`/`output` = giá opencode (USD / 1M tokens).
   - exit 3 / `OpencodeNotInstalledError` → gợi ý `/opencode-plugin-cc:oc-install`, STOP.
   - `models` rỗng → "Không có model nào. Đăng nhập opencode / cấu hình provider." STOP.

2. **Hiện danh sách** cho user, chia 2 nhóm:
   - **Free** — mỗi dòng: `<id>` — context `<context>` — `FREE`.
   - **Paid (OpenCode Zen)** — mỗi dòng: `<id>` — context `<context>` — in `$<input>` / out `$<output>` per 1M tokens.

3. **Hỏi chọn** — `AskUserQuestion` (single-select):
   - question: "Chọn model để OpenCode execute. Free = $0. Paid (Zen) = chất lượng cao hơn, tính phí theo cost ở trên (rất rẻ)."
   - header: "Model"
   - options: tối đa **4** model tiêu biểu (mix vài free + vài paid đáng chú ý; label = id, description = FREE hoặc `in $x / out $y`). Nói rõ trong question: chọn **Other** để gõ chính xác bất kỳ `<provider>/<model>` đã liệt kê ở bước 2 (free hoặc paid).
   - Nếu user chọn **paid** → trong xác nhận nêu lại cost để user biết mình sẽ bị tính phí.
   - KHÔNG tự chọn hộ.

4. **Validate + Lưu**:
   - `<chosen-id>` phải nằm trong danh sách `models` ở bước 1 (free hoặc paid). Không khớp → cảnh báo + hỏi lại.
   - Bash: `node "${CLAUDE_PLUGIN_ROOT}/scripts/model-config.mjs" set "${CWD}" "<chosen-id>"`.

5. **Xác nhận**: "✅ Đã lưu model `<chosen-id>`" + (nếu paid) "— tính phí ~in $<input>/out $<output> per 1M tokens". "Chạy `/opencode-plugin-cc:oc-exec <task>` để dùng. Đổi lại: `/opencode-plugin-cc:oc-model`."

## Constraints

- KHÔNG chạy exec ở đây — chỉ chọn + lưu model.
- Cho chọn **free hoặc paid Zen**, nhưng `<chosen-id>` BẮT BUỘC phải có trong output `--list --all` (model thật trên account này). KHÔNG bịa id.
- Khi user chọn paid → phải hiển thị cost rõ ràng trước khi lưu (informed consent về chi phí).
- Lưu per-project tại `<cwd>/.opencode-plugin/config.json` (key `model`).
- Lưu ý: auto-pick (khi user chưa chọn gì) luôn chỉ chọn **free** — paid chỉ khi user chủ động chọn ở đây hoặc truyền `--model` trực tiếp.
