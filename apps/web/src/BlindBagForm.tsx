import { useState, type FormEvent } from "react";
import { queueSessionCommand } from "./offlineQueue";

export function BlindBagForm() {
  const [distance, setDistance] = useState("under_3");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const customDistanceKm = distance === "custom" ? Number(form.get("customDistanceKm")) : undefined;
    setPending(true);
    setMessage("");
    setError("");
    try {
      await queueSessionCommand("/api/sessions", {
        feature: "blind_bag",
        conditions: {
          time: form.get("time"),
          distance,
          ...(customDistanceKm === undefined ? {} : { customDistanceKm }),
          transport: form.get("transport"),
          budget: form.get("budget"),
          setting: form.get("setting"),
          experience: form.get("experience"),
          surprise: form.get("surprise"),
        },
      });
      setMessage("Đã ghi nhận và đang đồng bộ điều kiện để người kia xác nhận.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể lưu điều kiện.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="blind-bag-form" aria-labelledby="page-title">
      <p className="eyebrow">Xé Túi Mù</p>
      <h1 id="page-title">Hôm nay hai đứa muốn đi thế nào?</h1>
      <p>Chọn giới hạn thoải mái trước, địa điểm vẫn được giữ bí mật đến lúc mở túi.</p>

      <form onSubmit={submit} aria-busy={pending}>
        <label>Thời gian
          <select name="time" defaultValue="two_three_hours">
            <option value="one_hour">Khoảng 1 giờ</option>
            <option value="two_three_hours">2–3 giờ</option>
            <option value="half_day">Nửa ngày</option>
            <option value="any">Không quan trọng</option>
          </select>
        </label>

        <label>Khoảng cách
          <select name="distance" value={distance} onChange={(event) => setDistance(event.target.value)}>
            <option value="under_3">Dưới 3 km</option>
            <option value="three_to_five">3–5 km</option>
            <option value="five_to_ten">5–10 km</option>
            <option value="custom">Tùy chỉnh</option>
          </select>
        </label>
        {distance === "custom" && <label>Khoảng cách tối đa (km)
          <input name="customDistanceKm" type="number" inputMode="decimal" min="1" max="100" step="0.5" required />
        </label>}

        <label>Phương tiện
          <select name="transport" defaultValue="motorbike">
            <option value="walk">Đi bộ</option>
            <option value="motorbike">Xe máy</option>
            <option value="car">Ô tô</option>
            <option value="any">Không quan trọng</option>
          </select>
        </label>

        <label>Ngân sách cho hai người
          <select name="budget" defaultValue="any">
            <option value="free_low">Miễn phí hoặc rất thấp</option>
            <option value="under_200k">Dưới 200.000 đồng</option>
            <option value="two_to_five_hundred_k">200.000–500.000 đồng</option>
            <option value="any">Không quan trọng</option>
          </select>
        </label>

        <label>Không gian
          <select name="setting" defaultValue="any">
            <option value="indoor">Trong nhà</option>
            <option value="outdoor">Ngoài trời</option>
            <option value="any">Không quan trọng</option>
          </select>
        </label>

        <label>Loại trải nghiệm
          <select name="experience" defaultValue="any">
            <option value="food">Ăn uống</option>
            <option value="relax">Thư giãn</option>
            <option value="art">Nghệ thuật</option>
            <option value="books">Sách và tri thức</option>
            <option value="play">Vui chơi</option>
            <option value="explore">Khám phá</option>
            <option value="any">Bất kỳ</option>
          </select>
        </label>

        <label>Mức bất ngờ
          <select name="surprise" defaultValue="gentle">
            <option value="gentle">Êm dịu</option>
            <option value="adventure">Một chút phiêu lưu</option>
            <option value="bold">Hôm nay chơi lớn</option>
          </select>
        </label>

        <p className="blind-bag-form__safety">Mức bất ngờ không bao giờ làm giảm tiêu chuẩn an toàn.</p>
        <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error || message}</div>
        <button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Gửi người kia xác nhận"}</button>
      </form>
    </section>
  );
}
