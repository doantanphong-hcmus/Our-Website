# P1.6 — Auth frontend

Trạng thái: hoàn thành.

## Luồng

- App kiểm tra `/api/auth/session` trước khi dựng nội dung riêng tư.
- Đang kiểm tra có màn hình nhận diện sản phẩm; lỗi mạng có giải thích và nút thử lại, không có màn hình trắng.
- Chỉ response 401 mới mở form đăng nhập; lỗi kỹ thuật không bị hiểu nhầm thành chưa đăng nhập.
- Login thành công chuyển thẳng vào app shell và giữ nguyên route đang mở.

## Form

- Native form với `autocomplete`, `enterKeyHint`, giới hạn độ dài và nút hiện/ẩn mật khẩu.
- Pending phản hồi ngay trên nút, form có `aria-busy` và nội dung hiện tại vẫn còn nguyên.
- Lỗi dùng vùng live, không xóa username/password và cho phép gửi lại.
- Mobile-first 360–430px; khi viewport thấp do bàn phím, minh họa ẩn và nút submit vẫn cuộn vào vùng nhìn thấy.
- Minh họa CSS chỉ thể hiện hai silhouette theo direction P1.2; artwork nhân vật cuối vẫn thuộc P6.5.

## Kiểm tra

```bash
npm run web:build
npm run web:preview
npm run web:auth-check
```

Browser check xác nhận checking/login/pending/error/success, show password, giữ dữ liệu, viewport 360×520 và lỗi kết nối.
