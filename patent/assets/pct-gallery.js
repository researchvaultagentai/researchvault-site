(() => {
  const gallery = document.querySelector('[data-pct-gallery]');
  if (!gallery) return;

  const slides = [...gallery.querySelectorAll('[data-pct-slide]')];
  if (slides.length < 2) return;

  const controls = gallery.querySelector('[data-pct-controls]');
  const caption = gallery.querySelector('[data-pct-caption]');
  const count = gallery.querySelector('[data-pct-count]');
  const media = gallery.querySelector('[data-pct-media]');
  let index = 0;
  let touchStart;

  function step(direction) {
    slides[index].hidden = true;
    index = (index + direction + slides.length) % slides.length;
    const slide = slides[index];
    slide.classList.add('pct-slide-enter');
    slide.hidden = false;
    caption.textContent = slide.dataset.pctSlide;
    count.textContent = (index + 1) + ' / ' + slides.length;
  }

  controls.addEventListener('click', event => {
    const button = event.target.closest('[data-pct-direction]');
    if (button) step(Number(button.dataset.pctDirection));
  });
  controls.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    step(event.key === 'ArrowRight' ? 1 : -1);
  });

  media.addEventListener('pointerdown', event => {
    if (event.isPrimary && event.pointerType === 'touch') {
      touchStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
  });
  media.addEventListener('pointerup', event => {
    if (touchStart?.id !== event.pointerId) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    touchStart = undefined;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  });
  media.addEventListener('pointercancel', () => { touchStart = undefined; });

  controls.hidden = false;
})();
