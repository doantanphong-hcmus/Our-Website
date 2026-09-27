# E2.2 — Spike vật lý máy gắp thú

## Kết luận

Spike khả thi với `matter-js@0.20.0` và timestep cố định 60 Hz. Lõi mô phỏng không phụ thuộc DOM nên dùng lại được ở trình duyệt và Worker, nhưng replay toàn bộ trên Worker chưa phù hợp với ngân sách CPU hiện tại.

Kiến trúc chốt cho prototype:

- Trình duyệt chạy vật lý đầy đủ: trọng lực, khối lượng, ma sát, va chạm, xoay, lực kẹp, trượt và máng nhận.
- Worker sở hữu lượt chơi, seed, số sao và phần thưởng; E2.4 sẽ kiểm tra trace đầu vào bị giới hạn và chỉ ghi nhận kết quả một lần.
- Kết quả thắng không dùng một lượt quay ngẫu nhiên. Gắp trúng phụ thuộc vị trí thả, hình dạng, khối lượng, độ bám và tải tác động lên càng.

## Bằng chứng

| Môi trường | Kết quả |
| --- | --- |
| Vitest / Node | 20 replay mất khoảng 180–200 ms; cùng seed + input tạo kết quả giống hệt |
| Workerd cục bộ | Replay deterministic; khoảng 55 ms cho một lượt |
| Worker dry-run | Bundle thành công, 246.39 KiB thô / 41.00 KiB gzip |
| Tình huống | Cùng layout có cả thắng và hụt theo điểm ngắm; hạ lực kẹp biến lượt thắng thành hụt |

## Giới hạn và bước kế tiếp

- E2.2 chưa có canvas/UI, vì vậy benchmark render thực tế trên Safari và Android thuộc gate của E2.5.
- `gripStrength`, khối lượng, độ bám, stiffness và damping là các nút hiệu chỉnh; mặc định hiện tại chỉ là baseline cho prototype.
- `ponytail:` Không replay Matter.js trong mỗi request Worker. E2.4 dùng verifier tối giản; chỉ chuyển sang replay authoritative đầy đủ nếu phạm vi người dùng hoặc rủi ro gian lận tăng.
