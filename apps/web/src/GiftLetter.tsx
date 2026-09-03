import { useEffect, useRef, useState } from "react";

const letter = `Gửi em bé,
Hôm nay là sinh nhật em, anh muốn gửi đến em sự trân trọng chân thành nhất từ đáy lòng.

Trước khi có em, anh sống một cuộc đời vật vờ. Mọi thứ cứ diễn ra theo quán tính, lặng lẽ và vô vị tới mức nhiều khi anh thấy mình lạc lõng trong nhịp sống của mình. Cuộc sống lúc ấy đối với anh chỉ đơn giản là đi qua từng ngày mà không có một chút mong đợi nào.

Rồi em xuất hiện, mang theo nét hồn nhiên và sự ấm áp. Điều đó đã lấp đầy những khoảng trống trong anh, cho anh biết rung động trước những điều bình dị và tìm lại được niềm vui.

Bước sang tuổi mới, anh mong em luôn giữ được nụ cười, tâm hồn rạng rỡ và nhẹ nhõm như bây giờ. Cảm ơn em vì đã là sự dịu dàng nhất từng bước vào cuộc đời anh.

Chúc mừng sinh nhật em.`;

export function GiftLetter() {
  const [open, setOpen] = useState(false);
  const [unsealed, setUnsealed] = useState(false);
  const [visible, setVisible] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const giftButton = useRef<HTMLButtonElement>(null);
  const envelopeButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const paper = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    envelopeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        event.preventDefault();
        (unsealed ? closeButton : envelopeButton).current?.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [open, unsealed]);

  useEffect(() => {
    if (!open || !unsealed) return setVisible(0);
    let interval = 0;
    const delay = window.setTimeout(() => {
      interval = window.setInterval(() => setVisible((count) => {
        if (count >= letter.length) {
          window.clearInterval(interval);
          return count;
        }
        return count + 1;
      }), 38);
    }, 2_500);
    return () => {
      window.clearTimeout(delay);
      window.clearInterval(interval);
    };
  }, [open, unsealed]);

  useEffect(() => {
    if (visible % 18 && visible < letter.length) return;
    if (paper.current) paper.current.scrollTop = paper.current.scrollHeight;
  }, [visible]);

  function show() {
    setOpen(true);
    setUnsealed(false);
  }

  function unseal() {
    setUnsealed(true);
    if (audio.current) {
      audio.current.currentTime = 0;
      audio.current.volume = 0.28;
      void audio.current.play().catch(() => {});
    }
  }

  function close() {
    setOpen(false);
    audio.current?.pause();
    window.requestAnimationFrame(() => giftButton.current?.focus());
  }

  return <>
    <button ref={giftButton} className="gift-button" type="button" aria-label="Mở món quà dành cho Nhi" onClick={show}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path className="gift-button__bow" d="M24 15C16 5 8 8 10 14c1.6 4.8 9 4.2 14 1Zm0 0c8-10 16-7 14-1-1.6 4.8-9 4.2-14 1Z" />
        <path className="gift-button__lid" d="M7 16h34v9H7z" />
        <path d="M10 25h28v18H10z" />
        <path className="gift-button__ribbon" d="M20 16h8v27h-8z" />
      </svg>
    </button>
    <audio ref={audio} src="/gift-letter.mp3" preload="none" />
    {open && <div className="gift-letter-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="gift-letter-dialog" role="dialog" aria-modal="true" aria-labelledby="gift-letter-title">
        <button ref={closeButton} className="gift-letter-close" type="button" aria-label="Đóng bức thư" onClick={close}>×</button>
        <h2 className="sr-only" id="gift-letter-title">Bức thư dành cho Nhi</h2>
        <div className={`gift-letter-stage${unsealed ? " is-unsealed" : ""}`}>
          {unsealed && <article ref={paper} className="gift-letter-paper" tabIndex={0} aria-label="Nội dung bức thư">
            <p aria-hidden="true">{letter.slice(0, visible)}{visible < letter.length && <i className="gift-letter-caret" />}</p>
            {visible >= letter.length && <div className="gift-letter-signature is-signing" role="img" aria-label="Chữ ký của Phong">
              <svg viewBox="0 0 240 160" aria-hidden="true">
                <path className="gift-letter-signature__stroke stroke-one" pathLength="1" d="M71 113C40 134 14 111 24 72 35 29 76 8 106 22c26 13 16 48-7 69-11 10-21 15-30 15" />
                <path className="gift-letter-signature__stroke stroke-two" pathLength="1" d="M94 61c-6 36-6 66 2 84" />
                <path className="gift-letter-signature__stroke stroke-three" pathLength="1" d="M91 92c20 0 48-27 76-34-24 21-49 40-73 54" />
                <path className="gift-letter-signature__stroke stroke-four" pathLength="1" d="M23 133c49-27 108-31 196-31" />
                <g className="gift-letter-signature__quill">
                  <path d="M0 0C-18-14-23-39-8-50 8-35 10-17 0 0Z" />
                  <path d="m-9-39 12 47" />
                  <path d="m3 8-5-8 3-1 5 6Z" />
                </g>
              </svg>
            </div>}
            <p className="sr-only">{letter}</p>
          </article>}
          <button ref={envelopeButton} className="airmail-envelope" type="button" aria-label="Mở phong bì dành cho Nhi" onClick={unseal} disabled={unsealed}>
            <span className="airmail-envelope__flap" aria-hidden="true" />
            <span className="airmail-envelope__face" aria-hidden="true" />
            <span className="airmail-envelope__from" aria-hidden="true"><b>From:</b> Phong</span>
            <span className="airmail-envelope__to" aria-hidden="true"><b>To:</b> Nhi</span>
            <span className="airmail-envelope__stamp" aria-hidden="true">
              <svg viewBox="0 0 64 64">
                <rect x="3" y="3" width="58" height="58" rx="3" />
                <path d="M20 18c5-8 20-8 25 0 5 9 2 26-4 30-5 4-14 4-19 0-7-5-8-21-2-30Z" />
                <path d="M23 18l-4-5m23 5 4-5M25 33c4 4 10 4 14 0" />
                <circle cx="26" cy="27" r="1.5" /><circle cx="38" cy="27" r="1.5" />
              </svg>
            </span>
          </button>
        </div>
      </section>
    </div>}
  </>;
}
