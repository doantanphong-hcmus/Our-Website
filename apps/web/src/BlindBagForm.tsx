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
          distance,
          ...(customDistanceKm === undefined ? {} : { customDistanceKm }),
          budget: form.get("budget"),
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
      <h1 id="page-title">Hai đứa muốn đi xa và chi bao nhiêu?</h1>
      <p>Còn lại cứ để túi mù lo.</p>

      <form onSubmit={submit} aria-busy={pending}>
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

        <label>Ngân sách cho hai người
          <select name="budget" defaultValue="any">
            <option value="free_low">Miễn phí hoặc rất thấp</option>
            <option value="under_200k">Dưới 200.000 đồng</option>
            <option value="two_to_five_hundred_k">200.000–500.000 đồng</option>
            <option value="any">Không quan trọng</option>
          </select>
        </label>

        <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error || message}</div>
        <button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Gửi người kia xác nhận"}</button>
      </form>
    </section>
  );
}
