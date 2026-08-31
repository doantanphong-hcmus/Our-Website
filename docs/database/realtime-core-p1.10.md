# P1.10 — Realtime production core

Trạng thái: hoàn thành.

- `/ws` yêu cầu session cookie hợp lệ; client không được tự chọn room. Worker ánh xạ duy nhất theo `couple_space_id`.
- Mutation session đi qua một Durable Object của couple space, được tuần tự hóa rồi mới gọi P1.9/D1.
- Sau khi D1 ghi thành công, DO phát `session.updated` cho mọi socket đang nối trong dưới 2 giây.
- Khi kết nối hoặc reconnect, server gửi `session.snapshot` từ D1 cùng `eventVersion`; `lastEvent` cho biết client đã lệch phiên bản hay chưa.
- Hibernation WebSocket dùng auto-response `ping` → `pong`, không đánh thức DO chỉ để heartbeat.
- Trước khi fan-out, DO loại socket có auth session đã logout, bị revoke hoặc hết hạn.
- D1 tiếp tục là nguồn dữ liệu bền; DO không giữ bản sao business state.

Offline command queue/retry phía trình duyệt không thuộc task này và được giữ cho P1.11.

```bash
npm run realtime:check
```
