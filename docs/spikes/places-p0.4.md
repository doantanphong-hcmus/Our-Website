# P0.4: Places data spike

- Date: 2026-08-27
- Status: Complete for free-provider coverage
- Sample origin: central Ho Chi Minh City (`10.7769, 106.7009`)
- Radius: 5 km
- Sample size: 30 unique places

## Question

Can a no-cost place provider supply useful fields for Blind Bag and Food:
type, address, distance, opening hours, rating, review count, and photo?

## Method

Run the dependency-free script against the public Photon demo, which searches
OpenStreetMap data and returns real places near the sample origin:

```sh
node scripts/spike-places.mjs --self-test
node scripts/spike-places.mjs
```

The script searches ten relevant categories, removes duplicate OSM IDs, sorts
by calculated distance, and inspects the nearest 30 results. The origin is only
a representative assumption and must be replaced with the real usage area when
the owner confirms it.

## Field coverage

| Field | Available | Coverage | Result |
|---|---:|---:|---|
| Name | 30 | 100% | Pass |
| Type | 30 | 100% | Pass, but aliases need normalization |
| Address | 30 | 100% | Pass |
| Distance | 30 | 100% | Pass; calculated from coordinates |
| Opening hours | 0 | 0% | Fail |
| Rating | 0 | 0% | Fail |
| Review count | 0 | 0% | Fail |
| Photo | 0 | 0% | Fail |
| Price | 0 | 0% | Removed from product scope after the spike |

## Sample evidence

| # | OSM ID | Name | Type | Distance (km) |
|---:|---|---|---|---:|
| 1 | W/802105071 | Bảo tàng Thành phố Hồ Chí Minh | museum | 0.18 |
| 2 | N/7018017805 | CGV | cinema | 0.24 |
| 3 | N/4193547974 | Nhà Sách Đức Bà Hoà Binh | books | 0.25 |
| 4 | N/12221756501 | Mang's Mania Vegan Restaurant | restaurant | 0.28 |
| 5 | W/802105041 | Thư viện Khoa học Tổng hợp Thành phố Hồ Chí Minh | library | 0.29 |
| 6 | N/5660274325 | Nhà Hàng Ghém | restaurant | 0.33 |
| 7 | N/4131348295 | Tara & Kys Art Gallery | gallery | 0.44 |
| 8 | N/11056054205 | Café 30/4 | cafe | 0.54 |
| 9 | N/11515846165 | KIYO BAKERY & COFFE | bakery | 0.55 |
| 10 | W/1116582922 | Bảo tàng Tôn Đức Thắng | museum | 0.61 |
| 11 | N/4620367590 | Nhà Hàng Salima Halal | restaurant | 0.66 |
| 12 | N/9584932186 | Cửa Hàng Conservo Japanese Bakery Cafe | cafe | 0.70 |
| 13 | N/1969599014 | Trung Nguyên Coffee | cafe | 0.76 |
| 14 | W/802157425 | Bảo tàng Mỹ thuật Thành phố Hồ Chí Minh | museum | 0.83 |
| 15 | N/2935020335 | Cà Phê Eleven | cafe | 0.86 |
| 16 | W/112176431 | Galaxy Cinema | cinema | 0.96 |
| 17 | W/186249226 | Bảo tàng Chứng tích Chiến tranh | museum | 0.98 |
| 18 | W/808022726 | Bảo tàng Hồ Chí Minh | museum | 1.16 |
| 19 | N/1001114513 | Bảo Tàng Địa Chất | museum | 1.17 |
| 20 | R/17758150 | Bảo tàng Lịch sử Thành phố Hồ Chí Minh | museum | 1.31 |
| 21 | N/4882951122 | Ẩm Thực Chay Chân Nhu II | restaurant | 1.47 |
| 22 | W/1086980072 | Thư viện Trung học phổ thông Nguyễn Thị Minh Khai | library | 1.51 |
| 23 | N/9584833463 | Sàn Giao Dịch Novaland Gallery | events_venue | 1.51 |
| 24 | N/13437344201 | Min su Bakery | pastry | 1.54 |
| 25 | W/1181111293 | Novaland Gallery | exhibition_centre | 1.54 |
| 26 | W/1181111289 | Nhà sách Hải An | books | 1.58 |
| 27 | N/7206055885 | Quán ăn gia đình 79 | restaurant | 1.59 |
| 28 | N/13436984001 | Phương Anh Bakery | pastry | 1.78 |
| 29 | N/2230333450 | Rạp Phim Cầu Bông | cinema | 1.79 |
| 30 | N/9584833482 | Rạp Phim Beta Cinemas - Trần Quang Khải | cinema | 1.89 |

The sample also exposes type aliases (`pastry`, `events_venue`, and
`exhibition_centre`) that a production adapter would need to normalize or
reject.

## Provider conclusion

OpenStreetMap through the public Photon demo proves that useful basic data is
available without billing. It has no rating, review count, photo, price, or
opening-hours data in this sample, and a public demo endpoint has no production
availability guarantee. Missing optional fields must therefore remain `null`.

After the spike, the owner rejected providers that require billing and removed
price level from the product scope to preserve the surprise. P0.5 records the
no-billing production guardrails and provider candidate.

## Decision

1. Do not use the public Photon demo as the production Places provider.
2. Keep OSM/Photon as reproducible evidence and development data only.
3. Do not enable Google Places or another provider requiring billing.
4. Build the backend contract with nullable optional fields and repeat the live
   coverage check against the approved no-card provider before production.

## References

- Photon API: https://github.com/komoot/photon/blob/master/docs/api-v1.md
- Photon demo-server terms: https://github.com/komoot/photon
- Geoapify Places API: https://apidocs.geoapify.com/docs/places/
