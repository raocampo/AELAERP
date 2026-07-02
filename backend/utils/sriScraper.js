// ============================================================
//  AELA — sriScraper.js
//
//  ESTRATEGIA ACTUAL (2026-06-30):
//    1. Fetch + JSF (sin navegador — preferido)
//       a. ROPC → validar credenciales / obtener Bearer token
//       b. Bearer en JSF (si ROPC OK)
//       c. Browser flow fetch (seguimiento manual de redirects Keycloak)
//       NOTA: ROPC invalid_grant ya NO detiene el flujo — Railway puede
//       tener IPs de AWS bloqueadas en /token pero no en el form web.
//    2. Puppeteer (fallback con Chromium de 3 niveles)
//       Nivel 1: PUPPETEER_EXECUTABLE_PATH / nixpacks (chromium del sistema)
//       Nivel 2: @sparticuz/chromium (binario serverless, descarga automática)
//       Nivel 3: puppeteer bundled Chromium (solo dev local)
//
//  Railway env vars recomendadas:
//    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true   (evita descarga innecesaria)
//    PUPPETEER_EXECUTABLE_PATH=chromium      (si nixpacks instaló Chromium)
// ============================================================

const puppeteer  = require('puppeteer');
const nodePath   = require('path');
const crypto     = require('crypto');
const { execSync } = require('child_process');

const SRI_BASE = 'https://srienlinea.sri.gob.ec';

// Marcador de versión — permite confirmar en los logs de Railway qué build
// del scraper está realmente corriendo (evita diagnósticos a ciegas si un
// deploy no tomó el último commit).
console.log('[SRI] sriScraper.js build 2026-07-01 — incluye hash MD5+SHA-512 (a581579)');

// ─── Hash de contraseña para el portal SRI ───────────────────
//
//  El form de Keycloak del SRI ejecuta onsubmit="return validarUsuario();"
//  que hashea la clave antes del POST (script.js del SRI):
//    document.getElementById('password').value =
//      CryptoJS.MD5(password) + shaObj.getHash('SHA-512', 'HEX');
//  → contraseña final = md5hex(32) + sha512hex(128) = 160 chars
//
function _hashPasswordSRI(password) {
  const md5    = crypto.createHash('md5').update(password, 'utf8').digest('hex');
  const sha512 = crypto.createHash('sha512').update(password, 'ascii').digest('hex');
  return md5 + sha512;
}

// ═══════════════════════════════════════════════════════════════
//  BLOQUE 1 — SCRAPER FETCH+JSF (sin Puppeteer)
//
//  Flujo confirmado 2026-06-20:
//    1. GET /comprobantes-electronicos-internet/.../comprobantesRecibidos.jsf
//       → 302 a Keycloak login (realm Internet)
//    2. GET Keycloak auth page → 200 con form HTML
//    3. POST credenciales → 302 de vuelta a la app → cookies con JSESSIONID
//    4. GET página JSF → extraer ViewState + nombres de campos dinámicos
//    5. POST JSF AJAX (faces-request: partial/ajax) → XML con tabla de resultados
//    6. Parsear XML → extraer claves de acceso
// ═══════════════════════════════════════════════════════════════

const SRI_JSF_URL =
  `${SRI_BASE}/comprobantes-electronicos-internet/pages/consultas/recibidos/comprobantesRecibidos.jsf`;

// Headers que imitan un navegador real (necesarios para que el portal no rechace)
const _HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'Accept-Language': 'es-EC,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection':      'keep-alive',
};

// ─── Cookie jar helpers ───────────────────────────────────────
function _parsearSetCookie(headers) {
  const jar = {};
  const _parsearUna = (h) => {
    h = (h || '').trim();
    const eq = h.indexOf('=');
    if (eq < 0) return;
    const sc   = h.indexOf(';');
    const name = h.substring(0, eq).trim();
    const val  = h.substring(eq + 1, sc > eq ? sc : undefined).trim();
    if (name) jar[name] = val;
  };

  // Nivel 1: Node 20+ — getSetCookie() devuelve array con cada cookie separada
  if (typeof headers.getSetCookie === 'function') {
    headers.getSetCookie().forEach(_parsearUna);
    return jar;
  }

  // Nivel 2: Node 18 con undici — forEach invoca callback por cada entrada de header,
  // incluidas múltiples Set-Cookie, sin mezclarlas.
  let capturóCookies = false;
  try {
    headers.forEach((value, name) => {
      if (name.toLowerCase() === 'set-cookie') { _parsearUna(value); capturóCookies = true; }
    });
  } catch (_) { /* continuar al nivel 3 */ }
  if (capturóCookies) return jar;

  // Nivel 3: último recurso — headers.get() devuelve todas unidas por ", ".
  // Dividir solo en comas seguidas de "NombreCookie=" para no romper valores con comas (ej. Expires).
  const raw = headers.get('set-cookie') || '';
  raw.split(/,\s*(?=[A-Za-z][A-Za-z0-9_\-]*=)/).forEach(_parsearUna);
  return jar;
}

function _cookieStr(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function _resolverUrl(url, base) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return new URL(url, base).toString();
}

// ─── ROPC: validar credenciales y obtener token JWT ─────────
//
//  Resource Owner Password Credentials — endpoint distinto al browser flow.
//  Permite saber definitivamente si las credenciales son correctas sin
//  depender de redirects/cookies. Útil incluso si las IPs de Railway están
//  bloqueadas para el form HTML de Keycloak.
async function _loginROPC(ruc, password) {
  const tokenUrl = `${SRI_BASE}/auth/realms/Internet/protocol/openid-connect/token`;
  const T = 15_000;

  // Intentar con distintos client_ids públicos del portal SRI
  const clientes = ['app-tuportal-internet', 'app-sri-claves-angular'];

  for (const client_id of clientes) {
    const r = await fetch(tokenUrl, {
      method:  'POST',
      headers: {
        ..._HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept':        'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id,
        username: ruc,
        password,
        scope: 'openid profile',
      }).toString(),
      signal: AbortSignal.timeout(T),
    });

    const data = await r.json().catch(() => ({ error: `parse_${r.status}` }));
    // Log completo del error para diagnóstico — NO mapear aquí
    console.log(`[SRI-ROPC] client:${client_id} → ${r.status} | error:${data.error || 'OK'} | desc:"${data.error_description || ''}"`);

    if (r.ok && data.access_token) {
      console.log(`[SRI-ROPC] Token obtenido — session_state:${(data.session_state || '').substring(0, 12)}...`);
      return { ...data, usedClient: client_id };
    }

    if (data.error === 'invalid_grant') {
      const rawDesc = data.error_description || 'invalid_grant';
      // Mapear mensajes conocidos de Keycloak a mensajes en español
      let desc;
      if (/temporarily disabled|too many/i.test(rawDesc)) {
        desc = 'Cuenta bloqueada temporalmente por demasiados intentos fallidos. Espere 30 minutos o recupere su clave en srienlinea.sri.gob.ec → "Generar o recuperar clave".';
      } else if (/account is disabled/i.test(rawDesc)) {
        desc = 'Cuenta deshabilitada. Contacte al SRI o use "Generar o recuperar clave" en srienlinea.sri.gob.ec.';
      } else if (/Invalid user credentials/i.test(rawDesc)) {
        desc = 'RUC o contraseña del portal SRI incorrectos. Verifique que puede ingresar con esas credenciales en srienlinea.sri.gob.ec usando usuario+clave (no Microsoft).';
      } else {
        desc = `Error Keycloak: ${rawDesc}`;
      }
      const err = new Error(desc);
      err.esCredenciales = true;
      throw err;
    }
    // 'unauthorized_client' / 'unsupported_grant_type' → probar siguiente cliente
  }

  const err = new Error('ROPC no habilitado en este realm');
  err.esCredenciales = false;
  throw err;
}

// ─── Intentar acceso al JSF con Bearer token ─────────────────
//
//  Algunos Keycloak adapters JSF aceptan Authorization: Bearer.
//  Si funciona, evitamos el browser flow completamente.
async function _jsfConBearer(accessToken) {
  const jar = {};
  let url = SRI_JSF_URL;

  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, {
      redirect: 'manual',
      headers: {
        ..._HEADERS,
        'Accept':        'text/html,application/xhtml+xml,*/*',
        'Authorization': `Bearer ${accessToken}`,
        'Cookie':        _cookieStr(jar),
      },
      signal: AbortSignal.timeout(15_000),
    });
    Object.assign(jar, _parsearSetCookie(r.headers));

    if (r.status === 302 || r.status === 301) {
      const loc = _resolverUrl(r.headers.get('location'), url);
      console.log(`[SRI-Bearer] ${r.status} → ${(loc || '').substring(0, 80)}`);
      if (!loc) break;
      url = loc;
      continue;
    }

    if (r.status === 200) {
      const html = await r.text();
      console.log(`[SRI-Bearer] 200 | ViewState:${html.includes('javax.faces.ViewState')} | len:${html.length}`);
      if (html.includes('javax.faces.ViewState')) {
        console.log('[SRI-Bearer] Formulario JSF con Bearer token — éxito!');
        return { jar, paginaJSF: html };
      }
    }
    break;
  }
  return null;
}

// ─── Login + obtener formulario JSF (flujo unificado) ────────
//
//  Estrategia:
//    0. ROPC: validar credenciales en el endpoint de tokens (sin browser flow)
//       - Si da invalid_grant → error definitivo de credenciales
//       - Si da token → intentar JSF con Bearer
//    1. Browser flow: seguir redirects, enviar form Keycloak una vez
//       (puede estar bloqueado si Railway usa IPs de AWS en lista negra del SRI)
async function _loginYObtenerJSF(ruc, password) {
  // ── 0. ROPC — validar credenciales y opcionalmente usar Bearer en JSF ──
  try {
    const tokens = await _loginROPC(ruc, password);
    // Credenciales correctas — intentar acceso directo con Bearer token
    const bearerResult = await _jsfConBearer(tokens.access_token);
    if (bearerResult) return bearerResult;
    // Bearer no funcionó, pero credenciales son válidas → continuar con browser flow
    console.log('[SRI-ROPC] Credenciales OK pero JSF no acepta Bearer. IP de Railway posiblemente bloqueada para browser flow.');
  } catch (ropcErr) {
    if (ropcErr.esCredenciales) {
      // ROPC reporta invalid_grant pero NO es definitivo: el endpoint /token de Keycloak
      // puede tener restricciones de IP distintas al login form (Railway usa IPs de AWS
      // que pueden estar en lista negra del /token pero no del form web).
      // Continuamos al browser flow; si ese también falla, ESE error es el definitivo.
      console.warn('[SRI-ROPC] invalid_grant en /token — continuando con browser flow para confirmar (posible bloqueo de IP en el endpoint ROPC)');
    } else {
      // ROPC no disponible (unauthorized_client, etc.) → continuar sin token
      console.log('[SRI-ROPC] No disponible:', ropcErr.message.substring(0, 80));
    }
  }

  // ── 1. Browser flow con seguimiento manual de redirects ─────
  const jar = {};
  const T   = 30_000;
  let url   = SRI_JSF_URL;
  let credencialesEnviadas = false;
  let reintentosJSF = 0;
  const MAX = 18;

  for (let i = 0; i < MAX; i++) {
    const r = await fetch(url, {
      method:   'GET',
      redirect: 'manual',
      headers:  {
        ..._HEADERS,
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Cookie': _cookieStr(jar),
        'Referer': SRI_BASE + '/',
      },
      signal: AbortSignal.timeout(T),
    });
    Object.assign(jar, _parsearSetCookie(r.headers));

    if (r.status === 302 || r.status === 301) {
      const loc = _resolverUrl(r.headers.get('location'), url);
      console.log(`[SRI-fetch] ${r.status} → ${(loc || '').substring(0, 100)}`);
      if (!loc) throw new Error('Portal SRI envió redirect sin URL destino');
      url = loc;
      continue;
    }

    if (r.status !== 200) {
      throw new Error(`Portal SRI respondió ${r.status} (URL: ${url.substring(0, 80)})`);
    }

    const html = await r.text();
    const tieneViewState = html.includes('javax.faces.ViewState');
    console.log(`[SRI-fetch] 200 | ViewState:${tieneViewState} | len:${html.length} | cookies:${Object.keys(jar).join(',') || 'ninguna'} | url:${url.substring(0, 80)}`);

    // ¿Ya tenemos el formulario JSF? → éxito
    if (tieneViewState) {
      console.log('[SRI-fetch] Formulario JSF obtenido correctamente');
      return { jar, paginaJSF: html };
    }

    // ¿Es el formulario de login de Keycloak?
    // Detectar por action con "login-actions" o "authenticate", o por id del form
    const esFormKeycloak =
      html.includes('/auth/realms/') ||
      html.includes('kc-form-login') ||
      html.includes('login-actions/authenticate');

    if (esFormKeycloak) {
      // Buscar específicamente el form de login de Keycloak (evitar forms secundarios).
      // Los atributos id/action pueden aparecer en cualquier orden en el HTML.
      const kcFormMatch = html.match(/<form[^>]+id="kc-form-login"[^>]*action="([^"]+)"/i)
                       || html.match(/<form[^>]+action="([^"]+)"[^>]*id="kc-form-login"/i)
                       || html.match(/<form[^>]+action="([^"]*login-actions\/authenticate[^"]*)"/i)
                       || html.match(/<form[^>]+action="([^"]+)"/i);
      if (!kcFormMatch) throw new Error('No se pudo extraer el action del form de Keycloak');

      if (credencialesEnviadas) {
        // Segunda aparición del form → credenciales incorrectas o IP bloqueada por SRI
        const errMatch = html.match(/class="[^"]*kc-feedback-text[^"]*"[^>]*>([\s\S]{0,300})<\/\w+>/i)
                       || html.match(/id="input-error[^"]*"[^>]*>([\s\S]{0,300})<\/\w+>/i);
        const msg = errMatch
          ? errMatch[1].replace(/<[^>]+>/g, '').trim()
          : 'RUC o contraseña incorrectos (o el portal SRI bloqueó la IP de AELA — usa "Conectar desde portal SRI")';
        throw new Error(`Credenciales del portal SRI incorrectas: ${msg}`);
      }

      // Extraer TODOS los <input type="hidden"> del form: Keycloak incluye tokens
      // de estado de sesión que deben enviarse junto con las credenciales.
      const hiddenCampos = {};
      const hiddenRe2 = /<input[^>]+type="hidden"[^>]*>/gi;
      let hm;
      while ((hm = hiddenRe2.exec(html)) !== null) {
        const nm = hm[0].match(/\bname="([^"]+)"/i);
        const vm = hm[0].match(/\bvalue="([^"]*)"/i);
        if (nm) hiddenCampos[nm[1]] = vm ? vm[1] : '';
      }
      // Log con valores (truncados) para diagnóstico
      const camposLog = Object.entries(hiddenCampos)
        .map(([k, v]) => `${k}="${v ? String(v).substring(0, 30) : ''}"`)
        .join(', ') || '(ninguno)';
      console.log('[SRI-fetch] Hidden campos Keycloak:', camposLog);

      // Log snippet del form HTML para ver exactamente qué campos hay
      const formSnip = html.match(/<form[^>]*(?:kc-form|authenticate|login)[^>]*>[\s\S]{0,700}/i)
                    || html.match(/<form[\s\S]{0,700}/i);
      if (formSnip) {
        const formClean = formSnip[0]
          .replace(/\s+/g, ' ')
          .replace(/value="[^"]{15,}"/g, 'value="…"')
          .substring(0, 500);
        console.log('[SRI-fetch] Form HTML:', formClean);
      }

      // Extraer TODOS los inputs visibles (type != hidden) para detectar campos extra
      const inputsVisibles = [];
      const inputRe = /<input[^>]+>/gi;
      let im;
      while ((im = inputRe.exec(html)) !== null) {
        const tipo = (im[0].match(/\btype="([^"]+)"/i) || [])[1] || 'text';
        if (tipo === 'hidden') continue;
        const nombre = (im[0].match(/\bname="([^"]+)"/i) || [])[1] || '';
        const id     = (im[0].match(/\bid="([^"]+)"/i)   || [])[1] || '';
        inputsVisibles.push(`${tipo}[name="${nombre}" id="${id}"]`);
      }
      console.log('[SRI-fetch] Inputs visibles del form:', inputsVisibles.join(', ') || '(ninguno)');

      // Buscar y loguear la función validarUsuario() — puede transformar/hashear la clave
      const scriptInline = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
      for (const sc of scriptInline) {
        if (/validarUsuario/i.test(sc)) {
          const fnMatch = sc.match(/function\s+validarUsuario[\s\S]{0,800}/i);
          if (fnMatch) {
            console.log('[SRI-fetch] validarUsuario() encontrada:', fnMatch[0].replace(/\s+/g, ' ').substring(0, 600));
          }
        }
      }
      // También buscar en scripts externos referenciados
      const scriptSrcs = [];
      const scriptSrcRe = /<script[^>]+src="([^"]+)"/gi;
      let ssm;
      while ((ssm = scriptSrcRe.exec(html)) !== null) {
        if (!/jquery|bootstrap|font-awesome|moment/i.test(ssm[1])) {
          scriptSrcs.push(ssm[1]);
        }
      }
      if (scriptSrcs.length > 0) {
        console.log('[SRI-fetch] Scripts externos (posible validarUsuario):', scriptSrcs.slice(0, 5).join(' | '));
      }

      const loginActionUrl = _resolverUrl(
        kcFormMatch[1].replace(/&amp;/g, '&'),
        url
      );
      // Log URL completa (sin truncar) para ver parámetros exactos
      console.log('[SRI-fetch] POST credenciales →', loginActionUrl || '(no encontrado)');

      // Replicar exactamente lo que hace validarUsuario() del portal SRI:
      //   username = usuarioPrincipal.toUpperCase()   (campo hidden ← campo visible)
      //   password = CryptoJS.MD5(pw) + SHA-512(pw)  (hash combinado, 160 chars)
      const hashedPw = _hashPasswordSRI(password);
      const postBody = new URLSearchParams({
        ...hiddenCampos,                            // campos hidden del form
        usuario:     ruc,                           // campo VISIBLE (input name="usuario")
        ciAdicional: '',                            // CI adicional (vacío)
        username:    ruc.toUpperCase(),             // campo HIDDEN (seteado por JS desde usuario)
        password:    hashedPw,                      // MD5(pw) + SHA-512(pw) = 160 chars
        login:       '',                            // botón submit (name="login")
        credentialId: hiddenCampos.credentialId ?? '',
      });

      // Log cuerpo del POST — muestra hash parcial (primeros 20 chars) para confirmar que aplica
      console.log(`[SRI-fetch] POST body: usuario=${ruc} | password_hash=${hashedPw.substring(0, 20)}... (${hashedPw.length} chars)`);

      const rPost = await fetch(loginActionUrl, {
        method:   'POST',
        redirect: 'manual',
        headers:  {
          ..._HEADERS,
          'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Content-Type':              'application/x-www-form-urlencoded',
          'Cookie':                    _cookieStr(jar),
          'Referer':                   url,
          'Origin':                    new URL(loginActionUrl).origin,
          'Upgrade-Insecure-Requests': '1',
          'Cache-Control':             'max-age=0',
          'Sec-Fetch-Site':            'same-origin',
          'Sec-Fetch-Mode':            'navigate',
          'Sec-Fetch-User':            '?1',
          'Sec-Fetch-Dest':            'document',
        },
        body:   postBody.toString(),
        signal: AbortSignal.timeout(T),
      });
      Object.assign(jar, _parsearSetCookie(rPost.headers));
      credencialesEnviadas = true;

      console.log(`[SRI-fetch] POST resultado: ${rPost.status} | location: ${(rPost.headers.get('location') || '').substring(0, 80)}`);

      if (rPost.status === 200) {
        const errHtml  = await rPost.text();
        // Log texto plano para diagnóstico (sin exponer password)
        const textPlano = errHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 400);
        console.log('[SRI-fetch] POST 200 respuesta:', textPlano);
        const errMatch = errHtml.match(/class="[^"]*kc-feedback-text[^"]*"[^>]*>([\s\S]{0,300})<\/\w+>/i)
                       || errHtml.match(/id="input-error[^"]*"[^>]*>([\s\S]{0,300})<\/\w+>/i)
                       || errHtml.match(/<span[^>]+class="[^"]*alert-error[^"]*"[^>]*>([\s\S]{0,300})<\/span>/i);
        const msg = errMatch ? errMatch[1].replace(/<[^>]+>/g, '').trim() : 'RUC o contraseña incorrectos';
        throw new Error(`Credenciales del portal SRI incorrectas: ${msg}`);
      }
      if (rPost.status !== 302 && rPost.status !== 301) {
        throw new Error(`Keycloak respondió ${rPost.status} al enviar credenciales`);
      }

      const loc = _resolverUrl(rPost.headers.get('location'), url);
      if (!loc) throw new Error('Keycloak no devolvió URL de redirección tras el login');
      url = loc;
      continue;
    }

    // 200 sin ViewState ni form Keycloak:
    // El redirect_uri apuntó a tuportal-internet (Angular).
    // Si ya enviamos credenciales, el realm Keycloak tiene una sesión SSO activa.
    // Al volver a GET el JSF URL, Keycloak reconoce la sesión y da sesión JSF sin re-login.
    if (credencialesEnviadas && reintentosJSF < 3) {
      reintentosJSF++;
      console.log(`[SRI-fetch] Sin ViewState (posiblemente tuportal), reintentando JSF URL (${reintentosJSF}/3)...`);
      url = SRI_JSF_URL;
      continue;
    }

    // Sin credenciales enviadas aún y sin form → situación inesperada
    if (!credencialesEnviadas) {
      throw new Error(
        `El portal SRI no redirigió al login (200 inesperado). ` +
        `URL: ${url.substring(0, 80)} | HTML len: ${html.length}`
      );
    }

    throw new Error(
      'El portal SRI no mostró el formulario de comprobantes recibidos tras el login. ' +
      'Verifica que la cuenta tenga acceso a Comprobantes Electrónicos en srienlinea.sri.gob.ec.'
    );
  }

  throw new Error('No se pudo iniciar sesión en el portal SRI (demasiadas redirecciones)');
}

// ─── Refrescar página JSF (para obtener nuevo ViewState entre meses) ─
async function _obtenerPaginaJSF(jar) {
  let url = SRI_JSF_URL;
  const T = 20_000;

  for (let i = 0; i < 8; i++) {
    const r = await fetch(url, {
      redirect: 'manual',
      headers:  { ..._HEADERS, 'Accept': 'text/html', 'Cookie': _cookieStr(jar) },
      signal:   AbortSignal.timeout(T),
    });
    Object.assign(jar, _parsearSetCookie(r.headers));

    if (r.status === 302 || r.status === 301) {
      const loc = _resolverUrl(r.headers.get('location'), url);
      if (!loc) break;
      url = loc;
      continue;
    }
    if (r.status === 200) return r.text();
    throw new Error(`Error ${r.status} al refrescar el formulario JSF del SRI`);
  }
  throw new Error('No se pudo acceder al formulario JSF del SRI para la siguiente consulta');
}

// ─── Paso 3: Extraer campos del formulario JSF desde HTML ────
function _extraerCamposJSF(html) {
  const vsMatch = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/)
                || html.match(/id="javax\.faces\.ViewState"[^>]*value="([^"]+)"/);
  if (!vsMatch) throw new Error('No se pudo leer el estado del formulario JSF (ViewState ausente)');
  const viewState = vsMatch[1];

  // Extraer el ID del form principal
  const formMatch = html.match(/<form[^>]+id="([^"]+)"/i);
  const formId    = formMatch ? formMatch[1] : '';

  // Helper para extraer el primer `name` que coincida con algún patrón
  const campo = (...pats) => {
    for (const p of pats) {
      const m = html.match(p);
      if (m) return m[1];
    }
    return null;
  };

  const fieldTipoIdent = campo(
    /name="([^"]*tipoIdentificacion[^"]*)"/i,
    /name="([^"]*tipo[_-]?ident[^"]*)"/i,
  );
  const fieldIdent = campo(
    /name="([^"]*:identificacion)"/i,
    /name="([^"]*identificacion[^"]*)"\s+(?:type="text"|class=)/i,
  );
  const fieldAnio = campo(
    /name="([^"]*[Aa]n[ií]o[^"]*)"[^>]*>[^<]{0,50}<option/,
    /name="([^"]*[Aa]ni[oo][^"]*)"/i,
    /id="([^"]*[Aa]ni[oo][^"]*)"/i,
  );
  const fieldMes = campo(
    /name="([^"]*[Mm]es[^"]*)"[^>]*>[^<]{0,50}<option/,
    /name="([^"]*[Mm]es[^"]*)"/i,
  );
  const fieldTipoComp = campo(
    /name="([^"]*tipo[^"]*)"[^>]*>[^<]{0,200}<option[^>]*value="01"/,
    /name="([^"]*[Tt]ipo[Cc]omprobante[^"]*)"/i,
  );
  const fieldBtn = campo(
    /name="([^"]*[Cc]onsultar[^"]*)"[^>]*(?:type="submit"|value="[Cc]onsultar")/i,
    /id="([^"]*[Cc]onsultar[^"]*)"/i,
    /id="([^"]*[Bb]tn[^"]*)"/i,
    /name="([^"]*[Bb]tn[^"]*)"/i,
  );

  return { viewState, formId, fieldTipoIdent, fieldIdent, fieldAnio, fieldMes, fieldTipoComp, fieldBtn };
}

// ─── Paso 4: POST JSF AJAX ───────────────────────────────────
async function _postJSF(jar, campos, { ruc, anio, mes, tipoComprobante }) {
  const { viewState, formId, fieldTipoIdent, fieldIdent, fieldAnio, fieldMes, fieldTipoComp, fieldBtn } = campos;

  if (!fieldBtn || !viewState) {
    throw new Error('No se pudieron identificar los campos del formulario JSF del SRI');
  }

  const p = new URLSearchParams();
  p.append('javax.faces.partial.ajax',   'true');
  p.append('javax.faces.source',         fieldBtn);
  p.append('javax.faces.partial.execute', '@all');
  p.append('javax.faces.partial.render',  '@all');
  p.append(fieldBtn, fieldBtn);
  if (formId)         p.append(formId, formId);
  if (fieldTipoIdent) p.append(fieldTipoIdent, 'R');         // R = RUC/Cédula
  if (fieldIdent)     p.append(fieldIdent, ruc);
  if (fieldAnio)      p.append(fieldAnio, String(anio));
  if (fieldMes)       p.append(fieldMes,  String(mes));
  if (fieldTipoComp && tipoComprobante && tipoComprobante !== 'TODOS') {
    p.append(fieldTipoComp, tipoComprobante);
  }
  p.append('javax.faces.ViewState', viewState);

  const r = await fetch(SRI_JSF_URL, {
    method:  'POST',
    headers: {
      ..._HEADERS,
      'Cookie':        _cookieStr(jar),
      'Content-Type':  'application/x-www-form-urlencoded; charset=UTF-8',
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept':        'application/xml, text/xml, */*; q=0.01',
      'Origin':        SRI_BASE,
      'Referer':       SRI_JSF_URL,
    },
    body:   p.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  Object.assign(jar, _parsearSetCookie(r.headers));

  if (!r.ok) throw new Error(`Error consultando el portal SRI (${r.status}): ${r.statusText}`);
  return r.text();
}

// ─── Paso 5: Parsear XML de respuesta JSF ───────────────────
function _parsearXmlJSF(xml) {
  const items = [];
  const cdataRe = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let cdataMatch;

  while ((cdataMatch = cdataRe.exec(xml)) !== null) {
    const html = cdataMatch[1];
    const rowRe  = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRe.exec(html)) !== null) {
      const rowHtml = rowMatch[1];
      const celdas  = [];
      const cellRe  = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cellMatch;

      while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
        celdas.push(
          cellMatch[1]
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&nbsp;/g, ' ').replace(/&#160;/g, ' ')
            .trim().replace(/\s+/g, ' ')
        );
      }
      if (celdas.length < 2) continue;

      // Buscar clave de acceso de 49 dígitos en las celdas
      let claveAcceso = null;
      for (const c of celdas) {
        if (/^\d{49}$/.test(c.replace(/\s/g, ''))) { claveAcceso = c.replace(/\s/g, ''); break; }
      }
      // También buscar en hrefs de la fila
      if (!claveAcceso) {
        const hrefM = rowHtml.match(/claveAcceso[=:](\d{49})/i);
        if (hrefM) claveAcceso = hrefM[1];
      }
      if (!claveAcceso) continue;

      const fechaCell = celdas.find((c) => /\d{2}\/\d{2}\/\d{4}/.test(c));
      const totalCell = celdas.find((c) => /^\$?\s*\d[\d.,]*$/.test(c.trim()));
      const razonCell = celdas.find((c) =>
        c.length > 3 && !/^\d+$/.test(c) && c !== claveAcceso &&
        !/^\d{2}\/\d{2}\/\d{4}$/.test(c) && !/^\$?\s*\d[\d.,]*$/.test(c.trim())
      );

      items.push({
        claveAcceso,
        razonSocialEmisor: razonCell  || '',
        fechaEmision:      fechaCell  || '',
        importeTotal:      totalCell  ? parseFloat(totalCell.replace(/[$, ]/g, '')) || 0 : 0,
      });
    }
  }

  // Loguear si el SRI devolvió un mensaje (sin resultados o error)
  if (items.length === 0) {
    const msgMatch = xml.match(/<update[^>]*>\s*<!\[CDATA\[([\s\S]{0,400})\]\]>/i);
    if (msgMatch) {
      const msg = msgMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (msg) console.log('[SRI JSF] Mensaje del portal:', msg.substring(0, 200));
    }
  }

  return items;
}

// ─── Función principal fetch-based ──────────────────────────
async function obtenerRecibidosFetch({
  identificacion,
  password,
  fechaDesde,
  fechaHasta,
  tipoComprobante = 'TODOS',
} = {}) {
  if (!identificacion || !password) {
    throw new Error('Se requiere identificación y contraseña del portal SRI');
  }

  const fDesde = _normalizarFecha(fechaDesde);
  const fHasta = _normalizarFecha(fechaHasta);
  const meses  = _mesesEnRango(fDesde, fHasta);

  // 1. Login + obtener formulario JSF (flujo unificado con seguimiento de redirects)
  const { jar, paginaJSF } = await _loginYObtenerJSF(identificacion, password);

  // 2. Extraer ViewState y campos del formulario
  const html   = paginaJSF;
  let campos   = _extraerCamposJSF(html);

  const todosPorDuplicar = [];

  // 3. Consultar cada mes del rango
  for (const { anio, mes } of meses) {
    const xml   = await _postJSF(jar, campos, { ruc: identificacion, anio, mes, tipoComprobante });
    const items = _parsearXmlJSF(xml);
    todosPorDuplicar.push(...items);

    // Refrescar ViewState para la siguiente consulta
    if (meses.length > 1) {
      try {
        const freshHtml = await _obtenerPaginaJSF(jar);
        campos = _extraerCamposJSF(freshHtml);
      } catch { /* continuar con campos anteriores */ }
    }
  }

  return _deduplicar(todosPorDuplicar);
}

// Alias de compatibilidad (por si se importa directamente)
const sriLoginKeycloak = async () => {
  throw new Error('sriLoginKeycloak ya no se usa; usa obtenerRecibidosFetch()');
};
const sriGetComprobantesRecibidos = async () => {
  throw new Error('sriGetComprobantesRecibidos ya no se usa; usa obtenerRecibidosFetch()');
};

// ═══════════════════════════════════════════════════════════════
//  BLOQUE 2 — LEGACY PUPPETEER (mantenido como referencia)
// ═══════════════════════════════════════════════════════════════

// ── URLs confirmadas del portal SRI (JSF, vigente al 2026-06-02) ─
const SRI_LOGIN_URL     = `${SRI_BASE}/`;                 // redirige al login JSF si no autenticado
const SRI_LOGIN_URL_ALT = `${SRI_BASE}/sri-en-linea/`;   // home del portal
const SRI_LOGIN_JSF     = `${SRI_BASE}/sri-en-linea/SriLoginInternet/ConsultaRucActionInternet/AgregarServicio`;

// URL real de comprobantes recibidos (confirmada 2026-06-02)
const SRI_RECIBIDOS_URL = `${SRI_BASE}/comprobantes-electronicos-internet/pages/consultas/menu.jsf`;

const TIMEOUT_NAV  = 20_000;   // reducido de 40s: falla más rápido si el portal no responde
const TIMEOUT_SEL  = 12_000;
const MAX_PAGINAS  = 30;   // máx 3 000 docs (30 páginas × 100)

// ── Detectar si la URL es la página de login ─────────────────
function _esUrlLogin(url) {
  return url.includes('/auth/login') ||
         url.includes('SriLoginInternet') ||
         url.includes('AgregarServicio') ||
         url.includes('/login');
}

// ── Detectar si el login fue exitoso ─────────────────────────
// Se agrega el patrón de la URL de comprobantes y del home JSF
function _esUrlAutenticada(url) {
  return url.includes('/contribuyente/') ||
         url.includes('/sri-en-linea/home') ||
         url.includes('/sri-en-linea/inicio') ||
         url.includes('/comprobantes/') ||
         url.includes('/comprobantes-electronicos-internet/') ||
         url.includes('/menuOpciones') ||
         url.includes('/Servicios.jsf') ||
         url.includes('/menu.jsf');
}

// ─── Resolver ruta absoluta de Chromium ──────────────────────
function _resolverRutaChromium() {
  const raw = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROMIUM_PATH;
  if (!raw) return null;
  if (nodePath.isAbsolute(raw)) return raw;
  try {
    const fullPath = execSync(`which "${raw}" 2>/dev/null`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
      encoding: 'utf8',
    }).trim();
    if (fullPath) return fullPath;
  } catch { /* noop */ }
  return raw;
}

// ─── Lanzar navegador ─────────────────────────────────────────
//
//  Estrategia de 3 niveles para Railway/serverless:
//    1. PUPPETEER_EXECUTABLE_PATH / CHROMIUM_PATH (configurado en Railway env vars)
//    2. @sparticuz/chromium (binario comprimido, descarga automática, diseñado para serverless)
//    3. Chromium bundleado por puppeteer (solo funciona en desarrollo local)
async function _lanzarNavegador() {
  const configuredPath = _resolverRutaChromium();

  const BASE_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-zygote',
    '--no-proxy-server',
    '--ignore-certificate-errors',
    '--disable-extensions',
    '--disable-sync',
    '--disable-translate',
    '--mute-audio',
    '--window-size=1280,800',
  ];

  // Nivel 1: ruta explícita (nixpacks en Railway con PUPPETEER_EXECUTABLE_PATH=chromium)
  if (configuredPath) {
    try {
      console.log('[SRI-Browser] Nivel 1 — executablePath:', configuredPath);
      return await puppeteer.launch({
        headless: true,
        args: BASE_ARGS,
        executablePath: configuredPath,
        timeout: 30_000,
        defaultViewport: { width: 1280, height: 800 },
      });
    } catch (err) {
      console.warn('[SRI-Browser] Nivel 1 falló:', err.message.substring(0, 100));
    }
  }

  // Nivel 2: @sparticuz/chromium (optimizado para Railway/Lambda/serverless)
  try {
    const chromium = require('@sparticuz/chromium');
    const sparticuzExec = await chromium.executablePath();
    console.log('[SRI-Browser] Nivel 2 — @sparticuz/chromium:', sparticuzExec);
    return await puppeteer.launch({
      headless: chromium.headless,
      args: [...chromium.args, ...BASE_ARGS],
      executablePath: sparticuzExec,
      timeout: 30_000,
      defaultViewport: { width: 1280, height: 800 },
    });
  } catch (err) {
    console.warn('[SRI-Browser] Nivel 2 (@sparticuz/chromium) falló:', err.message.substring(0, 100));
  }

  // Nivel 3: puppeteer con su propio Chromium (solo disponible en desarrollo local)
  try {
    console.log('[SRI-Browser] Nivel 3 — puppeteer bundled Chromium');
    return await puppeteer.launch({
      headless: true,
      args: BASE_ARGS,
      timeout: 30_000,
      defaultViewport: { width: 1280, height: 800 },
    });
  } catch (err) {
    throw new Error(`BROWSER_UNAVAILABLE: No se pudo iniciar el navegador en ninguno de los 3 niveles. Último error: ${err.message}`);
  }
}

async function _buscarPrimerSelector(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) return el;
    } catch { /* continuar */ }
  }
  return null;
}

async function _clickControlPorTexto(page, textos = []) {
  return page.evaluate((labels) => {
    const normalizar = (txt) => String(txt || '').trim().toLowerCase();
    const buscados = labels.map(normalizar);
    const controles = Array.from(document.querySelectorAll(
      'button, input[type="submit"], input[type="button"], a'
    ));
    const encontrado = controles.find((el) => {
      const texto = normalizar(el.textContent || el.value || el.getAttribute('aria-label'));
      return buscados.some((label) => texto.includes(label));
    });
    if (!encontrado) return false;
    encontrado.click();
    return true;
  }, textos).catch(() => false);
}

// ─── Descomponer rango de fechas en meses ─────────────────────
// Entrada: dd/mm/yyyy — Salida: [{ anio, mes }, ...]
function _mesesEnRango(fechaDesde, fechaHasta) {
  const pd = String(fechaDesde || '').split('/');
  const ph = String(fechaHasta || '').split('/');
  const anioIni = parseInt(pd[2], 10) || new Date().getFullYear();
  const mesIni  = parseInt(pd[1], 10) || 1;
  const anioFin = parseInt(ph[2], 10) || anioIni;
  const mesFin  = parseInt(ph[1], 10) || 12;

  const meses = [];
  let y = anioIni, m = mesIni;
  while (y < anioFin || (y === anioFin && m <= mesFin)) {
    meses.push({ anio: y, mes: m });
    if (++m > 12) { m = 1; y++; }
  }
  return meses.length > 0 ? meses : [{ anio: anioIni, mes: mesIni }];
}

// ─── Llenar el formulario JSF de comprobantes (año + mes) ─────
// El portal SRI filtra por período (año + mes), no por rango de fechas.
async function _consultarMesJsf(page, ruc, anio, mes, tipoComprobante) {
  // 1. Seleccionar radio "Ruc/Cédula/Pasaporte" (primer radio del formulario)
  await page.evaluate(() => {
    const radios = document.querySelectorAll('input[type="radio"]');
    if (radios[0]) radios[0].click();
  }).catch(() => {});

  // 2. Llenar campo RUC (puede estar pre-relleno por la sesión)
  if (ruc) {
    const rucSels = [
      'input[id*="identificacion"]', 'input[name*="identificacion"]',
      'input[id*="ruc"]',            'input[name*="ruc"]',
      'input[id*="cedula"]',         'input[name*="cedula"]',
    ];
    for (const sel of rucSels) {
      const el = await page.$(sel).catch(() => null);
      if (!el) continue;
      const visible = await el.evaluate(e => e.offsetParent !== null).catch(() => false);
      if (!visible) continue;
      const actual = await el.evaluate(e => e.value).catch(() => '');
      if (actual !== ruc) {
        await el.click({ clickCount: 3 });
        await el.type(ruc, { delay: 30 });
      }
      break;
    }
  }

  // 3. Seleccionar año
  const anioSels = [
    'select[id*="anio"]', 'select[name*="anio"]',
    'select[id*="ano"]',  'select[name*="ano"]',
    'select[id*="year"]', 'select[name*="year"]',
    'select[id*="Year"]',
  ];
  for (const sel of anioSels) {
    try {
      if (!await page.$(sel)) continue;
      await page.select(sel, String(anio));
      break;
    } catch { /* continuar */ }
  }

  // 4. Seleccionar mes (puede ser "1"-"12" o "01"-"12")
  const mesSels = [
    'select[id*="mes"]',   'select[name*="mes"]',
    'select[id*="month"]', 'select[name*="month"]',
    'select[id*="Mes"]',
  ];
  for (const sel of mesSels) {
    try {
      if (!await page.$(sel)) continue;
      const mesStr    = String(mes);
      const mesStr2   = mesStr.padStart(2, '0');
      let seleccionado = false;
      for (const v of [mesStr, mesStr2]) {
        try { await page.select(sel, v); seleccionado = true; break; } catch { /* probar siguiente */ }
      }
      if (seleccionado) break;
    } catch { /* continuar */ }
  }

  // 5. Tipo de comprobante (dejar en default si es TODOS)
  if (tipoComprobante && tipoComprobante !== 'TODOS') {
    const tipoSels = [
      'select[id*="tipo"]',       'select[name*="tipo"]',
      'select[id*="comprobante"]', 'select[name*="comprobante"]',
    ];
    for (const sel of tipoSels) {
      try {
        if (!await page.$(sel)) continue;
        await page.select(sel, tipoComprobante).catch(() => {});
        break;
      } catch { /* continuar */ }
    }
  }

  // 6. Click en "Consultar"
  const btnSels = [
    'input[value="Consultar"]',
    'input[value="consultar"]',
    '[id*="btnConsultar"]',
    '[id*="consultar"]',
    'button[type="submit"]',
    'input[type="submit"]',
  ];
  let clicked = false;
  for (const sel of btnSels) {
    const btn = await page.$(sel).catch(() => null);
    if (!btn) continue;
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV }).catch(() => {}),
      btn.click(),
    ]);
    clicked = true;
    break;
  }
  if (!clicked) {
    const ok = await _clickControlPorTexto(page, ['Consultar', 'Buscar']);
    if (ok) {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
    }
  }

  // Esperar a que aparezca la tabla o alguna señal de resultado
  await page.waitForSelector(
    'table, .lista, .dataTable, [class*="comprobante"]',
    { timeout: TIMEOUT_SEL }
  ).catch(() => {});
}

// ─── Extraer filas de la tabla de resultados ──────────────────
async function _extraerFilas(page) {
  return page.evaluate(() => {
    // Buscar la tabla con más columnas (la de datos)
    const tablas = Array.from(document.querySelectorAll('table'));
    let tabla = null;
    let maxCols = 0;
    for (const t of tablas) {
      const headers = t.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td');
      if (headers.length > maxCols) { maxCols = headers.length; tabla = t; }
    }
    if (!tabla) return { rows: [], total: 0 };

    const rows = [];
    const trs  = Array.from(tabla.querySelectorAll('tbody tr, tr:not(:first-child)'));

    // Paginador (total de registros reportado por el portal)
    let total = 0;
    const paginador = document.querySelector(
      '[id*="paginador"], [id*="paginator"], .ui-paginator-current, [id*="totalRegistros"]'
    );
    if (paginador) {
      const m = paginador.textContent.match(/(\d+)\s*(registro|resultado|total)/i)
             || paginador.textContent.match(/de\s+(\d+)/i);
      if (m) total = parseInt(m[1], 10);
    }

    for (const tr of trs) {
      const celdas = Array.from(tr.querySelectorAll('td'));
      const textos = celdas.map((c) => c.textContent.trim().replace(/\s+/g, ' '));

      // Clave de acceso: 49 dígitos en celda o enlace
      let claveAcceso = null;
      for (const t of textos) {
        const solo = t.replace(/\s/g, '');
        if (/^\d{49}$/.test(solo)) { claveAcceso = solo; break; }
      }
      if (!claveAcceso) {
        const links = tr.querySelectorAll('a');
        for (const a of links) {
          const href = a.href || '';
          const txt  = (a.textContent || '').replace(/\s/g, '');
          const m = href.match(/claveAcceso[=:](\d{49})/i) || txt.match(/^(\d{49})$/);
          if (m) { claveAcceso = m[1]; break; }
        }
      }
      if (!claveAcceso) continue;

      const razonSocial = textos.find((t) => t.length > 5 && !/^\d+$/.test(t) && t !== claveAcceso) || null;
      const fechaMatch  = textos.find((t) => /\d{2}\/\d{2}\/\d{4}/.test(t)) || null;
      const totalMatch  = textos.find((t) => /^\$?\s*[\d.,]+$/.test(t.replace(/\s/g, ''))) || null;

      rows.push({
        claveAcceso,
        razonSocialEmisor: razonSocial,
        fechaEmision:      fechaMatch,
        importeTotal:      totalMatch ? parseFloat(totalMatch.replace(/[$, ]/g, '')) || 0 : 0,
      });
    }

    return { rows, total };
  });
}

// ─── Siguiente página (JSF y PrimeFaces) ─────────────────────
async function _irSiguientePagina(page) {
  const SEL_NEXT = [
    // PrimeFaces
    '.ui-paginator-next:not(.ui-state-disabled)',
    // Botones genéricos de siguiente
    '[id*="next"]:not([disabled])',
    'a[title="Siguiente"]',
    'a[title="siguiente"]',
    'a.paginadorSiguiente',
    '.paginadorSig',
    'input[value="Siguiente"]',
  ];

  for (const sel of SEL_NEXT) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV }).catch(() => {}),
        btn.click(),
      ]);
      return true;
    }
  }

  // Buscar por texto como fallback
  const clicked = await _clickControlPorTexto(page, ['Siguiente', 'siguiente', 'Next']);
  if (clicked) {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV }).catch(() => {});
    return true;
  }

  return false;
}

// ─── Deduplicar por clave de acceso ──────────────────────────
function _deduplicar(items) {
  const visto = new Set();
  return items.filter((it) => {
    if (visto.has(it.claveAcceso)) return false;
    visto.add(it.claveAcceso);
    return true;
  });
}

// ─── Normalizar fecha a dd/mm/yyyy ────────────────────────────
function _normalizarFecha(fecha) {
  if (!fecha) return '';
  const m = String(fecha).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return fecha;
}

// ─── Login en el portal SRI ───────────────────────────────────
/**
 * Autenticar en el portal SRI (JSF) y retornar { cookies, token }.
 * Para el portal JSF, token siempre es null (usa JSESSIONID en cookies).
 */
async function scraperSriLogin(identificacion, password) {
  let browser;
  try {
    browser = await _lanzarNavegador();
    const page = await browser.newPage();

    page.on('requestfailed', () => {});
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-EC,es;q=0.9' });

    // Interceptar el POST de autenticación para loguear qué envía validarUsuario()
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('login-actions/authenticate') && req.method() === 'POST') {
        const rawBody = req.postData() || '';
        const safeBody = rawBody.replace(/(?:^|&)(password=)[^&]*/g, '&$1***').replace(/^&/, '');
        console.log('[SRI-Puppeteer] POST authenticate body:', safeBody.substring(0, 500));
      }
      req.continue();
    });

    // ── Navegar al portal (el orden asegura llegar al formulario de login) ──
    let loginExitoso = false;
    for (const loginUrl of [SRI_LOGIN_URL, SRI_LOGIN_URL_ALT, SRI_LOGIN_JSF]) {
      try {
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV });
        const url = page.url();
        if (_esUrlAutenticada(url)) { loginExitoso = true; break; }
        if (url.includes('srienlinea.sri.gob.ec')) break;
      } catch { /* intentar siguiente */ }
    }

    if (loginExitoso) {
      const cookies = await page.cookies();
      await browser.close();
      return { cookies, token: null };
    }

    // ── Detectar campos del formulario ───────────────────────
    // NOTA: el portal SRI Keycloak customizado usa:
    //   - input#usuario (VISIBLE, el que escribe el usuario)
    //   - input#username type="hidden" (JS lo rellena desde #usuario en onsubmit)
    //   - onsubmit="return validarUsuario();" hashea la clave automáticamente
    // Puppeteer llena el campo VISIBLE y el submit dispara validarUsuario() nativamente.
    const SELECTORS_USER = [
      '#usuario',                            // SRI Keycloak — campo visible confirmado
      'input[name="usuario"]',               // fallback por nombre
      '#ruc',
      'input[name="ruc"]',
      '#usuario2',
      'input[id*="usuario"]',
      'input[formcontrolname="usuario"]',
      'input[autocomplete="username"]',
      '#kc-form-login input[type="text"]',
      'input[type="text"]:first-of-type',
    ];
    const SELECTORS_PASS = [
      '#contrasenia',
      'input[name="contrasenia"]',
      'input[id*="contrasenia"]',
      '#password',
      'input[name="password"]',
      // Angular fallbacks
      'input[formcontrolname="contrasenia"]',
      'input[autocomplete="current-password"]',
      'input[type="password"]',
    ];

    // Esperar a que aparezca el formulario
    await page.waitForSelector('input[type="text"], input[type="password"]', { timeout: TIMEOUT_SEL }).catch(() => {});

    const userField = await _buscarPrimerSelector(page, SELECTORS_USER);
    if (!userField) {
      await browser.close();
      throw new Error(
        'No se encontró el campo de usuario en el portal SRI. ' +
        'Puede que el portal haya cambiado su estructura. Usa "Importar TXT del SRI" o "Importar ZIP".'
      );
    }

    const passField = await _buscarPrimerSelector(page, SELECTORS_PASS);
    if (!passField) {
      await browser.close();
      throw new Error('No se encontró el campo de contraseña en el portal SRI.');
    }

    // ── Llenar credenciales ───────────────────────────────────
    await userField.click({ clickCount: 3 });
    await userField.type(identificacion, { delay: 40 });

    await passField.click({ clickCount: 3 });
    await passField.type(password, { delay: 40 });

    // ── Enviar formulario ────────────────────────────────────
    const SELECTORS_SUBMIT = [
      'input[value="Ingresar"]',
      'button[type="submit"]',
      'input[type="submit"]',
      '#btnIngresar',
      '[id*="btnIngresar"]',
      '[id*="ingresar"]',
    ];

    let submitted = false;
    const btnSubmit = await _buscarPrimerSelector(page, SELECTORS_SUBMIT);
    if (btnSubmit) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV }).catch(() => {}),
        btnSubmit.click(),
      ]);
      submitted = true;
    }

    if (!submitted) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV }).catch(() => {}),
        _clickControlPorTexto(page, ['Ingresar', 'Entrar', 'Acceder', 'Login']),
      ]).catch(() => {});
    }

    // ── Verificar resultado del login ─────────────────────────
    const urlActual = page.url();

    if (_esUrlLogin(urlActual) || !_esUrlAutenticada(urlActual)) {
      const mensajeError = await page.$eval(
        '[id*="mensajeError"], .msgError, .error-message, .ui-messages-error-detail, ' +
        '.alert-danger, .mat-error, [class*="error"]:not(input)',
        (el) => el.textContent.trim()
      ).catch(() => null);

      await browser.close();
      throw new Error(
        mensajeError ||
        'Las credenciales del portal SRI son incorrectas. ' +
        'Verifica el RUC/cédula y la contraseña de srienlinea.sri.gob.ec.'
      );
    }

    const cookies = await page.cookies();
    await browser.close();
    return { cookies, token: null };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

// ─── Consulta de comprobantes recibidos ──────────────────────
/**
 * Consultar comprobantes recibidos usando cookies de sesión.
 * Itera por cada mes del rango dado (el portal SRI filtra por año+mes).
 *
 * @param {Array|{cookies}}  cookies   Cookies de scraperSriLogin
 * @param {{ ruc, fechaDesde, fechaHasta, tipoComprobante }} params
 * @returns {{ total: number, items: Array }}
 */
async function scraperSriRecibidos(cookies, {
  ruc,
  fechaDesde,
  fechaHasta,
  tipoComprobante = 'TODOS',
} = {}) {
  const fDesde  = _normalizarFecha(fechaDesde);
  const fHasta  = _normalizarFecha(fechaHasta);
  const meses   = _mesesEnRango(fDesde, fHasta);

  let browser;
  try {
    browser = await _lanzarNavegador();
    const page = await browser.newPage();
    page.on('requestfailed', () => {});

    // Restaurar sesión
    const cookiesArr = Array.isArray(cookies) ? cookies : (cookies?.cookies || []);
    if (cookiesArr.length > 0) await page.setCookie(...cookiesArr);

    // Navegar a comprobantes recibidos
    await page.goto(SRI_RECIBIDOS_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV });

    if (_esUrlLogin(page.url())) {
      await browser.close();
      throw new Error('La sesión del portal SRI expiró. Vuelve a intentar.');
    }

    const todosLosItems = [];

    // El portal filtra por mes — iterar sobre cada mes del rango
    for (const { anio, mes } of meses) {
      await _consultarMesJsf(page, ruc, anio, mes, tipoComprobante);

      // Extraer todas las páginas del mes actual
      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        if (pagina > 0) {
          const hayMas = await _irSiguientePagina(page);
          if (!hayMas) break;
        }

        const { rows } = await _extraerFilas(page);
        if (rows.length === 0) break;
        todosLosItems.push(...rows);
      }
    }

    await browser.close();
    const items = _deduplicar(todosLosItems);
    return { total: items.length, items };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

// ─── Función principal exportada ──────────────────────────────
/**
 * Login + consulta de comprobantes recibidos.
 * Intenta primero con fetch-based JSF (sin Puppeteer).
 * Si falla por razones técnicas (no por credenciales), reintenta con Puppeteer.
 *
 * @param {{ identificacion, password, fechaDesde, fechaHasta, tipoComprobante }} params
 * @returns {Array<{ claveAcceso, razonSocialEmisor, fechaEmision, importeTotal }>}
 */
async function obtenerRecibidosScraper({
  identificacion,
  password,
  fechaDesde,
  fechaHasta,
  tipoComprobante = 'TODOS',
} = {}) {
  if (!identificacion || !password) {
    throw new Error('Se requiere identificación y contraseña del portal SRI');
  }
  if (!fechaDesde || !fechaHasta) {
    throw new Error('Se requiere rango de fechas (fechaDesde, fechaHasta)');
  }

  const params = { identificacion, password, fechaDesde, fechaHasta, tipoComprobante };

  // ── Intento 1: fetch-based (sin Puppeteer, funciona en Railway) ──
  try {
    console.log('[SRI] Intentando scraper fetch-based (JSF)...');
    const items = await obtenerRecibidosFetch(params);
    console.log(`[SRI] Fetch-based OK: ${items.length} comprobantes`);
    return items;
  } catch (fetchErr) {
    console.warn('[SRI] Fetch-based falló:', fetchErr.message);
    // NO bloqueamos Puppeteer aunque el mensaje parezca de credenciales.
    // El portal SRI ejecuta validarUsuario() en onsubmit (JavaScript puro) que
    // puede transformar/hashear la clave antes del POST. El fetch-based no ejecuta
    // JS y la clave llega cruda al servidor → "Clave inválida / inactiva" incluso
    // con la clave correcta. Puppeteer ejecuta ese JS correctamente.
    console.log('[SRI] Continuando con Puppeteer (ejecuta validarUsuario JS)...');
  }

  // ── Intento 2: Puppeteer con @sparticuz/chromium (disponible en Railway) ──
  console.log('[SRI] Intentando scraper Puppeteer (fallback)...');
  const TIMEOUT_TOTAL_MS = 3 * 60 * 1000;

  const scraperPromise = (async () => {
    const session = await scraperSriLogin(identificacion, password);
    const { items } = await scraperSriRecibidos(session, {
      ruc: identificacion,
      fechaDesde,
      fechaHasta,
      tipoComprobante,
    });
    return items;
  })();

  return Promise.race([
    scraperPromise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(
          'Tiempo de espera agotado (3 min). El portal SRI no respondió a tiempo. ' +
          'Prueba más tarde o descarga el ZIP desde srienlinea.sri.gob.ec → Comprobantes electrónicos → Recibidos → Descargar XML e impórtalo con "Importar ZIP".'
        )),
        TIMEOUT_TOTAL_MS
      )
    ),
  ]);
}

module.exports = {
  // Fetch-based (Keycloak, sin Puppeteer) — preferido
  sriLoginKeycloak,
  sriGetComprobantesRecibidos,
  obtenerRecibidosFetch,
  // Legacy Puppeteer
  obtenerRecibidosScraper,
  scraperSriLogin,
  scraperSriRecibidos,
};
