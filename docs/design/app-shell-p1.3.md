# P1.3 — App shell

Trạng thái: hoàn thành.

## Phạm vi đã khóa

- React + TypeScript + Vite là nền frontend.
- Router nhẹ dựa trên History API, không thêm thư viện router cho 10 route tĩnh hiện tại.
- Bottom navigation gồm đúng 5 mục: Trang chủ, Đi đâu, Ăn gì, Deep Talk, Lịch.
- Đi đâu có ba lối vào: Xé Túi Mù, Bản đồ, Hộ chiếu.
- Menu avatar có thông tin tài khoản, đổi mật khẩu, chế độ sáng/tối, giảm chuyển động và vị trí đăng xuất.
- Giao diện mobile-first cho 360–430px, có safe area, touch target, focus state và route 404.

Đăng xuất được hiển thị nhưng tạm vô hiệu hóa; hành vi thật chỉ được nối sau khi auth frontend hoàn thành ở P1.6. Nội dung nghiệp vụ của từng trang không thuộc P1.3.

## Kiểm tra

```bash
npm run web:build
npm run web:preview
npm run web:check
```

Browser check xác nhận 5 mục điều hướng, chuyển route không reload, trạng thái trang hiện tại, chiều rộng 360px, dark mode, reduced motion và trang 404.
