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

## P3.6 — Private voting

- `GET /api/sessions/:id/food-votes` chỉ trả các lựa chọn `want`, `no`, `skip` của tài khoản hiện tại; không trả vote, số lượng hay tiến độ của partner.
- `POST /api/sessions/:id/food-votes` chỉ nhận món thuộc pool cố định, yêu cầu idempotency key và không cho sửa lựa chọn đã lưu.
- Vote được lưu riêng theo `(session_id, user_id, dish_id)`; response không chứa session nên không phát realtime event làm lộ hoạt động riêng tư.

## P3.7 — Match engine

- Sau mỗi vote `want`, server tìm các món cả hai cùng muốn và chọn món đứng trước trong pool gốc; các match còn lại được lưu làm alternatives nhưng không trả về client.
- Match đầu tiên được ghi bằng compare-and-set trên `result_json`; Durable Object tuần tự hóa các vote gần đồng thời nên chỉ có một kết quả chung.
- `GET /api/sessions/:id/food-match` trả cùng một món cho cả hai. Khi đã match, API dừng nhận vote mới nhưng vẫn cho retry idempotent.

## P3.8 — No-match / Chốt hộ

- Chỉ khi cả hai đã vote toàn bộ pool và không có match, server lấy union `want`, loại mọi món có ít nhất một vote `no`, rồi chọn ngẫu nhiên một món còn lại.
- Proxy luôn là phần tử của pool đã qua lọc tuyệt đối, nên không thể nới điều kiện dị ứng hoặc đưa món bị loại trở lại.
- `GET/POST /api/sessions/:id/food-proxy` chỉ công khai món proxy, trạng thái xác nhận của chính user và `ready`; không trả số vote hay người đã xác nhận.
- Nếu không còn ứng viên, API trả `exhausted: true`; UI đề nghị chọn thêm nhóm hoặc tạo danh sách mới và giữ nguyên điều kiện dị ứng.

## P3.10 — Result / history

- `POST /api/sessions/:id/food-result` nhận `accept` hoặc `retry`, chỉ hoàn tất phiên khi đã có match hoặc proxy được cả hai xác nhận.
- `foodFinal` trong `result_json` lưu món, trường phái, mode `dish`, nguồn match/proxy và có chốt hay không; ngày lấy từ `completed_at` nên không cần bảng history riêng.
- Pool mới chỉ giảm ưu tiên món đã `accept` cùng trường phái trong 30 ngày; món chỉ xem qua hoặc bấm chọn lại không bị tính là đã chốt.

## P4.2 — Deep Talk consent

- Creator tạo `deep_talk` với mức độ, thời lượng và đủ tám chủ đề ở một trong ba trạng thái `unset`, `allow`, `deny`.
- `GET/POST /api/sessions/:id/deep-talk-consent` phục vụ review và final confirmation; `/join` chung không thể kích hoạt Deep Talk.
- Partner giữ nguyên cấu hình thì phiên chuyển thẳng sang `active`. Nếu đổi bất kỳ chủ đề nào, session tạo revision 2 và chờ cả hai xác nhận đúng bản cuối.
- Mỗi lệnh review/confirm có idempotency key và expected version; thao tác cũ hoặc đồng thời không thể ghi đè revision mới.
- Chỉ chủ đề ở trạng thái `allow` sau consent mới được phép đưa vào prompt ở P4.3; `deny` và `unset` đều bị loại.
