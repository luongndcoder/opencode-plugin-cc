---
description: Detect & help install anomalyco/opencode on this machine when it is missing. Asks for consent before running any install command.
---

# /oc-install — Install OpenCode

Cài [anomalyco/opencode](https://github.com/anomalyco/opencode) (executor cho plugin) khi máy chưa có, hoặc nâng cấp khi version quá cũ (< 1.2).

> **QUAN TRỌNG — namespace lệnh.** Mọi lệnh gợi ý cho user PHẢI ở dạng `/opencode-plugin-cc:oc-*`. Bare `/oc-*` không phải slash command hợp lệ.
>
> **AN TOÀN.** KHÔNG bao giờ tự chạy lệnh cài khi chưa hỏi. Luôn hiện lệnh cụ thể + AskUserQuestion xin đồng ý trước. KHÔNG tự thêm `sudo`. KHÔNG `curl | bash` ngầm.

## Flow

1. **Check đã cài chưa** — Bash: `opencode --version`.
   - Thành công + version **≥ 1.2.0** → báo user "✅ opencode <version> đã cài, sẵn sàng `/opencode-plugin-cc:oc-exec`." → **STOP**.
   - Thành công nhưng **< 1.2.0** → báo version cũ, đề xuất `opencode upgrade` (nếu cài qua script/brew) → AskUserQuestion approve trước khi chạy → verify lại → STOP.
   - `command not found` / lỗi → tiếp step 2 (chưa cài).

2. **Lập install plan** — Bash:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/install-opencode.mjs"
   ```
   Trả JSON: `{ platform, recommended, available[], unavailable[], manual }`.

3. **Trình bày + xin consent**:
   - `recommended != null` → show `recommended.label` + `recommended.cmd` cho user.
   - `AskUserQuestion`:
     - Question: "opencode chưa cài. Cài bằng lệnh này? `<recommended.cmd>`"
     - Options (build động từ plan):
       - `Có, chạy lệnh recommended` (chạy `recommended.cmd`)
       - `Chọn cách khác` (nếu `available.length > 1` → liệt kê `available[].label`/`cmd` để user chọn)
       - `Xem hướng dẫn thủ công` (in `manual.docs` + `manual.desktop_and_binaries` + `manual.install_script`, KHÔNG chạy gì)
       - `Huỷ`
   - `recommended == null` (không có package manager khả dụng) → KHÔNG đề xuất chạy gì. Hiện `manual`:
     - "Không tìm thấy package manager phù hợp. Cài thủ công:"
     - install script: `manual.install_script`
     - desktop/binaries: `manual.desktop_and_binaries`
     - docs: `manual.docs`
     - → STOP (để user tự quyết).

4. **Chạy lệnh đã chọn** (chỉ sau khi user approve) — Bash:
   - Chạy đúng `cmd` user chọn. Dùng timeout rộng (cài qua mạng có thể lâu): `timeout` ≥ 300000ms.
   - KHÔNG thêm `sudo`. Nếu lệnh fail do permission (EACCES npm global, brew sudo...) → KHÔNG tự sudo, báo user lỗi + gợi ý fix (vd `npm config get prefix`, đổi prefix; hoặc dùng cách khác trong `available`).
   - Stream / show output cho user.

5. **Verify** — Bash: `opencode --version`.
   - Thành công ≥ 1.2.0 → "✅ Đã cài opencode <version>. Giờ chạy `/opencode-plugin-cc:oc-plan <task>` rồi `/opencode-plugin-cc:oc-exec`."
   - Vẫn fail → báo rõ, đề xuất:
     - thử method khác trong `available`,
     - hoặc cài thủ công (`manual`),
     - kiểm tra PATH (binary có thể cài vào `~/.opencode/bin` hoặc `~/.local/bin` chưa nằm trong PATH — bảo user mở terminal mới / source profile).

## Constraints

- KHÔNG cài khi chưa có approval rõ ràng từ AskUserQuestion.
- KHÔNG dùng `sudo` tự động. KHÔNG sửa shell profile của user tự động.
- KHÔNG chạy lệnh nào nếu `recommended == null` — chỉ hướng dẫn thủ công.
- Sau khi cài xong, gợi ý bước tiếp theo đúng form namespaced.
