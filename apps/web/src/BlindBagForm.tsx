import { useState, type FormEvent } from "react";
import { queueSessionCommand } from "./offlineQueue";

type Position = { latitude: number; longitude: number; accuracyMeters: number };

export function BlindBagForm() {
  const [distance, setDistance] = useState("under_3");
  const [originMode, setOriginMode] = useState<"current" | "address">("current");
  const [position, setPosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const customDistanceKm = distance === "custom" ? Number(form.get("customDistanceKm")) : undefined;
    const address = String(form.get("originAddress") ?? "").trim();
    const origin = originMode === "current"
      ? position && { kind: "current", ...position }
      : address && { kind: "address", address };
    if (!origin) {
      setError(originMode === "current" ? "Hãy lấy vị trí hiện tại trước nhé." : "Hãy nhập địa chỉ xuất phát nhé.");
      return;
    }
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
          origin,
        },
      });
      setMessage("Đã ghi nhận và đang đồng bộ điều kiện để người kia xác nhận.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể lưu điều kiện.");
    } finally {
      setPending(false);
    }
  }

  function locate() {
    setLocating(true);
    setError("");
    setLocationMessage("");
    if (!navigator.geolocation) {
      setLocating(false);
      setOriginMode("address");
      setLocationMessage("Thiết bị này không hỗ trợ định vị. Mình nhập địa chỉ nhé.");
      return;
    }
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setPosition({ latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: Math.round(coords.accuracy) });
      setLocating(false);
      setLocationMessage("Đã lấy vị trí hiện tại.");
    }, () => {
      setLocating(false);
      setOriginMode("address");
      setLocationMessage("Không lấy được vị trí. Mình nhập địa chỉ nhé.");
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 });
  }

  return (
    <section className="blind-bag-form" aria-labelledby="page-title">
      <p className="eyebrow">Xé Túi Mù</p>
      <h1 id="page-title">Hai đứa muốn đi xa và chi bao nhiêu?</h1>
      <p>Còn lại cứ để túi mù lo.</p>

      <form onSubmit={submit} aria-busy={pending}>
        <fieldset className="blind-bag-origin">
          <legend>Điểm xuất phát</legend>
          <div className="blind-bag-origin__choices">
            <label><input type="radio" name="originMode" checked={originMode === "current"} onChange={() => { setOriginMode("current"); setError(""); setLocationMessage(""); }} />Vị trí hiện tại</label>
            <label><input type="radio" name="originMode" checked={originMode === "address"} onChange={() => { setOriginMode("address"); setError(""); setLocationMessage(""); }} />Nhập địa chỉ</label>
          </div>
          {originMode === "current" ? <button type="button" className="secondary-button" disabled={locating} onClick={locate}>{locating ? "Đang lấy vị trí…" : position ? "Lấy lại vị trí" : "Dùng vị trí hiện tại"}</button> : <label>Địa chỉ xuất phát
            <input name="originAddress" autoComplete="street-address" minLength={5} maxLength={200} required />
          </label>}
          <p className="blind-bag-origin__feedback" role="status" aria-live="polite">{locationMessage}</p>
        </fieldset>

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
