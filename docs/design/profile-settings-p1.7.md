# P1.7 — Profile/settings

Trạng thái: hoàn thành.

## Đã triển khai

- Profile hiển thị username/vai trò và cập nhật nickname, màu, avatar preset.
- Theme `system/light/dark` và reduced motion lưu theo từng user trong D1; menu avatar có toggle nhanh.
- Đổi mật khẩu bắt buộc mật khẩu hiện tại, tối thiểu 12 byte, rotate token và revoke toàn bộ phiên cũ.
- Logout revoke phiên hiện tại, xóa cookie và đưa UI về login.
- Mọi mutation lấy user từ cookie; không nhận `user_id` hoặc `couple_space_id` từ client.

Avatar trong P1.7 là preset CSS riêng tư lưu bằng `avatar_key`. Upload ảnh thật không được dựng sớm vì R2 private, kiểm MIME/kích thước và retry thuộc P2.16; artwork nhân vật cuối thuộc P6.5.

## Kiểm tra

```bash
npm run auth:check
npm run web:build
npm run web:preview
npm run web:settings-check
```

Integration check phủ D1/profile/password/session revocation; browser check phủ profile form, menu preferences, password mismatch/success, logout và responsive 360px.
