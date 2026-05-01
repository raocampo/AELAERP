# AELA ERP — SVGs Oficiales

> Copia el bloque SVG que necesites y pégalo directamente en tu HTML, JSX, Vue o cualquier archivo de tu app.

---

## 1. Ícono Cuadrado — Uso general (app, dashboard, favicon)

```svg
<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="14" fill="#7C3AED"/>
  <rect x="14" y="18" width="36" height="25" rx="5" fill="none" stroke="white" stroke-width="2.5"/>
  <rect x="22" y="35" width="20" height="16" rx="4" fill="white" opacity="0.95"/>
  <circle cx="32" cy="29" r="4.5" fill="white"/>
</svg>
```

---

## 2. Ícono Circular — Redes sociales, avatares

```svg
<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <circle cx="32" cy="32" r="32" fill="#7C3AED"/>
  <rect x="14" y="18" width="36" height="25" rx="5" fill="none" stroke="white" stroke-width="2.5"/>
  <rect x="22" y="35" width="20" height="16" rx="4" fill="white" opacity="0.95"/>
  <circle cx="32" cy="29" r="4.5" fill="white"/>
</svg>
```

---

## 3. Ícono Gradiente — Hero, portadas, premium

```svg
<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="aela-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#7C3AED"/>
      <stop offset="100%" stop-color="#06B6D4"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#aela-grad)"/>
  <rect x="14" y="18" width="36" height="25" rx="5" fill="none" stroke="white" stroke-width="2.5"/>
  <rect x="22" y="35" width="20" height="16" rx="4" fill="white" opacity="0.95"/>
  <circle cx="32" cy="29" r="4.5" fill="white"/>
</svg>
```

---

## 4. Ícono Blanco — Sobre fondos oscuros, sidebars

```svg
<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="14" fill="white" fill-opacity="0.15"/>
  <rect x="14" y="18" width="36" height="25" rx="5" fill="none" stroke="white" stroke-width="2.5"/>
  <rect x="22" y="35" width="20" height="16" rx="4" fill="white" opacity="0.95"/>
  <circle cx="32" cy="29" r="4.5" fill="white"/>
</svg>
```

---

## 5. Logo Completo — Fondo claro (navbar, documentos)

```svg
<svg width="220" height="52" viewBox="0 0 220 52" xmlns="http://www.w3.org/2000/svg">
  <!-- Ícono -->
  <rect x="0" y="6" width="40" height="40" rx="10" fill="#7C3AED"/>
  <rect x="9" y="14" width="22" height="16" rx="3" fill="none" stroke="white" stroke-width="2"/>
  <rect x="14" y="27" width="12" height="13" rx="2.5" fill="white" opacity="0.95"/>
  <circle cx="20" cy="22" r="3" fill="white"/>
  <!-- Wordmark -->
  <text x="52" y="33" font-family="Arial" font-size="26" font-weight="800" fill="#1E1B4B" letter-spacing="3">AELA</text>
  <text x="52" y="46" font-family="Arial" font-size="11" fill="#7C3AED" letter-spacing="2.5">ERP ECUADOR</text>
</svg>
```

---

## 6. Logo Completo — Fondo oscuro (navbar dark, splash)

```svg
<svg width="220" height="52" viewBox="0 0 220 52" xmlns="http://www.w3.org/2000/svg">
  <!-- Ícono -->
  <rect x="0" y="6" width="40" height="40" rx="10" fill="#8B5CF6"/>
  <rect x="9" y="14" width="22" height="16" rx="3" fill="none" stroke="white" stroke-width="2"/>
  <rect x="14" y="27" width="12" height="13" rx="2.5" fill="white" opacity="0.95"/>
  <circle cx="20" cy="22" r="3" fill="white"/>
  <!-- Wordmark -->
  <text x="52" y="33" font-family="Arial" font-size="26" font-weight="800" fill="#EDE9FE" letter-spacing="3">AELA</text>
  <text x="52" y="46" font-family="Arial" font-size="11" fill="#A78BFA" letter-spacing="2.5">ERP ECUADOR</text>
</svg>
```

---

## 7. Logo Solo Wordmark — Firmas, emails, documentos

```svg
<svg width="200" height="48" viewBox="0 0 200 48" xmlns="http://www.w3.org/2000/svg">
  <text x="0" y="38" font-family="Arial" font-size="40" font-weight="800" fill="#7C3AED" letter-spacing="6">AELA</text>
  <line x1="168" y1="8" x2="168" y2="40" stroke="#DDD6FE" stroke-width="1.5"/>
  <text x="178" y="34" font-family="Arial" font-size="22" font-weight="300" fill="#1E1B4B">ERP</text>
</svg>
```

---

## 8. Logo Gradiente Horizontal — Banners, hero sections

```svg
<svg width="220" height="52" viewBox="0 0 220 52" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="aela-logo-grad" x1="0" y1="0" x2="220" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#7C3AED"/>
      <stop offset="100%" stop-color="#06B6D4"/>
    </linearGradient>
  </defs>
  <!-- Ícono -->
  <rect x="0" y="6" width="40" height="40" rx="10" fill="url(#aela-logo-grad)"/>
  <rect x="9" y="14" width="22" height="16" rx="3" fill="none" stroke="white" stroke-width="2"/>
  <rect x="14" y="27" width="12" height="13" rx="2.5" fill="white" opacity="0.95"/>
  <circle cx="20" cy="22" r="3" fill="white"/>
  <!-- Wordmark -->
  <text x="52" y="33" font-family="Arial" font-size="26" font-weight="800" fill="url(#aela-logo-grad)" letter-spacing="3">AELA</text>
  <text x="52" y="46" font-family="Arial" font-size="11" fill="#06B6D4" letter-spacing="2.5">ERP ECUADOR</text>
</svg>
```

---

## Uso en React / JSX

```jsx
// Importa como componente inline:
const AelaIcon = ({ size = 64 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <rect width="64" height="64" rx="14" fill="#7C3AED"/>
    <rect x="14" y="18" width="36" height="25" rx="5" fill="none" stroke="white" strokeWidth="2.5"/>
    <rect x="22" y="35" width="20" height="16" rx="4" fill="white" opacity="0.95"/>
    <circle cx="32" cy="29" r="4.5" fill="white"/>
  </svg>
);

const AelaLogoFull = ({ width = 220 }) => (
  <svg width={width} height={52} viewBox="0 0 220 52" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="6" width="40" height="40" rx="10" fill="#7C3AED"/>
    <rect x="9" y="14" width="22" height="16" rx="3" fill="none" stroke="white" strokeWidth="2"/>
    <rect x="14" y="27" width="12" height="13" rx="2.5" fill="white" opacity="0.95"/>
    <circle cx="20" cy="22" r="3" fill="white"/>
    <text x="52" y="33" fontFamily="Arial" fontSize="26" fontWeight="800" fill="#1E1B4B" letterSpacing="3">AELA</text>
    <text x="52" y="46" fontFamily="Arial" fontSize="11" fill="#7C3AED" letterSpacing="2.5">ERP ECUADOR</text>
  </svg>
);
```

---

## Colores de referencia

| Token             | Hex       | Uso                        |
|-------------------|-----------|----------------------------|
| `--aela-violet`   | `#7C3AED` | Color primario / ícono     |
| `--aela-violet-h` | `#6D28D9` | Hover                      |
| `--aela-violet-l` | `#A78BFA` | Texto sobre oscuro         |
| `--aela-cyan`     | `#06B6D4` | Acento / gradiente         |
| `--aela-dark`     | `#1E1B4B` | Wordmark fondo claro       |
| `--aela-light`    | `#EDE9FE` | Wordmark fondo oscuro      |

---

*AELA ERP — Brand Assets v1.0 · 2025 · Ecuador*
