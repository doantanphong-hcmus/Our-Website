# P0.8 — Cloudflare preview deployment

## Mục tiêu

Có một URL Cloudflare hoạt động ngoài máy cá nhân, được deploy từ repository GitHub và có endpoint `/health` kiểm chứng được.

## Thiết kế tối thiểu

- Worker: `our-website-preview`
- Trang kiểm tra: `/`
- Health endpoint: `/health`
- Kiểm tra tự động: `npm run preview:check` (đặt `PREVIEW_URL` khi kiểm tra URL thật)

Worker preview được tách khỏi spike realtime P0.7 vì Cloudflare không tạo Preview URL cho Worker sử dụng Durable Objects.

## Cấu hình Cloudflare Builds

- Repository: `doantanphong-hcmus/Our-Website`
- Production branch: `main`
- Build command: để trống
- Deploy command: `npx wrangler deploy --config apps/preview/wrangler.jsonc`
- Non-production deploy command: `npx wrangler versions upload --config apps/preview/wrangler.jsonc`
- Root directory: `/`

## Trạng thái

Chưa đóng — cần kết nối GitHub trong Cloudflare Dashboard, deploy và ghi nhận URL thật.
