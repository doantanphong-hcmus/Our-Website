# P1.4 — D1 schema nền

Trạng thái: hoàn thành.

## Phạm vi

- `couple_spaces`: một không gian chung duy nhất.
- `users`: tối đa hai tài khoản, hai vai trò khác nhau, không lưu mật khẩu rõ.
- `user_preferences`: theme và reduced motion của từng tài khoản.
- `activity_sessions`: vòng đời chung cho Xé Túi Mù, Ăn Gì và Deep Talk; có version, idempotency key và JSON dành cho dữ liệu riêng của tính năng.
- Partial unique index bảo đảm mỗi tính năng chỉ có tối đa một phiên pending/active.

Seed tạo đúng `phong` và `nhi`. Giá trị `password_hash` là placeholder không thể đăng nhập; P1.5 phải thay bằng hash thật trước khi auth được bật.

## Chạy local

```bash
npm run db:migrate:local
npm run db:seed:local
npm run db:check
```

`db:check` dùng một D1 tạm, chạy migration và seed hai lần, rồi xác nhận giới hạn hai user và một phiên mở cho mỗi tính năng.
