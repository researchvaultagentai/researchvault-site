(() => {
  const gallery = document.querySelector('[data-pct-gallery]');
  if (!gallery) return;

  const preview = gallery.querySelector('[data-pct-robot]');
  if (preview) {
    const loadRobot = (src, fallback) => {
      const image = new Image(1672, 941);
      image.alt = preview.alt;
      image.fetchPriority = 'high';
      image.decoding = 'async';
      image.setAttribute('data-pct-robot', '');
      const recover = () => { if (fallback) loadRobot(fallback); };
      image.onerror = recover;
      image.onload = async () => {
        try {
          if (image.decode) await image.decode();
          if (image.naturalWidth) preview.replaceWith(image);
          else recover();
        } catch {
          recover();
        }
      };
      image.src = src;
    };
    loadRobot(preview.dataset.full, preview.dataset.fallback);
  }

  const slides = [...gallery.querySelectorAll('[data-pct-slide]')];
  if (slides.length < 2) return;

  const controls = gallery.querySelector('[data-pct-controls]');
  const caption = gallery.querySelector('[data-pct-caption]');
  const status = gallery.querySelector('[data-pct-status]');
  const count = gallery.querySelector('[data-pct-count]');
  const media = gallery.querySelector('[data-pct-media]');
  const rotate = gallery.querySelector('[data-pct-rotate]');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;
  let touchStart;
  let timer;
  let playing = !reducedMotion.matches;
  let hovered = gallery.matches(':hover') && matchMedia('(hover: hover)').matches;
  let onScreen = !('IntersectionObserver' in window);

  function step(direction) {
    slides[index].hidden = true;
    index = (index + direction + slides.length) % slides.length;
    const slide = slides[index];
    slide.classList.add('pct-slide-enter');
    slide.hidden = false;
    caption.textContent = slide.dataset.pctSlide;
    count.textContent = (index + 1) + ' / ' + slides.length;
  }

  function schedule() {
    clearTimeout(timer);
    const active = playing && !hovered && !touchStart && onScreen && !document.hidden;
    status.setAttribute('aria-live', active ? 'off' : 'polite');
    if (active) {
      timer = setTimeout(() => {
        step(1);
        schedule();
      }, 30_000);
    }
  }

  function setPlaying(next) {
    playing = next;
    const label = playing ? 'Pause slideshow' : 'Start slideshow';
    rotate.setAttribute('aria-label', label);
    rotate.title = label + ' and floating lights';
    document.body.toggleAttribute('data-pct-ambient-paused', !playing);
    rotate.toggleAttribute('data-pct-rotating', playing);
    schedule();
  }

  function manualStep(direction) {
    setPlaying(false);
    step(direction);
  }

  controls.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button === rotate) setPlaying(!playing);
    else if (button?.hasAttribute('data-pct-direction')) manualStep(Number(button.dataset.pctDirection));
  });
  controls.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    manualStep(event.key === 'ArrowRight' ? 1 : -1);
  });
  gallery.addEventListener('focusin', event => {
    if (event.target.matches(':focus-visible')) setPlaying(false);
  });
  gallery.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse') return;
    hovered = true;
    schedule();
  });
  gallery.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'mouse') return;
    hovered = false;
    schedule();
  });

  media.addEventListener('pointerdown', event => {
    if (event.isPrimary && event.pointerType === 'touch') {
      touchStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
      schedule();
    }
  });
  media.addEventListener('pointerup', event => {
    if (touchStart?.id !== event.pointerId) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    touchStart = undefined;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) manualStep(dx < 0 ? 1 : -1);
    else schedule();
  });
  media.addEventListener('pointercancel', () => {
    touchStart = undefined;
    schedule();
  });

  if (!onScreen) {
    new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting && entry.intersectionRatio >= .15;
      schedule();
    }, { threshold: .15 }).observe(gallery);
  }
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener?.('change', () => {
    if (reducedMotion.matches) setPlaying(false);
  });

  controls.hidden = false;
  setPlaying(playing);
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

(() => {
  const layers = [...document.querySelectorAll('[data-pct-stars]')];
  if (!layers.length) return;
  const motion = matchMedia('(prefers-reduced-motion: no-preference)');
  let frame = 0;

  function paintDepth() {
    frame = 0;
    const scroll = motion.matches ? Math.max(0, window.scrollY) : 0;
    // The texture repeats every 360px, so wrapping the transform is seamless.
    const far = -(scroll * .14 % 360) + 'px';
    const near = -(scroll * .33 % 360) + 'px';
    for (const layer of layers) {
      layer.style.setProperty('--pct-stars-far', far);
      layer.style.setProperty('--pct-stars-near', near);
    }
  }

  function queueDepth() {
    if (motion.matches && !frame) frame = requestAnimationFrame(paintDepth);
  }
  window.addEventListener('scroll', queueDepth, { passive: true });
  window.addEventListener('pageshow', queueDepth);
  motion.addEventListener?.('change', paintDepth);
  queueDepth();
})();
