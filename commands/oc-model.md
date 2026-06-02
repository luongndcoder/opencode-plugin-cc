---
description: List currently-free opencode models and let the user pick which one /oc-exec uses. Saves the choice per project.
---

# /oc-model — Choose the free model

OpenCode có nhiều free model với **chất lượng khác nhau**. Lệnh này liệt kê model đang free và để user chọn; lựa chọn được lưu vào `<cwd>/.opencode-plugin/config.json` và dùng cho mọi `/opencode-plugin-cc:oc-exec` sau đó.

> **QUAN TRỌNG — namespace lệnh.** Mọi lệnh gợi ý cho user PHẢI ở dạng `/opencode-plugin-cc:oc-*`. Bare `/oc-*` không hợp lệ.

## Flow

1. **List free models** — Bash:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/model-selector.mjs" --list
   ```
   Trả JSON `{ models: [{ id, context, toolcall }] }` (đã sort: tốt nhất trước).
   - exit 3 / `OpencodeNotInstalledError` → opencode chưa cài → gợi ý `/opencode-plugin-cc:oc-install`, STOP.
   - `models` rỗng → "Không có free model nào trên opencode hiện tại. Cấu hình provider hoặc đăng nhập opencode." STOP.

2. **Hiện danh sách** cho user dạng text (đánh số), mỗi dòng: `<id>` — context `<context>` tokens — toolcall `<toolcall>`.

3. **Hỏi chọn** — `AskUserQuestion` (single-select):
   - question: "Chọn free model để OpenCode chạy task (chất lượng & tốc độ khác nhau):"
   - header: "Free model"
   - options: tối đa **4** model đầu trong list (id làm label, mô tả gồm context + toolcall). Nếu có > 4 model → chỉ đưa 4 cái đầu vào options; nói rõ trong question rằng user có thể chọn **Other** rồi gõ chính xác `<provider>/<model>` của bất kỳ model nào đã liệt kê ở bước 2.
   - KHÔNG tự ý chọn hộ — phải để user quyết.

4. **Lưu lựa chọn** — Bash (chọn xong):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/model-config.mjs" set "${CWD}" "<chosen-id>"
   ```
   Validate `<chosen-id>` phải nằm trong danh sách free ở bước 1 (nếu user gõ Other) — nếu không khớp, cảnh báo + hỏi lại.

5. **Xác nhận**: "✅ Đã lưu model `<chosen-id>` cho project này. Chạy `/opencode-plugin-cc:oc-exec <task>` để dùng." Đổi lại bất cứ lúc nào bằng cách chạy lại `/opencode-plugin-cc:oc-model`.

## Constraints

- KHÔNG chạy exec ở đây — chỉ chọn + lưu model.
- Chỉ cho chọn model **thực sự free** (có trong output `--list`). KHÔNG cho chọn model trả phí.
- Lựa chọn lưu per-project tại `<cwd>/.opencode-plugin/config.json` (key `model`).
