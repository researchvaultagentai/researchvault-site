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

(() => {
  const roadmap = document.querySelector('[data-pct-roadmap]');
  const reticle = document.querySelector('[data-pct-reticle]');
  if (!roadmap || !reticle) return;

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      roadmap.classList.add('pct-roadmap-in-view');
      observer.disconnect();
    }, { threshold: .24 });
    observer.observe(roadmap);
  }

  const pointer = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  let point;
  let lit;
  let frame = 0;
  let scrollTimer;

  function reset() {
    point = undefined;
    lit?.removeAttribute('data-pct-lit');
    lit = undefined;
    reticle.removeAttribute('data-pct-visible');
    reticle.removeAttribute('data-pct-scroll');
    clearTimeout(scrollTimer);
  }

  function draw() {
    frame = 0;
    if (!point || !pointer.matches) return;
    const { x, y } = point;
    const target = document.elementFromPoint(x, y);
    const surface = target?.closest('[data-pct-illuminate]');
    const bounds = surface?.getBoundingClientRect();
    const show = target?.closest('main') && !target.closest('a, button, input, select, textarea, [contenteditable]');
    if (lit !== surface) {
      lit?.removeAttribute('data-pct-lit');
      lit = surface;
    }
    if (surface && bounds) {
      surface.style.setProperty('--pct-light-x', (x - bounds.left) + 'px');
      surface.style.setProperty('--pct-light-y', (y - bounds.top) + 'px');
      surface.setAttribute('data-pct-lit', '');
    }
    reticle.toggleAttribute('data-pct-visible', Boolean(show));
    if (!show) return;

    reticle.style.setProperty('--pct-x', x + 'px');
    reticle.style.setProperty('--pct-y', y + 'px');
    reticle.toggleAttribute('data-pct-on-dark', Boolean(surface || target.closest('.pct-private, .pct-service-featured')));
  }

  function queue() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  document.addEventListener('pointermove', event => {
    if (!pointer.matches || event.pointerType !== 'mouse') return;
    point = { x: event.clientX, y: event.clientY };
    queue();
  }, { passive: true });

  window.addEventListener('scroll', () => {
    if (!point || !pointer.matches) return;
    reticle.setAttribute('data-pct-scroll', '');
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => reticle.removeAttribute('data-pct-scroll'), 230);
    queue();
  }, { passive: true });

  document.addEventListener('pointerout', event => {
    if (!event.relatedTarget) reset();
  }, { passive: true });
  window.addEventListener('blur', reset);
  pointer.addEventListener?.('change', reset);
})();
