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

## P3.4 — Dish pool

- `GET /api/sessions/:id/food-pool` chỉ dùng cho phiên `food_vote` đã `active`.
- Server lọc theo `foodStyle`, category, dị ứng và loại trừ; lưu cố định tối đa 8 ID trong `result_json` để cả hai người nhận cùng một pool.
- Pool ưu tiên món chưa xuất hiện trong các phiên hoàn tất 30 ngày gần nhất; món cũ chỉ được bù vào khi lựa chọn mới không đủ.
- P3.5 xếp cùng tập ID theo thứ tự ổn định riêng cho từng user bằng HMAC domain `food-order:v1`; seed và thứ tự của partner không được trả về client.
