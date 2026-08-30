# P1.5 — Auth backend

Trạng thái: hoàn thành ở local Worker; cần đo CPU lại trên preview Cloudflare trước M1.

## Quyết định

- `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout`.
- PBKDF2-HMAC-SHA256 qua Web Crypto, salt 16 byte, 50.000 vòng, hash 32 byte.
- HMAC-SHA256 pepper tối thiểu 32 ký tự là Cloudflare Secret bắt buộc và không nằm trong D1/Git.
- Token phiên ngẫu nhiên 256 bit; D1 chỉ lưu SHA-256 của token.
- Cookie `__Host-our_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- Idle timeout 7 ngày; hết hạn tuyệt đối 30 ngày; hoạt động gia hạn idle tối đa mỗi 15 phút.
- Mỗi login tạo token mới. Logout revoke token hiện tại và xóa cookie.
- Lỗi username/mật khẩu dùng cùng status/body. Rate limit theo hash username và IP, bắt đầu exponential backoff từ lần sai thứ năm, tối đa 15 phút.

Seed P1.4 vẫn cố ý không chứa mật khẩu dùng được. Mật khẩu thật chỉ được tạo bằng quy trình CLI P1.8, không commit vào Git.

Mức 50.000 vòng được chọn sau benchmark local để phù hợp giới hạn CPU của Workers Free; thấp hơn baseline PBKDF2 không pepper của OWASP nên pepper là bắt buộc. P1.15 phải cấu hình `AUTH_PEPPER` và xác nhận CPU trên preview trước production.

## Kiểm tra

```bash
npm run auth:check
```

Bài kiểm tra dùng D1 local riêng trong `.wrangler`, nạp hash test, chạy Worker headless và xác nhận lỗi chung, cookie, session lookup, rotation, logout và rate limit.

## Căn cứ

- [Cloudflare Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
