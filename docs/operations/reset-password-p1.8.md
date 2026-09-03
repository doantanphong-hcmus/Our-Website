# Reset password CLI (P1.8)

Không có API hoặc giao diện admin public. Trước khi reset remote, owner phải xác nhận đúng tài khoản đích và người chạy phải đăng nhập Wrangler bằng tài khoản Cloudflare được owner cấp quyền.

## Quy trình

1. Owner yêu cầu reset cho đúng một username: `phong` hoặc `nhi`.
2. Mở PowerShell tại repository, đặt hai secret chỉ trong tiến trình hiện tại:

   ```powershell
   $secret = Read-Host "AUTH_PEPPER" -AsSecureString
   $env:AUTH_PEPPER = [Net.NetworkCredential]::new('', $secret).Password
   $secret = Read-Host "Mật khẩu mới" -AsSecureString
   $env:RESET_PASSWORD = [Net.NetworkCredential]::new('', $secret).Password
   npm.cmd run auth:reset -- --remote --config .wrangler-deploy.json --username phong --confirm "RESET phong"
   Remove-Item Env:AUTH_PEPPER, Env:RESET_PASSWORD
   Remove-Variable secret
   ```

3. Owner đăng nhập lại bằng mật khẩu mới. Mọi session cũ của tài khoản đã bị revoke; các session của người còn lại không đổi.

Dùng `--local` thay `--remote` để thao tác D1 local. Không truyền mật khẩu qua argument, không lưu vào file `.env`, Git, chat hoặc ticket. Production chỉ chạy sau khi P8.2 đã cấu hình D1 `database_id`; dùng cùng `AUTH_PEPPER` đang lưu dưới dạng Worker secret.

## Kiểm tra tự động

```bash
npm run auth:reset-check
```
