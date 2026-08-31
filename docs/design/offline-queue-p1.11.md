# P1.11 — Offline command queue

Trạng thái: hoàn thành.

- Session mutation được lưu trong IndexedDB trước khi gửi; mỗi lệnh giữ nguyên idempotency key qua retry và reload.
- Queue chạy FIFO theo từng `user.id`; tài khoản khác trên cùng trình duyệt không thể gửi thao tác đang chờ.
- Lỗi mạng, HTTP 408/429/5xx dùng exponential backoff tối đa 60 giây; sự kiện `online` kích hoạt kiểm tra lại.
- HTTP 409 xóa lệnh xung đột, chặn các lệnh phía sau và hiện cảnh báo để người dùng kiểm tra trạng thái mới.
- Logout chủ động xóa queue của tài khoản hiện tại; queue chỉ nhận các route session P1.9, không lưu auth/profile/password.
- Tối đa 100 lệnh mỗi user và 4 KiB mỗi body.

P1.11 cung cấp `queueSessionCommand()` cho các màn hình tính năng từ P1.12 trở đi. Service worker/PWA cache không cần cho queue và chưa được thêm.

```bash
npm run web:build
npm run web:offline-check
```
