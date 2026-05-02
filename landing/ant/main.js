// ============================================================
//  AELA ERP Landing — main.js
//  Scroll spy, nav sticky, hamburger, fade-in, scroll-top
// ============================================================

(function () {
  'use strict';

  const nav       = document.getElementById('nav');
  const hamburger = document.getElementById('hamburger');
  const navMobile = document.getElementById('nav-mobile');

  // ── Sticky nav ──────────────────────────────────────────
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
    toggleScrollTop();
  }, { passive: true });

  // ── Hamburger ───────────────────────────────────────────
  hamburger.addEventListener('click', () => {
    const open = navMobile.classList.toggle('open');
    hamburger.textContent = open ? '✕' : '☰';
    hamburger.setAttribute('aria-expanded', String(open));
  });

  // Cerrar mobile nav al hacer click en un link
  navMobile.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => {
      navMobile.classList.remove('open');
      hamburger.textContent = '☰';
    });
  });

  // ── Scroll to top ────────────────────────────────────────
  const scrollTopBtn = document.createElement('button');
  scrollTopBtn.id = 'scroll-top';
  scrollTopBtn.title = 'Volver arriba';
  scrollTopBtn.innerHTML = '↑';
  document.body.appendChild(scrollTopBtn);

  function toggleScrollTop() {
    if (window.scrollY > 400) {
      scrollTopBtn.classList.add('visible');
    } else {
      scrollTopBtn.classList.remove('visible');
    }
  }
  scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ── Fade-in en scroll ────────────────────────────────────
  const fadeEls = document.querySelectorAll(
    '.feature-card, .module-item, .plan-card, .tech-item, .contact-form, .contact-info'
  );

  fadeEls.forEach((el) => el.classList.add('fade-in'));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  fadeEls.forEach((el) => observer.observe(el));

  // ── Active nav link ──────────────────────────────────────
  const sections = document.querySelectorAll('section[id]');
  const navAnchors = document.querySelectorAll('.nav-links a[href^="#"]');

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          navAnchors.forEach((a) => {
            a.style.color = a.getAttribute('href') === `#${id}` ? '#f1f5f9' : '';
          });
        }
      });
    },
    { threshold: 0.35 }
  );

  sections.forEach((s) => sectionObserver.observe(s));

  // ── Contacto form ────────────────────────────────────────
  // Si no hay backend, abre cliente de correo; en producción
  // se puede reemplazar con fetch a un endpoint o FormSubmit/EmailJS
  const form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      // El action="mailto:..." maneja el envío nativo.
      // Aquí solo mostramos feedback visual.
      const btn = form.querySelector('button[type="submit"]');
      const original = btn.textContent;
      btn.textContent = '✅ Solicitud enviada — te contactaremos pronto';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 5000);
    });
  }

  // ── Año dinámico en footer ───────────────────────────────
  const yearEls = document.querySelectorAll('.footer-bottom p');
  yearEls.forEach((el) => {
    el.innerHTML = el.innerHTML.replace('2024', new Date().getFullYear());
  });

})();
