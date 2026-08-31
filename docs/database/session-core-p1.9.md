# P1.9 — Session core

Trạng thái: hoàn thành.

- `POST /api/sessions`: tạo phiên `pending`; cùng idempotency key trả lại phiên cũ, mỗi tính năng chỉ có một phiên mở.
- `GET /api/sessions` và `GET /api/sessions/:id`: đọc phiên trong couple space của tài khoản hiện tại.
- `POST /api/sessions/:id/{join|decline|cancel|complete}`: mutation bắt buộc `expectedVersion` và `idempotencyKey`.
- Người còn lại được join/decline; người tạo được hủy lời mời; khi active thì một trong hai được complete/cancel.
- Lời mời pending hết hạn sau 24 giờ; phiên active không tự hết hạn để có thể tiếp tục sau.
- Event lưu audit tối thiểu; D1 batch và optimistic version ngăn ghi đè khi hai lệnh đến cùng lúc.

P1.9 không phát WebSocket và không giữ command khi offline; đó là P1.10 và P1.11. Các trạng thái ready/paused thuộc vòng đời cụ thể của từng tính năng, không được dựng giả trong lõi này.

```bash
npm run sessions:check
```
