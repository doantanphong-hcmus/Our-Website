import { useEffect, useRef, useState } from "react";

const letter = `Nhi à,

[Những điều anh muốn nhắn với em sẽ được đặt ở đây.]

Thương em,
Phong`;

export function GiftLetter({ reducedMotion }: { reducedMotion: boolean }) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const giftButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        event.preventDefault();
        closeButton.current?.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [open]);

  useEffect(() => {
    if (!open) return setVisible(0);
    if (reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setVisible(letter.length);
    let interval = 0;
    const delay = window.setTimeout(() => {
      interval = window.setInterval(() => setVisible((count) => {
        if (count >= letter.length) {
          window.clearInterval(interval);
          return count;
        }
        return count + 1;
      }), 36);
    }, 1_150);
    return () => {
      window.clearTimeout(delay);
      window.clearInterval(interval);
    };
  }, [open, reducedMotion]);

  function show() {
    setOpen(true);
    if (audio.current) {
      audio.current.currentTime = 0;
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
    <audio ref={audio} src="/gift-letter.mp3" preload="none" loop />
    {open && <div className="gift-letter-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="gift-letter-dialog" role="dialog" aria-modal="true" aria-labelledby="gift-letter-title">
        <button ref={closeButton} className="gift-letter-close" type="button" aria-label="Đóng bức thư" onClick={close}>×</button>
        <h2 className="sr-only" id="gift-letter-title">Bức thư dành cho Nhi</h2>
        <div className="gift-letter-stage">
          <div className="airmail-envelope" aria-hidden="true"><span /></div>
          <article className="gift-letter-paper">
            <span className="gift-letter-paper__to">Gửi Nhi</span>
            <p aria-hidden="true">{letter.slice(0, visible)}<i className="gift-letter-caret" /></p>
            <p className="sr-only">{letter}</p>
          </article>
        </div>
      </section>
    </div>}
  </>;
}
