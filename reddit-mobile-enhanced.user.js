// ==UserScript==
// @name         Reddit Mobile Enhanced
// @namespace    reddit-mobile-enhanced
// @version      1.0.1
// @description  Narwhal-ähnliches Reddit im mobilen Browser: eigene Kommentaransicht (komplett ausgeklappt, farbige Ebenen, Abstimmen, Antworten, Suche), Toolbar, Gesten, OLED-Schwarz, ohne Werbung
// @match        https://www.reddit.com/*
// @match        https://reddit.com/*
// @run-at       document-start
// @noframes
// @updateURL    https://raw.githubusercontent.com/SleepwalkEr91/reddit-mobile-enhanced/main/reddit-mobile-enhanced.user.js
// @downloadURL  https://raw.githubusercontent.com/SleepwalkEr91/reddit-mobile-enhanced/main/reddit-mobile-enhanced.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  /* ---------------------------------------------------------------
   * Einstellungen
   * ------------------------------------------------------------- */
  const DEFAULTS = {
    feedSort: 'off',          // off | best | hot | new | top | rising
    feedTopTime: 'day',       // hour | day | week | month | year | all
    applyFeedSortHome: true,
    applyFeedSortSubs: true,
    commentSort: 'off',       // off | confidence | top | new | controversial | old | qa
    homeUrl: '/',
    toolbarPos: 'right',      // left | center | right
    hideOnScroll: false,
    showPrevButton: true,
    headerOffset: 60,         // Abstand oben beim Springen (Reddit-Header)
    customComments: true,     // eigene Kommentaransicht aus dem JSON
    autoMore: true,           // eigene Ansicht: restliche Antworten automatisch laden
    showAvatars: true,        // eigene Ansicht: Profilbild vor dem Namen
    followBrowserBar: true,   // Toolbar rutscht nach unten, wenn die Browser-Leiste verschwindet
    followShift: 35,          // Verschiebung in px
    swipeBack: true,          // nach rechts wischen = zurück
    gallerySwipe: true,       // in Bildergalerien per Wischen blättern
    hideBelowThread: true,    // weitere Beiträge und Werbung unter dem Thread ausblenden
    floatingComposer: true,   // eigene Ansicht: schwebendes Kommentarfeld unten
    commentGap: 14,           // eigene Ansicht: Abstand zwischen Kommentaren in px
    toolbarOpacity: 55,       // Deckkraft von Toolbar und Kommentarfeld in % (weniger = transparenter)
    toolbarBlur: 16,          // Unschärfe hinter Toolbar und Kommentarfeld in px
    trueBlack: true,          // dunkles Design mit reinem Schwarz (OLED)
    hideAppBanner: true,      // Banner „In der Reddit-App anzeigen“ ausblenden
  };

  const BAR_COLORS = ['#8b5cf6', '#4f46e5', '#3b82f6', '#38bdf8', '#2dd4bf', '#4ade80', '#facc15', '#fb923c'];

  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

  function loadSettings() {
    let stored = {};
    try {
      stored = hasGM
        ? GM_getValue('settings', {})
        : JSON.parse(localStorage.getItem('rmt-settings') || '{}');
    } catch (e) { /* ignorieren */ }
    stored = stored || {};
    if (stored.followShift === 60) stored.followShift = DEFAULTS.followShift; // alter Standardwert war zu weit
    if (stored.toolbarBlur === 28) stored.toolbarBlur = DEFAULTS.toolbarBlur;   // alter Standardwert
    return Object.assign({}, DEFAULTS, stored);
  }

  function saveSettings(s) {
    try {
      if (hasGM) GM_setValue('settings', s);
      else localStorage.setItem('rmt-settings', JSON.stringify(s));
    } catch (e) { /* ignorieren */ }
  }

  let S = loadSettings();

  /* ---------------------------------------------------------------
   * Seiten-CSS (wirkt direkt auf Reddits Elemente)
   * ------------------------------------------------------------- */
  let docStyle = null;
  let cv = null; // Zustand der eigenen Kommentaransicht

  function applyDocStyle() {
    if (!docStyle) {
      docStyle = document.createElement('style');
      docStyle.id = 'rmt-doc-style';
    }
    const parent = document.head || document.documentElement;
    if (parent && docStyle.parentNode !== parent) parent.appendChild(docStyle);

    let css = '';
    if (S.trueBlack) {
      // Reddits dunkle Hintergrundfarben auf reines Schwarz setzen (nur im dunklen Design)
      const vars = '--color-neutral-background:#000 !important;--color-neutral-background-container:#000 !important;' +
        '--shreddit-content-background:#000 !important;--color-neutral-background-weak:#0b0b0b !important;' +
        '--shreddit-color-background:#000 !important;--color-tone-8:#000 !important;';
      const els = 'html, body, shreddit-app, reddit-header-large, reddit-header-small, header, main, #main-content, ' +
        'shreddit-post, comment-body-header, shreddit-comment-tree, .main-container';
      const known = loadHeaderTags();
      const all = known.length ? `${els}, ${known.join(', ')}` : els;
      css += `html.theme-dark{${vars}} html.theme-dark :is(${all}){background-color:#000 !important;}`;
      css += `@media (prefers-color-scheme: dark){html:not(.theme-light){${vars}} html:not(.theme-light) :is(${all}){background-color:#000 !important;}}`;
    }
    if (S.gallerySwipe) {
      // Waagerechtes Wischen in Galerien gehört der Seite, nicht dem Browser
      css += '[class*="carousel" i], gallery-carousel, faceplate-carousel, shreddit-gallery-carousel{touch-action:pan-y pinch-zoom !important;}';
    }
    if (S.gallerySwipe || S.swipeBack) {
      // Verhindert, dass waagerechtes Überscrollen als Vor/Zurück-Navigation gewertet wird
      css += 'html, body{overscroll-behavior-x:none !important;}';
    }
    css += '[data-rmt-hide]{display:none !important;}';
    if (S.hideBelowThread) {
      // Werbung im Post- und Kommentarbereich
      css += 'shreddit-ad-post, shreddit-comments-page-ad, shreddit-comment-tree-ad, [slot="ad-slot"], ' +
        'shreddit-dynamic-ad-link, shreddit-sidebar-ad, faceplate-partial[src*="/ad"], [data-testid*="ad-" i], ' +
        'pdp-related-posts, shreddit-related-posts, related-community-posts, [id^="related-"], ' +
        '#comments-page-ad-container{display:none !important;}';
    }
    if (cv && !cv.original) {
      // Reddits eigenen Kommentarbaum ausblenden, solange die eigene Ansicht aktiv ist
      css += 'shreddit-comment-tree{display:none !important;}';
      css += '[data-rmt-hdr]{display:none !important;}';
    }
    docStyle.textContent = css;
  }

  applyDocStyle();

  /* ---------------------------------------------------------------
   * Automatische Sortierung
   * ------------------------------------------------------------- */
  const isCommentPage = () => /\/comments\//.test(location.pathname);

  function sortTarget() {
    const u = new URL(location.href);
    const path = u.pathname.replace(/\/+$/, '') || '/';

    // Kommentarseite: ?sort= ergänzen, wenn keine Sortierung gewählt ist
    if (/\/comments\//.test(path)) {
      if (S.commentSort !== 'off' && !u.searchParams.has('sort')) {
        u.searchParams.set('sort', S.commentSort);
        return u.toString();
      }
      return null;
    }

    if (S.feedSort === 'off') return null;

    let target = null;
    if (path === '/' && S.applyFeedSortHome) {
      target = '/' + S.feedSort + '/';
    } else {
      const m = path.match(/^\/r\/([^/]+)$/);
      if (m && S.applyFeedSortSubs) target = '/r/' + m[1] + '/' + S.feedSort + '/';
    }
    if (!target) return null;

    const nu = new URL(target, location.origin);
    u.searchParams.forEach((v, k) => nu.searchParams.set(k, v));
    if (S.feedSort === 'top' && !nu.searchParams.has('t')) nu.searchParams.set('t', S.feedTopTime);
    return nu.toString();
  }

  function applySortRedirect() {
    const t = sortTarget();
    if (t && t !== location.href) {
      location.replace(t);
      return true;
    }
    return false;
  }

  if (applySortRedirect()) return;

  /* ---------------------------------------------------------------
   * URL-Wechsel erkennen (Reddit ist eine Single-Page-App)
   * ------------------------------------------------------------- */
  let lastUrl = location.href;

  function onUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (applySortRedirect()) return;
    renderBar();
    if (typeof headerFoundOnce !== 'undefined') headerFoundOnce = false; // neue Seite: Kopfleiste erneut schnell suchen
    scheduleCommentWork();
  }

  ['pushState', 'replaceState'].forEach((fn) => {
    try {
      const orig = history[fn];
      history[fn] = function () {
        const r = orig.apply(this, arguments);
        setTimeout(onUrlChange, 0);
        return r;
      };
    } catch (e) { /* Fallback: Intervall unten */ }
  });
  window.addEventListener('popstate', () => {
    if (typeof logNav === 'function') logNav('popstate → ' + location.pathname.slice(0, 50));
    setTimeout(onUrlChange, 0);
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted && typeof logNav === 'function') logNav('pageshow (aus Cache) → ' + location.pathname.slice(0, 50)); });

  /* ---------------------------------------------------------------
   * Oberfläche
   * ------------------------------------------------------------- */
  const CSS = `
    :host { all: initial; }
    :host {
      --bg: rgba(255,255,255,.92); --barbg: rgba(255,255,255,var(--alpha, .55)); --fg: #1a1a1b; --muted: #6b6b70;
      --active: rgba(0,0,0,.08); --sep: rgba(0,0,0,.15);
      --panel: #ffffff; --input: #f2f2f4; --accent: #ff4500;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg: rgba(30,30,32,.92); --barbg: rgba(28,28,30,var(--alpha, .55)); --fg: #e8e8ea; --muted: #9a9aa0;
        --active: rgba(255,255,255,.12); --sep: rgba(255,255,255,.2);
        --panel: #1c1c1e; --input: #2c2c2e;
      }
    }
    * { box-sizing: border-box; font-family: -apple-system, system-ui, sans-serif; }

    .bar {
      position: fixed; bottom: calc(14px + env(safe-area-inset-bottom));
      z-index: 2147483646; display: flex; align-items: center; gap: 2px;
      padding: 4px; border-radius: 999px; background: var(--barbg); color: var(--fg);
      -webkit-backdrop-filter: blur(var(--blur, 28px)) saturate(170%); backdrop-filter: blur(var(--blur, 28px)) saturate(170%);
      box-shadow: 0 4px 18px rgba(0,0,0,.28);
      transition: transform .25s ease, opacity .25s ease, translate .25s ease;
    }
    .bar.low, .composer.low { translate: 0 var(--shift, 60px); }
    .bar.raised { bottom: calc(72px + env(safe-area-inset-bottom)); }
    .sheet { padding-top: 14px; }
    .shead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .shead h2 { margin: 0; font-size: 20px; }
    .sclose { width: 36px; height: 36px; border-radius: 50%; border: 0; background: var(--input); color: var(--fg); font-size: 16px; cursor: pointer; }
    .srow { display: flex; align-items: center; gap: 16px; width: 100%; padding: 13px 4px; border: 0; background: none; color: var(--fg); font-size: 17px; text-align: left; cursor: pointer; font-family: inherit; }
    .srow svg { width: 24px; height: 24px; flex: none; }
    .srow span { flex: 1; }
    .bar.typing, .bar.covered, .composer.covered { opacity: 0; pointer-events: none; }
    .composer {
      position: fixed; left: 12px; right: 12px; bottom: calc(14px + env(safe-area-inset-bottom));
      z-index: 2147483645; transition: translate .25s ease;
    }
    .composer.hidden { display: none; }
    .composer .pill {
      width: 100%; height: 48px; border-radius: 999px; border: 1px solid var(--sep);
      background: var(--barbg); color: var(--muted); font-size: 16px; text-align: left; padding: 0 18px;
      -webkit-backdrop-filter: blur(var(--blur, 28px)) saturate(170%); backdrop-filter: blur(var(--blur, 28px)) saturate(170%); box-shadow: 0 4px 18px rgba(0,0,0,.28);
      display: flex; align-items: center; gap: 10px; cursor: pointer;
    }
    .composer .pill b { font-size: 22px; font-weight: 400; color: var(--fg); }
    .composer .rf {
      background: var(--panel); border: 1px solid var(--sep); border-radius: 20px; padding: 12px 12px 10px;
      box-shadow: 0 4px 18px rgba(0,0,0,.35); display: flex; flex-direction: column; gap: 8px;
    }
    .composer .rf textarea { font-size: 16px; min-height: 90px; max-height: 40vh; border: 0; outline: none; background: transparent; color: var(--fg); padding: 2px 4px; font-family: inherit; resize: none; width: 100%; }
    .composer .rf textarea::placeholder { color: var(--muted); }
    .composer .err { color: #ff5a5a; font-size: 13px; padding: 0 4px; }
    .composer .err:empty { display: none; }
    .composer .row { display: flex; gap: 8px; justify-content: flex-end; }
    .composer .row button { font-size: 15px; font-weight: 600; padding: 9px 16px; border-radius: 999px; border: 0; background: var(--input); color: var(--fg); cursor: pointer; }
    .composer .row button.send { background: #d93a00; color: #fff; }
    .composer .row button:disabled { opacity: .5; }
    .bar.right { right: 12px; }
    .bar.left { left: 12px; }
    .bar.center { left: 50%; transform: translateX(-50%); }
    .bar.hidden { opacity: 0; transform: translateY(90px); pointer-events: none; }
    .bar.center.hidden { transform: translate(-50%, 90px); }
    .bar button {
      width: 44px; height: 44px; border: 0; border-radius: 50%; padding: 0;
      background: transparent; color: var(--fg);
      display: flex; align-items: center; justify-content: center;
      -webkit-tap-highlight-color: transparent; cursor: pointer;
    }
    .bar button:active { background: var(--active); }
    .bar button.accent { color: var(--accent); }
    .bar svg { width: 22px; height: 22px; }
    .sep { width: 1px; height: 24px; background: var(--sep); margin: 0 2px; }

    .swipe {
      position: fixed; top: 50%; left: 0; width: 44px; height: 44px; margin-top: -22px;
      border-radius: 50%; background: var(--bg); color: var(--fg); z-index: 2147483647;
      display: flex; align-items: center; justify-content: center; pointer-events: none;
      box-shadow: 0 4px 14px rgba(0,0,0,.3); opacity: 0; transform: translateX(-50px);
    }
    .swipe svg { width: 22px; height: 22px; }
    .swipe.ready { background: var(--accent); color: #fff; }
    .toast {
      position: fixed; left: 50%; bottom: calc(80px + env(safe-area-inset-bottom));
      transform: translateX(-50%); z-index: 2147483647;
      background: var(--bg); color: var(--fg); padding: 8px 14px; border-radius: 10px;
      font-size: 14px; box-shadow: 0 4px 14px rgba(0,0,0,.25);
      opacity: 0; transition: opacity .2s; pointer-events: none; max-width: 90vw; text-align: center;
    }
    .toast.show { opacity: 1; }

    .modal {
      position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.5);
      display: flex; align-items: flex-end; justify-content: center;
    }
    .modal.hidden { display: none; }
    .panel {
      width: 100%; max-width: 520px; max-height: 88vh; overflow-y: auto;
      background: var(--panel); color: var(--fg);
      border-radius: 16px 16px 0 0; padding: 18px 18px calc(18px + env(safe-area-inset-bottom));
    }
    h2 { font-size: 19px; margin: 0 0 6px; }
    h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 18px 0 6px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 15px; margin: 8px 0; }
    label.chk { flex-direction: row; align-items: center; gap: 10px; }
    select, input[type=text], input[type=number] {
      font-size: 16px; /* verhindert Zoom auf iOS */
      padding: 10px; border-radius: 10px; border: 0; background: var(--input); color: var(--fg);
      width: 100%; -webkit-appearance: none; appearance: none;
    }
    input[type=checkbox] { width: 22px; height: 22px; accent-color: var(--accent); flex: none; }
    .hint { font-size: 12px; color: var(--muted); margin: -2px 0 4px; }
    .actions { display: flex; gap: 8px; margin-top: 20px; }
    .actions .spacer { flex: 1; }
    .txt {
      font-size: 16px; padding: 10px 14px; border-radius: 10px; border: 0;
      background: var(--input); color: var(--fg); cursor: pointer;
    }
    .txt.primary { background: var(--accent); color: #fff; }
  `;

  const svg = (paths) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

  const ICONS = {
    back: svg('<path d="M15 18l-6-6 6-6"/>'),
    home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
    up: svg('<path d="M17 11l-5-5-5 5"/><path d="M17 18l-5-5-5 5"/>'),
    down: svg('<path d="M6 9l6 6 6-6"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  };

  let host = null, root = null, bar = null, toastEl = null, modal = null;

  function applyBarLook() {
    if (!host) return;
    host.style.setProperty('--blur', (Number(S.toolbarBlur) || 0) + 'px');
    host.style.setProperty('--alpha', String(Math.min(100, Math.max(0, Number(S.toolbarOpacity))) / 100));
  }

  function buildUI() {
    if (!document.body) return;
    if (host) {
      if (!document.body.contains(host)) document.body.appendChild(host);
      return;
    }
    host = document.createElement('div');
    host.id = 'rmt-host';
    applyBarLook();
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="bar"></div><div class="composer hidden"></div><div class="swipe">${ICONS.back}</div><div class="toast"></div><div class="modal hidden"></div>`;
    bar = root.querySelector('.bar');
    toastEl = root.querySelector('.toast');
    modal = root.querySelector('.modal');
    modal.addEventListener('click', (e) => { if (e.target === modal) closeSettings(); });
    document.body.appendChild(host);
    renderBar();
  }

  function renderBar() {
    if (!bar) return;
    bar.className = 'bar ' + (['left', 'center', 'right'].includes(S.toolbarPos) ? S.toolbarPos : 'right') +
      (composerEl && !composerEl.classList.contains('hidden') ? ' raised' : '');
    bar.innerHTML = '';

    const add = (icon, title, fn, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = icon;
      if (cls) b.classList.add(cls);
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
      bar.appendChild(b);
    };
    const sep = () => { const d = document.createElement('div'); d.className = 'sep'; bar.appendChild(d); };

    add(ICONS.back, 'Zurück', goBack);
    add(ICONS.home, 'Home', goHome);

    if (S.showPrevButton || isCommentPage()) sep();
    if (S.showPrevButton) add(ICONS.up, 'Nach oben', scrollToTop);
    if (isCommentPage()) add(ICONS.down, 'Nächster Root-Kommentar', () => jump(1), 'accent');

    sep();
    add(ICONS.gear, 'Einstellungen', openSettings);
  }

  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  /* ---------------------------------------------------------------
   * Navigation
   * ------------------------------------------------------------- */
  function homeHref() {
    try { return new URL(S.homeUrl || '/', location.origin).toString(); }
    catch (e) { return location.origin + '/'; }
  }

  // Kleines Protokoll, um zu sehen, ob Navigationen vom Skript oder vom Browser kommen
  const navLog = [];
  function logNav(msg) {
    const t = new Date();
    navLog.unshift(`${t.toLocaleTimeString('de-DE')} ${msg}`);
    if (navLog.length > 15) navLog.pop();
  }

  function goBack(source) {
    logNav('Skript: zurück (' + (typeof source === 'string' ? source : 'Toolbar') + ')');
    if (history.length > 1) history.back();
    else location.href = homeHref();
  }

  function goHome() {
    location.href = homeHref();
  }

  function rootComments() {
    if (cv && !cv.original && cv.host.isConnected) {
      return Array.from(cv.list.querySelectorAll(':scope > .c')).filter((c) => c.getClientRects().length > 0);
    }
    let list = Array.from(document.querySelectorAll('shreddit-comment[depth="0"]'));
    if (!list.length) {
      // Fallback, falls Reddit das depth-Attribut ändert
      list = Array.from(document.querySelectorAll('shreddit-comment'))
        .filter((c) => !(c.parentElement && c.parentElement.closest('shreddit-comment')));
    }
    return list.filter((c) => c.getClientRects().length > 0);
  }

  function flash(el) {
    const old = { o: el.style.outline, oo: el.style.outlineOffset, br: el.style.borderRadius };
    el.style.outline = '2px solid #ff4500';
    el.style.outlineOffset = '2px';
    el.style.borderRadius = '8px';
    setTimeout(() => {
      el.style.outline = old.o;
      el.style.outlineOffset = old.oo;
      el.style.borderRadius = old.br;
    }, 900);
  }

  /* ---------------------------------------------------------------
   * Eigene Kommentaransicht (aus /….json)
   * ------------------------------------------------------------- */
  const CV_CSS = `
    :host {
      display: block; contain: content;
      --fg: #1a1a1b; --muted: #6b6b70; --link: #0a66d8;
      --line: rgba(0,0,0,.09); --code: #f2f2f4; --frame: rgba(0,0,0,.25); --btn: #e5ebee;
      font-family: -apple-system, system-ui, sans-serif; color: var(--fg);
    }
    @media (prefers-color-scheme: dark) {
      :host { --fg: #e3e5e8; --muted: #8b9095; --link: #5fa8ff; --line: rgba(255,255,255,.09); --code: #1f2326; --frame: rgba(255,255,255,.28); --btn: #2a3236; }
    }
    * { box-sizing: border-box; }
    .top { display: flex; align-items: center; gap: 4px; padding: 8px 8px 8px 12px; border-bottom: 1px solid var(--line); }
    .sortbtn { margin-right: 10px; display: flex; align-items: center; gap: 5px; font-size: 14px; font-weight: 600; color: var(--muted); background: transparent; border: 0; padding: 6px 4px; font-family: inherit; cursor: pointer; }
    .sortbtn svg { width: 17px; height: 17px; }
    .sortbtn .chev { width: 13px; height: 13px; }
    .ib { background: none; border: 0; color: var(--muted); padding: 6px; display: flex; cursor: pointer; }
    .ib svg { width: 20px; height: 20px; }
    .ib.on { color: var(--link); }
    .search { display: none; padding: 8px 12px; border-bottom: 1px solid var(--line); gap: 8px; align-items: center; }
    .search.on { display: flex; }
    .search input { flex: 1; font-size: 16px; border: 1px solid var(--line); border-radius: 999px; padding: 8px 14px; background: var(--code); color: var(--fg); outline: none; }
    .search .hits { font-size: 13px; color: var(--muted); white-space: nowrap; }
    .c.nomatch > .self { display: none; }
    .c.nomatch.ctx > .self { display: block; opacity: .45; }
    mark { background: rgba(255,200,0,.35); color: inherit; border-radius: 2px; }
    .title { font-weight: 600; font-size: 15px; }
    .spacer, .sp { flex: 1; }
    .lnk { background: none; border: 0; color: var(--link); font-size: 14px; padding: 4px; cursor: pointer; }
    .status { padding: 12px; color: var(--muted); font-size: 14px; }
    .status:empty { display: none; }
    .wrap.off .list, .wrap.off .status { display: none; }
    .list { padding: 2px 8px 120px 8px; }
    .c { margin-top: var(--gap, 8px); }
    .self { border-left: 3px solid var(--bar); padding: 2px 0 4px 10px; }
    .kids { margin-left: 10px; }
    .hdr { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); min-height: 24px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .au { color: var(--muted); font-weight: 500; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 45vw; }
    .av { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; background: var(--line); flex: none; }
    .av:not([src]) { visibility: visible; }
    .bdg { color: #fff; border-radius: 4px; padding: 0 4px; font-size: 11px; font-weight: 700; }
    .op { background: #0079d3; } .mod { background: #46a508; } .adm { background: #d93a00; }
    .sc { font-variant-numeric: tabular-nums; min-width: 22px; text-align: center; }
    .vt { background: none; border: 0; color: var(--muted); font-size: 17px; line-height: 1; padding: 4px 6px; margin: -4px 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .c.up > .self .vt.u, .c.up > .self .sc { color: #ff4500; }
    .c.dn > .self .vt.d, .c.dn > .self .sc { color: #7193ff; }
    .cc { font-size: 12px; color: var(--muted); }
    .body { font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
    .body p { margin: 4px 0; }
    .body a { color: var(--link); }
    .body blockquote { margin: 4px 0; padding-left: 8px; border-left: 2px solid var(--muted); color: var(--muted); }
    .body pre { overflow-x: auto; background: var(--code); padding: 8px; border-radius: 6px; }
    .body code { background: var(--code); border-radius: 4px; padding: 0 3px; font-size: 13px; }
    .body table { display: block; overflow-x: auto; border-collapse: collapse; }
    .body td, .body th { border: 1px solid var(--line); padding: 3px 6px; }
    .body ul, .body ol { padding-left: 20px; margin: 4px 0; }
    .body img, .body video { max-width: 100%; max-height: 60vh; border-radius: 8px; display: block; margin: 6px 0; }
    .md-spoiler-text { background: var(--muted); color: transparent; border-radius: 3px; cursor: pointer; }
    .md-spoiler-text.rv { background: none; color: inherit; }
    .c.col > .self .body, .c.col > .kids { display: none; }
    .c.col > .self { opacity: .7; }
    .more { margin: 4px 0; }
    .acts { display: none; gap: 18px; padding: 2px 0; }
    .c.sel > .self .acts { display: flex; }
    .c.sel > .self { background: var(--line); border-radius: 0 6px 6px 0; }
    .act { background: none; border: 0; color: var(--link); font-size: 14px; padding: 6px 0; cursor: pointer; }
    .rf { margin: 8px 0 10px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--frame); border-radius: 20px; padding: 12px 12px 10px; }
    .rf textarea { font-size: 16px; min-height: 80px; border: 0; outline: none; background: transparent; color: var(--fg); padding: 2px 4px; font-family: inherit; resize: none; width: 100%; }
    .rf textarea::placeholder { color: var(--muted); }
    .rf .err { color: #ff5a5a; font-size: 13px; padding: 0 4px; }
    .rf .err:empty { display: none; }
    .rf .row { display: flex; gap: 8px; justify-content: flex-end; }
    .rf button { font-size: 15px; font-weight: 600; padding: 9px 16px; border-radius: 999px; border: 0; background: var(--btn); color: var(--fg); cursor: pointer; }
    .rf button.send { background: #d93a00; color: #fff; }
    .rf button:disabled { opacity: .5; }
    .mbtn { background: none; border: 0; padding: 6px 0 6px 13px; color: var(--link); font-size: 14px; text-align: left; cursor: pointer; text-decoration: none; display: inline-block; }
  `;

  function cvSort() {
    const p = new URL(location.href).searchParams.get('sort');
    if (p) return p;
    return S.commentSort !== 'off' ? S.commentSort : 'confidence';
  }

  function cvJsonUrl() {
    const base = location.pathname.replace(/\/+$/, '');
    return `${base}.json?raw_json=1&limit=500&depth=10&sort=${encodeURIComponent(cvSort())}`;
  }

  const cvKey = () => location.pathname + '|' + cvSort();

  function fmtNum(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function fmtAge(utc) {
    const s = Math.max(0, Date.now() / 1000 - utc);
    if (s < 60) return 'jetzt';
    if (s < 3600) return Math.floor(s / 60) + ' Min';
    if (s < 86400) return Math.floor(s / 3600) + ' Std';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' T';
    if (s < 86400 * 365) return Math.floor(s / (86400 * 30)) + ' Mon';
    return Math.floor(s / (86400 * 365)) + ' J';
  }

  const IMG_RE = /^https:\/\/(i\.redd\.it|preview\.redd\.it|i\.imgur\.com)\/|\.(jpe?g|png|gif|webp)(\?|$)/i;

  // Ermittelt für einen Link das passende Medium (Bild oder Video)
  function mediaFor(href, meta) {
    let u;
    try { u = new URL(href, location.origin); } catch (e) { return null; }
    const host = u.hostname.replace(/^www\./, '');

    // Reddit-eigene Medien: Infos stehen in media_metadata
    if (meta && /(^|\.)redd\.it$/.test(host)) {
      const m = u.pathname.match(/([a-z0-9]+)\.[a-z0-9]+$/i);
      const item = m && meta[m[1]];
      if (item && item.s) {
        if (item.e === 'AnimatedImage') {
          if (item.s.mp4) return { type: 'video', src: item.s.mp4 };
          if (item.s.gif) return { type: 'img', src: item.s.gif };
        }
        if (item.s.u) return { type: 'img', src: item.s.u };
      }
    }

    // Giphy-Seiten und -Links
    if (host === 'giphy.com' || /\.giphy\.com$/.test(host)) {
      let id = null;
      let m = u.pathname.match(/^\/(?:gifs|embed|stickers)\/(?:[^/]*-)?([A-Za-z0-9]+)\/?$/);
      if (m) id = m[1];
      if (!id) { m = u.pathname.match(/\/media\/(?:v1\.[^/]+\/)?([A-Za-z0-9]+)\//); if (m) id = m[1]; }
      if (!id && host === 'i.giphy.com') { m = u.pathname.match(/^\/([A-Za-z0-9]+)\.(gif|webp|mp4)$/); if (m) id = m[1]; }
      if (id && meta && meta['giphy|' + id] && meta['giphy|' + id].s && meta['giphy|' + id].s.mp4) {
        return { type: 'video', src: meta['giphy|' + id].s.mp4 };
      }
      if (id) return { type: 'img', src: `https://media.giphy.com/media/${id}/giphy.gif` };
    }

    // Imgur .gifv/.mp4 als Video
    if (host === 'i.imgur.com' && /\.(gifv|mp4)$/i.test(u.pathname)) {
      return { type: 'video', src: href.replace(/\.gifv(\?|$)/i, '.mp4$1') };
    }

    if (/\.mp4(\?|$)/i.test(u.pathname) && /(^|\.)redd\.it$/.test(host)) return { type: 'video', src: href };
    if (IMG_RE.test(href)) return { type: 'img', src: href };
    return null;
  }

  function cleanHtml(html, meta) {
    const t = document.createElement('template');
    t.innerHTML = html;
    t.content.querySelectorAll('script, style, iframe, object, embed, form').forEach((n) => n.remove());
    t.content.querySelectorAll('*').forEach((n) => {
      for (const a of Array.from(n.attributes)) {
        if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
      }
    });
    // Bild-, GIF- und Video-Links direkt einbetten
    t.content.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      const media = mediaFor(href, meta);
      if (!media) return;
      let el;
      if (media.type === 'video') {
        el = document.createElement('video');
        el.src = media.src;
        el.setAttribute('autoplay', '');
        el.setAttribute('loop', '');
        el.setAttribute('muted', '');
        el.setAttribute('playsinline', '');
        el.setAttribute('preload', 'metadata');
      } else {
        el = document.createElement('img');
        el.loading = 'lazy';
        el.src = media.src;
        el.alt = '';
      }
      // Ist der Link nur die nackte URL, wird er durch das Medium ersetzt
      const text = (a.textContent || '').trim();
      if (!text || text === href || /^https?:\/\//.test(text) || /^<?(image|gif)>?$/i.test(text)) a.replaceWith(el);
      else a.insertAdjacentElement('afterend', el);
    });
    const div = document.createElement('div');
    div.appendChild(t.content);
    return div.innerHTML;
  }

  function permalinkFor(commentId) {
    const m = location.pathname.match(/^(\/r\/[^/]+\/comments\/[^/]+\/[^/]*)/);
    const base = m ? m[1] : location.pathname.replace(/\/+$/, '');
    return `${base}/${commentId}/`;
  }

  function renderThing(it, state) {
    if (!it || !it.data) return null;
    if (it.kind === 't1') return renderComment(it.data, state);
    if (it.kind === 'more') return renderMore(it.data, state);
    return null;
  }

  function renderComment(d, state) {
    const depth = d.depth || 0;
    const el = document.createElement('div');
    el.className = 'c' + (depth === 0 ? ' root' : '');
    el.dataset.name = d.name;
    const myVote = d.likes === true ? 1 : d.likes === false ? -1 : 0;
    el.dataset.vote = String(myVote);
    el.dataset.base = String((Number(d.score) || 0) - myVote);
    el.dataset.hidden = d.score_hidden ? '1' : '';
    if (myVote === 1) el.classList.add('up');
    if (myVote === -1) el.classList.add('dn');
    el.style.setProperty('--bar', BAR_COLORS[depth % BAR_COLORS.length]);

    const badges = [];
    if (d.author === state.postAuthor && d.author !== '[deleted]') badges.push('<span class="bdg op">OP</span>');
    if (d.distinguished === 'moderator') badges.push('<span class="bdg mod">MOD</span>');
    if (d.distinguished === 'admin') badges.push('<span class="bdg adm">ADMIN</span>');
    if (d.stickied) badges.push('<span>📌</span>');
    const author = d.author === '[deleted]'
      ? '<span class="au">[gelöscht]</span>'
      : `<a class="au" href="/user/${encodeURIComponent(d.author)}/">${esc(d.author)}</a>`;
    const score = d.score_hidden ? '•' : fmtNum(d.score);

    let avatar = '';
    if (S.showAvatars && d.author !== '[deleted]') {
      avatar = `<img class="av" alt="" data-author="${esc(d.author)}" data-uid="${esc(d.author_fullname || '')}">`;
      cvQueueAvatar(state, d.author, d.author_fullname);
    }
    el.innerHTML =
      `<div class="self"><div class="hdr">${avatar}${author}${badges.join('')}` +
      `<span>${fmtAge(d.created_utc)}${d.edited ? ' · bearb.' : ''}</span><span class="sp"></span>` +
      `<span class="cc"></span><button class="vt u" type="button" aria-label="Upvote">↑</button>` +
      `<span class="sc">${score}</span><button class="vt d" type="button" aria-label="Downvote">↓</button></div>` +
      `<div class="body">${cleanHtml(d.body_html || '', d.media_metadata)}</div>` +
      `<div class="acts"><button class="act" type="button" data-a="reply">Antworten</button>` +
      `<button class="act" type="button" data-a="link">Link kopieren</button></div></div><div class="kids"></div>`;

    el.dataset.depth = String(depth);
    el.dataset.author = d.author || '';
    el.dataset.permalink = d.permalink || '';
    state.nodes.set(d.name, el);
    const kids = el.querySelector('.kids');
    const rep = d.replies && d.replies.data && d.replies.data.children;
    if (rep) rep.forEach((ch) => { const k = renderThing(ch, state); if (k) kids.appendChild(k); });
    return el;
  }

  function renderMore(d, state) {
    const el = document.createElement('div');
    el.className = 'more';
    el.dataset.parent = d.parent_id || '';
    const n = d.count || (d.children ? d.children.length : 0);
    if (!d.children || !d.children.length || d.id === '_') {
      // „Thread fortsetzen“: Reddit liefert diese Antworten nur auf einer eigenen Seite
      el.classList.add('cont');
      const pid = (d.parent_id || '').replace(/^t1_/, '');
      el.innerHTML = `<a class="mbtn" href="${esc(permalinkFor(pid))}">Thread fortsetzen →</a>`;
    } else {
      el.dataset.children = d.children.join(',');
      el.innerHTML = `<button class="mbtn" type="button">+ ${n} weitere ${n === 1 ? 'Antwort' : 'Antworten'}</button>`;
      if (state && state.io) state.io.observe(el);
    }
    return el;
  }

  /* Profilbilder ----------------------------------------------------- */
  const avatarCache = new Map(); // Name → Bild-URL ('' = keins gefunden)

  function cvQueueAvatar(state, author, uid) {
    if (!state || avatarCache.has(author)) {
      if (state) cvScheduleAvatars(state);
      return;
    }
    state.avQueue = state.avQueue || new Map();
    state.avQueue.set(author, uid || '');
    cvScheduleAvatars(state);
  }

  function cvScheduleAvatars(state) {
    if (state.avTimer) return;
    state.avTimer = setTimeout(() => { state.avTimer = null; cvFillAvatars(state); }, 250);
  }

  function cvApplyAvatars(state) {
    state.root.querySelectorAll('img.av:not([src])').forEach((img) => {
      const url = avatarCache.get(img.dataset.author);
      if (url) img.src = url;
    });
  }

  async function cvFillAvatars(state) {
    if (cv !== state) return;
    const queue = state.avQueue || new Map();
    state.avQueue = new Map();

    // 1. Reddits eigene (ausgeblendete) Kommentare tragen das Profilbild als Attribut
    document.querySelectorAll('shreddit-comment[author][avatar]').forEach((c) => {
      const a = c.getAttribute('author');
      const url = c.getAttribute('avatar');
      if (a && url && !avatarCache.get(a)) avatarCache.set(a, url);
    });

    // 2. Rest gesammelt über Reddits Profil-Schnittstelle (bis 100 Konten pro Anfrage)
    const missing = [];
    queue.forEach((uid, author) => { if (!avatarCache.has(author) && uid) missing.push([author, uid]); });
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      try {
        const r = await fetch(`/api/user_data_by_account_ids.json?ids=${chunk.map((x) => x[1]).join(',')}`, { credentials: 'include' });
        const j = r.ok ? await r.json() : {};
        chunk.forEach(([author, uid]) => {
          const u = j && j[uid];
          const url = u && (u.profile_img || u.snoovatar_img);
          avatarCache.set(author, url ? String(url).replace(/&amp;/g, '&') : '');
        });
      } catch (e) {
        chunk.forEach(([author]) => avatarCache.set(author, ''));
      }
      if (cv !== state) return;
      cvApplyAvatars(state);
    }
    cvApplyAvatars(state);
  }

  async function cvLoadMore(el, state) {
    if (el.dataset.loading || !el.dataset.children) return;
    el.dataset.loading = '1';
    const btn = el.querySelector('button');
    if (btn) btn.textContent = 'Lade …';
    const ids = el.dataset.children.split(',');
    const batch = ids.slice(0, 100);
    const rest = ids.slice(100);
    try {
      const url = `/api/morechildren.json?api_type=json&raw_json=1&limit_children=false` +
        `&link_id=${encodeURIComponent(state.linkId)}&sort=${encodeURIComponent(cvSort())}&children=${batch.join(',')}`;
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (cv !== state) return;
      const things = (j && j.json && j.json.data && j.json.data.things) || [];
      things.forEach((th) => {
        const d = th.data || {};
        d.replies = '';
        const node = th.kind === 't1' ? renderComment(d, state) : th.kind === 'more' ? renderMore(d, state) : null;
        if (!node) return;
        const parent = state.nodes.get(d.parent_id);
        if (d.parent_id === el.dataset.parent || !parent) el.parentNode.insertBefore(node, el);
        else parent.querySelector(':scope > .kids').appendChild(node);
      });
      if (rest.length) {
        el.dataset.children = rest.join(',');
        delete el.dataset.loading;
        if (btn) btn.textContent = `+ ${rest.length} weitere Antworten`;
        if (state.io) { state.io.unobserve(el); state.io.observe(el); } // erneut prüfen
      } else {
        if (state.io) state.io.unobserve(el);
        el.remove();
      }
    } catch (e) {
      delete el.dataset.loading;
      if (btn) btn.textContent = 'Fehler beim Laden – erneut versuchen';
      throw e;
    }
  }

  async function cvAutoMore(state) {
    let n = 0;
    while (cv === state && S.autoMore && n < 15) {
      const el = state.list.querySelector('.more:not(.cont):not([data-loading])');
      if (!el) break;
      try { await cvLoadMore(el, state); } catch (e) { break; }
      n++;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  function cvToggleCollapse(c) {
    const col = c.classList.toggle('col');
    const cc = c.querySelector(':scope > .self .cc');
    if (cc) cc.textContent = col ? `+${c.querySelectorAll('.c').length}` : '';
  }

  function cvOnClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const vt = t.closest('.vt');
    if (vt) { e.preventDefault(); cvVote(vt.closest('.c'), vt.classList.contains('u') ? 1 : -1); return; }
    const more = t.closest('.more:not(.cont)');
    if (more) { e.preventDefault(); cvLoadMore(more, cv).catch(() => {}); return; }
    const sp = t.closest('.md-spoiler-text');
    if (sp && !sp.classList.contains('rv')) { e.preventDefault(); sp.classList.add('rv'); return; }
    const act = t.closest('[data-a]');
    if (act) { e.preventDefault(); cvAction(act); return; }
    if (t.closest('.rf')) return;
    if (t.closest('a')) return;
    const hdr = t.closest('.hdr');
    if (hdr) { cvToggleCollapse(hdr.closest('.c')); return; }
    // Antippen des Textes zeigt die Aktionen (Antworten, Link) an
    const body = t.closest('.body');
    if (body && !t.closest('img, video')) {
      const c = body.closest('.c');
      const was = c.classList.contains('sel');
      cv.list.querySelectorAll('.c.sel').forEach((x) => x.classList.remove('sel'));
      if (!was) c.classList.add('sel');
    }
  }

  /* Antworten -------------------------------------------------------- */
  function cvAction(btn) {
    const a = btn.dataset.a;
    if (a === 'reply') {
      const c = btn.closest('.c');
      cvOpenReply(c.querySelector(':scope > .self'), c.dataset.name, Number(c.dataset.depth) + 1, c.dataset.author);
    } else if (a === 'link') {
      const c = btn.closest('.c');
      const url = 'https://www.reddit.com' + (c.dataset.permalink || location.pathname);
      const ok = () => toast('Link kopiert');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, () => toast(url));
      else toast(url);
    } else if (a === 'cancel') {
      const f = btn.closest('.rf');
      if (!f.querySelector('textarea').value.trim() || confirm('Entwurf verwerfen?')) f.remove();
    } else if (a === 'send') {
      cvSend(btn.closest('.rf'));
    }
  }

  function cvOpenReply(container, parentName, depth, author) {
    if (!cv || !container) return;
    let f = container.querySelector(':scope > .rf');
    if (!f) {
      f = document.createElement('div');
      f.className = 'rf';
      f.dataset.parent = parentName;
      f.dataset.depth = String(depth);
      f.innerHTML =
        `<textarea placeholder="${esc(author && author !== '[deleted]' ? 'Antwort an u/' + author : 'Deine Antwort')}" autocapitalize="sentences"></textarea>` +
        `<div class="err"></div><div class="row"><button type="button" data-a="cancel">Abbrechen</button>` +
        `<button type="button" class="send" data-a="send" disabled>Kommentieren</button></div>`;
      container.appendChild(f);
      const t = f.querySelector('textarea');
      const send = f.querySelector('.send');
      t.addEventListener('input', () => {
        send.disabled = !t.value.trim();
        t.style.height = 'auto';
        t.style.height = Math.max(80, t.scrollHeight) + 'px'; // mitwachsen
      });
    }
    const ta = f.querySelector('textarea');
    ta.focus();
    f.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function cvSend(f) {
    const ta = f.querySelector('textarea');
    const send = f.querySelector('.send');
    const err = f.querySelector('.err');
    const text = ta.value.trim();
    if (!text || send.disabled) return;
    send.disabled = true;
    send.textContent = 'Sende …';
    err.textContent = '';
    try {
      const uh = await getModhash();
      const body = new URLSearchParams({ thing_id: f.dataset.parent, text, uh, api_type: 'json', raw_json: '1' });
      const r = await fetch('/api/comment', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Modhash': uh },
        body: body.toString(),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const errs = j && j.json && j.json.errors;
      if (errs && errs.length) throw new Error(errs.map((x) => x[1] || x[0]).join(', '));
      const thing = j && j.json && j.json.data && j.json.data.things && j.json.data.things[0];
      if (!thing || !thing.data) throw new Error('unerwartete Antwort');
      const d = thing.data;
      d.depth = Number(f.dataset.depth) || 0;
      d.replies = '';
      if (d.likes === undefined || d.likes === null) d.likes = true;
      if (d.score === undefined || d.score === null) d.score = 1;
      if (!d.body_html) d.body_html = `<p>${esc(text)}</p>`;
      if (!d.created_utc) d.created_utc = Date.now() / 1000;
      if (!d.author) d.author = 'du';
      const node = renderComment(d, cv);
      const parent = cv.nodes.get(f.dataset.parent);
      if (f.dataset.floating) {
        cv.list.prepend(node);
        cv.status.textContent = '';
        composerClose(true);
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else if (parent) {
        parent.classList.remove('sel');
        parent.querySelector(':scope > .kids').prepend(node);
        f.remove();
      } else {
        f.replaceWith(node); // Top-Level-Kommentar
      }
      flash(node);
      toast('Antwort gesendet');
    } catch (e) {
      err.textContent = 'Fehler: ' + e.message;
      send.disabled = false;
      send.textContent = 'Kommentieren';
    }
  }

  function cvUpdateOrigUi(state) {
    state.wrap.classList.toggle('off', state.original);
  }


  function cvPlace(host) {
    const tree = document.querySelector('shreddit-comment-tree');
    if (tree && tree.parentNode) { tree.parentNode.insertBefore(host, tree); return true; }
    const post = document.querySelector('shreddit-post');
    if (post) { post.insertAdjacentElement('afterend', host); return true; }
    return false;
  }

  async function cvLoad(state) {
    try {
      const r = await fetch(cvJsonUrl(), { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (cv !== state) return;
      const post = j[0].data.children[0].data;
      state.linkId = post.name;
      state.postAuthor = post.author;
      const items = j[1].data.children || [];
      const frag = document.createDocumentFragment();
      items.forEach((it) => { const el = renderThing(it, state); if (el) frag.appendChild(el); });
      state.list.innerHTML = '';
      state.list.appendChild(frag);
      state.status.textContent = items.length ? '' : 'Noch keine Kommentare';
      composerUpdate();
      if (S.autoMore) cvAutoMore(state);
    } catch (e) {
      if (cv !== state) return;
      state.status.textContent = `Kommentare konnten nicht geladen werden (${e.message}).`;
      state.original = true;
      cvUpdateOrigUi(state);
      state.wrap.classList.remove('off'); // Fehlermeldung sichtbar lassen
      state.list.style.display = 'none';
      applyDocStyle();
    }
  }

  function cvMount() {
    const host = document.createElement('div');
    host.id = 'rmt-cv';
    host.style.setProperty('--gap', (Number(S.commentGap) || 0) + 'px');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      `<style>${CV_CSS}</style><div class="wrap"><div class="top"><span class="title">Kommentare</span>` +
      `<span class="spacer"></span><button class="sortbtn" type="button" aria-label="Sortierung">${sortLabelHtml(cvSort())}</button>` +
      `<button class="ib" type="button" data-act="search" aria-label="Kommentare durchsuchen">${CV_SEARCH_ICON}</button></div>` +
      `<div class="search"><input type="search" placeholder="Kommentare durchsuchen" autocapitalize="off" autocorrect="off"><span class="hits"></span></div>` +
      `<div class="status">Lade Kommentare …</div><div class="list"></div></div>`;
    if (!cvPlace(host)) return;
    cv = {
      host, root,
      wrap: root.querySelector('.wrap'),
      list: root.querySelector('.list'),
      status: root.querySelector('.status'),
      key: cvKey(), nodes: new Map(), linkId: '', postAuthor: '', original: false, io: null,
    };
    // „weitere Antworten“ automatisch laden, sobald sie in die Nähe des Sichtbereichs kommen
    if (typeof IntersectionObserver === 'function') {
      const state = cv;
      state.io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting && cv === state && S.autoMore && !state.original) cvLoadMore(en.target, state).catch(() => {});
        });
      }, { rootMargin: '1200px 0px' });
    }
    root.addEventListener('click', cvOnClick);
    root.querySelector('.sortbtn').addEventListener('click', openSortSheet);
    const sbtn = root.querySelector('[data-act=search]');
    const sbox = root.querySelector('.search');
    const sinput = sbox.querySelector('input');
    sbtn.addEventListener('click', () => {
      const on = !sbox.classList.contains('on');
      sbox.classList.toggle('on', on);
      sbtn.classList.toggle('on', on);
      if (on) sinput.focus();
      else { sinput.value = ''; cvFilter(''); }
    });
    let st = null;
    sinput.addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => cvFilter(sinput.value), 200); });
    applyDocStyle();
    cvLoad(cv);
    // Reddit baut Kommentarfeld und Sortierung erst nach und nach auf – in den ersten Sekunden oft nachsehen
    const state = cv;
    let n = 0;
    const t = setInterval(() => {
      if (cv !== state || state.hdrFound || ++n > 40) { clearInterval(t); return; }
      cvHideRedditHeader();
    }, 150);
  }

  function cvUnmount() {
    if (!cv) return;
    if (cv.io) cv.io.disconnect();
    cv.host.remove();
    cv = null;
    applyDocStyle();
    composerUpdate();
  }

  function ensureCustomView() {
    if (!S.customComments || !isCommentPage()) { cvUnmount(); return; }
    if (cv && cv.key !== cvKey()) cvUnmount();
    if (cv) {
      const tree = document.querySelector('shreddit-comment-tree');
      // Immer direkt vor Reddits Kommentarbaum, sobald der existiert (sonst landet die Ansicht mal oben, mal unten)
      if (!cv.host.isConnected || (tree && cv.host.nextElementSibling !== tree)) cvPlace(cv.host);
      cvHideRedditHeader();
      return;
    }
    cvMount();
    if (cv) cvHideRedditHeader();
  }

  // Reddits Block mit Kommentarfeld, Sortierung und Suche ausblenden – die eigene Ansicht bringt das selbst mit
  function cvHideRedditHeader() {
    if (!cv || cv.original) return;
    const now = Date.now();
    // nicht bei jeder DOM-Änderung die ganze Seite durchsuchen; nach Erfolg nur noch selten nachsehen
    const wait = cv.hdrFound ? 8000 : 150; // bis gefunden schnell nachsehen (Bereich ist klein)
    if (cv.hdrAt && now - cv.hdrAt < wait) return;
    cv.hdrAt = now;
    // Bereich bestimmen: kleinster Vorfahr der eigenen Ansicht, der auch den Post enthält.
    // (Nach Navigation aus dem Feed liegen oft noch alte Feed-Posts im Dokument –
    //  document.querySelector('shreddit-post') würde dann den falschen Post finden.)
    let scope = cv.host.parentElement;
    while (scope && scope !== document.body && !scope.querySelector('shreddit-post')) scope = scope.parentElement;
    if (!scope) scope = document.body;
    let marks = 0;
    const BIG = 'shreddit-comment-tree, shreddit-comment, #rmt-cv, shreddit-post, main';
    const mark = (el) => {
      if (!el || el === scope || el.closest('#rmt-cv, #rmt-host, shreddit-post, shreddit-comment')) return;
      if (el.matches(BIG) || el.querySelector(BIG)) return; // nie einen Bereich mit Post oder Kommentaren ausblenden
      // bis zum äußersten Wrapper hochgehen, der nur dieses Element enthält
      while (el.parentElement && el.parentElement !== scope && el.parentElement.children.length === 1 &&
             !el.parentElement.matches(BIG)) el = el.parentElement;
      if (!el.hasAttribute('data-rmt-hdr')) el.setAttribute('data-rmt-hdr', '');
      marks++;
      if (marks >= 2) cv.hdrFound = true; // Kommentarfeld und Sortierung gefunden
    };
    scope.querySelectorAll('[class*="composer" i], comment-composer-host, shreddit-composer, faceplate-textarea-input, ' +
      'shreddit-sort-dropdown, shreddit-comments-sort-dropdown, [slot="sort-dropdown"], faceplate-search-input, ' +
      'shreddit-async-loader[bundlename*="comment_composer"], shreddit-async-loader[bundlename*="sort"]').forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag.includes('composer') || tag.includes('sort') || tag.includes('search') || tag.includes('textarea') ||
          (el.getAttribute('bundlename') || '').length || el.getAttribute('slot')) mark(el);
    });
    // Fallback über den sichtbaren Text – Kommentarbäume und Post werden dabei übersprungen (Leistung)
    eachOutside(scope, (el) => {
      if (!/^(SPAN|LABEL|DIV|BUTTON|INPUT|TEXTAREA)$/.test(el.tagName) || el.children.length > 2) return;
      const txt = (el.getAttribute('placeholder') || el.textContent || '').trim();
      if (/^(Beteilige dich an der Unterhaltung|Join the conversation|Sortieren nach:?|Sort by:?|Kommentare durchsuchen|Search Comments)$/i.test(txt)) {
        const row = el.closest('div, faceplate-tracker, shreddit-async-loader') || el;
        mark(row);
      }
    });
  }

  /* Sortierung und Suche in der eigenen Ansicht ------------------------ */
  const sIcon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const CV_SORTS = [
    ['confidence', 'Beste', sIcon('<path d="M12 2.5c3.2 2.3 4.8 6 4.2 10.5L14.5 16h-5l-1.7-3C7.2 8.5 8.8 4.8 12 2.5z"/><circle cx="12" cy="9" r="1.6"/><path d="M8 12.5l-3 2.5.8 3.5 3.2-1.5M16 12.5l3 2.5-.8 3.5-3.2-1.5M10.5 19l1.5 2.5 1.5-2.5"/>')],
    ['new', 'Neu', sIcon('<path d="M20 11.5A8 8 0 1 0 12 20"/><path d="M12 7.5V12l2.5 1.5"/><path d="M18 21v-6.5M15.5 16.5l2.5-2.5 2.5 2.5"/>')],
    ['top', 'Top', sIcon('<path d="M12 3l5 5h-3v5h-4V8H7z"/><path d="M3.5 21v-5h5v5M8.5 21v-3h7v3M15.5 21v-4h5v4M3 21h18"/>')],
    ['qa', 'Fragerunde', sIcon('<circle cx="16" cy="8" r="4.5"/><path d="M12.8 11.2L5 19l-.5 1.5L6 20l7.8-7.8"/><path d="M13.5 5.5l5 5"/>')],
    ['controversial', 'Kontrovers', sIcon('<path d="M8 3v13M4 12l4 4 4-4"/><path d="M16 21V8M12 12l4-4 4 4"/>')],
    ['old', 'Alt', sIcon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>')],
  ];
  const CHEV_ICON = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function sortLabelHtml(sort) {
    const e = CV_SORTS.find((x) => x[0] === sort) || CV_SORTS[0];
    return `${e[2]}<span>${e[1]}</span>${CHEV_ICON}`;
  }

  function openSortSheet() {
    buildUI();
    if (!modal) return;
    const cur = cvSort();
    modal.innerHTML =
      `<div class="panel sheet"><div class="shead"><h2>Kommentare sortieren nach</h2>` +
      `<button type="button" class="sclose" aria-label="Schließen">✕</button></div>` +
      CV_SORTS.map(([v, l, ic]) =>
        `<button type="button" class="srow" data-sort="${v}">${ic}<span>${l}</span>${v === cur ? CHECK_ICON : ''}</button>`).join('') +
      `</div>`;
    modal.querySelector('.sclose').addEventListener('click', closeSettings);
    modal.querySelectorAll('.srow').forEach((b) => b.addEventListener('click', () => {
      closeSettings();
      if (b.dataset.sort !== cur) cvChangeSort(b.dataset.sort);
    }));
    modal.classList.remove('hidden');
  }
  const CV_SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';

  function cvChangeSort(sort) {
    const u = new URL(location.href);
    u.searchParams.set('sort', sort);
    history.replaceState(history.state, '', u.toString());
    lastUrl = location.href;
    cvUnmount();
    ensureCustomView();
  }

  function cvFilter(q) {
    if (!cv) return;
    q = (q || '').trim().toLowerCase();
    const all = Array.from(cv.list.querySelectorAll('.c'));
    // alte Markierungen entfernen
    cv.list.querySelectorAll('mark').forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
    cv.list.querySelectorAll('.body').forEach((b) => b.normalize());
    const hits = cv.root.querySelector('.hits');
    if (!q) {
      all.forEach((c) => c.classList.remove('nomatch', 'ctx'));
      hits.textContent = '';
      return;
    }
    let n = 0;
    all.forEach((c) => {
      const body = c.querySelector(':scope > .self .body');
      const au = (c.dataset.author || '').toLowerCase();
      const hit = (body && body.textContent.toLowerCase().includes(q)) || au.includes(q);
      c.classList.toggle('nomatch', !hit);
      c.classList.remove('ctx');
      if (hit) {
        n++;
        if (body) cvMark(body, q);
      }
    });
    // Eltern von Treffern als Kontext abgeschwächt anzeigen
    all.forEach((c) => {
      if (!c.classList.contains('nomatch')) {
        let p = c.parentElement && c.parentElement.closest('.c');
        while (p) { if (p.classList.contains('nomatch')) p.classList.add('ctx'); p = p.parentElement && p.parentElement.closest('.c'); }
      }
    });
    hits.textContent = n === 1 ? '1 Treffer' : `${n} Treffer`;
  }

  function cvMark(el, q) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((t) => {
      const i = t.data.toLowerCase().indexOf(q);
      if (i < 0) return;
      const r = document.createRange();
      r.setStart(t, i);
      r.setEnd(t, i + q.length);
      const m = document.createElement('mark');
      r.surroundContents(m);
    });
  }

  /* Toolbar beim Schreiben ausblenden ----------------------------------- */
  function updateTyping() {
    if (!bar) return;
    const active = (r) => r && r.activeElement && /^(TEXTAREA|INPUT)$/.test(r.activeElement.tagName) && r.activeElement.type !== 'checkbox';
    const docActive = document.activeElement && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName) && !document.activeElement.closest('#rmt-host, #rmt-cv');
    const typing = !!((composerEl && composerEl.querySelector('.rf')) || active(cv && cv.root) || docActive ||
      (root && active(root) && !(modal && !modal.classList.contains('hidden'))));
    bar.classList.toggle('typing', typing);
  }
  document.addEventListener('focusin', () => setTimeout(updateTyping, 0), true);
  document.addEventListener('focusout', () => setTimeout(updateTyping, 50), true);

  /* Schwebendes Kommentarfeld ----------------------------------------- */
  let composerEl = null;

  function composerUpdate() {
    if (!root) return;
    composerEl = composerEl || root.querySelector('.composer');
    if (!composerEl) return;
    const show = !!(S.floatingComposer && cv && !cv.original && cv.linkId && isCommentPage());
    if (!show && composerEl.querySelector('.rf textarea') && composerEl.querySelector('.rf textarea').value.trim()) return; // Entwurf nicht verwerfen
    composerEl.classList.toggle('hidden', !show);
    if (bar) bar.classList.toggle('raised', show);
    if (show && !composerEl.firstChild) composerClose(true);
  }

  function composerClose(clear) {
    if (!composerEl) return;
    composerEl.innerHTML = '<button class="pill" type="button"><b>+</b><span>Beteilige dich an der Unterhaltung</span></button>';
    composerEl.querySelector('.pill').addEventListener('click', composerOpen);
    updateTyping();
  }

  function composerOpen() {
    if (!composerEl || !cv) return;
    composerEl.innerHTML =
      `<div class="rf" data-floating="1" data-parent="${esc(cv.linkId)}" data-depth="0">` +
      `<textarea placeholder="Beteilige dich an der Unterhaltung" autocapitalize="sentences"></textarea>` +
      `<div class="err"></div><div class="row"><button type="button" data-a="cancel">Abbrechen</button>` +
      `<button type="button" class="send" data-a="send" disabled>Kommentieren</button></div></div>`;
    const f = composerEl.querySelector('.rf');
    const t = f.querySelector('textarea');
    const send = f.querySelector('.send');
    t.addEventListener('input', () => {
      send.disabled = !t.value.trim();
      t.style.height = 'auto';
      t.style.height = Math.max(90, t.scrollHeight) + 'px';
    });
    f.querySelector('[data-a=cancel]').addEventListener('click', () => {
      if (!t.value.trim() || confirm('Entwurf verwerfen?')) composerClose(true);
    });
    send.addEventListener('click', () => cvSend(f));
    t.focus();
    updateTyping();
  }

  // Läuft über alle Elemente unterhalb von root, überspringt aber große Bereiche
  // (Reddits Kommentarbaum, Post, eigene Oberfläche), damit es schnell bleibt.
  function eachOutside(rootEl, fn) {
    const SKIP = /^(SHREDDIT-COMMENT-TREE|SHREDDIT-COMMENT|SHREDDIT-POST|SCRIPT|STYLE|SVG|TEMPLATE)$/;
    const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (SKIP.test(n.tagName) || n.id === 'rmt-cv' || n.id === 'rmt-host') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let n = 0;
    while (w.nextNode() && n++ < 6000) fn(w.currentNode);
  }

  /* ---------------------------------------------------------------
   * Banner „In der Reddit-App anzeigen“ ausblenden
   * ------------------------------------------------------------- */
  const APP_BANNER_RE = /^(In der Reddit-App (anzeigen|öffnen)|Open in (the )?Reddit app|View in (the )?Reddit app|Reddit-App öffnen|App öffnen|Open app)$/i;
  let bannerAt = 0;

  function hideAppBanner() {
    if (!S.hideAppBanner || !document.body) return;
    const now = Date.now();
    if (now - bannerAt < 1500) return;
    bannerAt = now;
    eachOutside(document.body, (el) => {
      if (el.hasAttribute('data-rmt-hide')) return;
      const tag = el.tagName.toLowerCase();
      let hit = /xpromo|app-banner|open-in-app|app-selector|bottom-sheet-app/.test(tag);
      if (!hit && el.children.length <= 2) {
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt.length < 40 && APP_BANNER_RE.test(txt)) {
          if (/^(App öffnen|Open app)$/i.test(txt)) {
            // „App öffnen“-Knopf (z. B. in der Kopfleiste): nur den Knopf selbst ausblenden
            el = el.closest('a, button') || el;
            hit = true;
          } else {
            // Banner-Text: zur festen Ebene am unteren Rand hochgehen – nie die Kopfleiste
            let p = el;
            for (let i = 0; p && p !== document.body && i < 12; i++, p = p.parentElement) {
              const pos = getComputedStyle(p).position;
              if (pos === 'fixed' || pos === 'sticky') {
                const r = p.getBoundingClientRect();
                if (r.top > window.innerHeight * 0.4 && r.height < window.innerHeight * 0.5) { el = p; hit = true; }
                break;
              }
            }
          }
        }
      }
      if (hit && !el.querySelector('shreddit-post, shreddit-comment-tree, main')) el.setAttribute('data-rmt-hide', '');
    });
  }

  /* ---------------------------------------------------------------
   * Kopfleiste schwarz färben (OLED)
   * ------------------------------------------------------------- */
  // Reddits Kopfleiste wird über ihre Position gefunden (feste Leiste ganz oben).
  // Alle Flächen darin, die dieselbe Hintergrundfarbe wie die Leiste haben, werden schwarz;
  // Suchfeld und Knöpfe mit eigener Farbe bleiben unverändert.
  let headerAt = 0;
  let headerFoundOnce = false;

  function isDarkColor(c) {
    const m = c && c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
    if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return false;
    return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 < 0.25;
  }

  function isBlack(c) { return /^rgba?\(0,\s*0,\s*0(,\s*1)?\)$/.test(c || ''); }

  function findHeader() {
    if (typeof document.elementFromPoint !== 'function' || !host) return null;
    const prev = host.style.pointerEvents;
    host.style.pointerEvents = 'none';
    let found = null;
    try {
      for (const y of [8, 30]) {
        let el = document.elementFromPoint(window.innerWidth / 2, y);
        let fixed = null, wideDark = null;
        for (let i = 0; el && el !== document.body && i < 30; i++) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (cs.position === 'fixed' || cs.position === 'sticky') fixed = el; // äußerste feste Ebene
          // Fallback für Seiten, auf denen die Kopfleiste nicht fest ist (z. B. Startseite):
          // äußerster breiter, dunkler Bereich ganz oben
          if (r.top <= 1 && r.width >= window.innerWidth * 0.95 && r.height < window.innerHeight * 0.4 &&
              (isDarkColor(cs.backgroundColor) || el.hasAttribute('data-rmt-black'))) wideDark = el;
          el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
        }
        if (fixed && fixed.getBoundingClientRect().top <= 1) { found = fixed; break; }
        if (wideDark) { found = wideDark; break; }
      }
    } finally {
      host.style.pointerEvents = prev;
    }
    return found;
  }

  // Erkannte Kopfleisten-Elemente merken, damit sie beim nächsten Laden sofort per CSS schwarz sind
  function rememberHeaderTag(tag) {
    if (!tag || !tag.includes('-')) return;
    const list = loadHeaderTags();
    if (list.includes(tag)) return;
    list.push(tag);
    try {
      if (hasGM) GM_setValue('hdrTags', list.slice(-5));
      else localStorage.setItem('rmt-hdr-tags', JSON.stringify(list.slice(-5)));
    } catch (e) { /* ignorieren */ }
    applyDocStyle();
  }

  function loadHeaderTags() {
    try {
      const v = hasGM ? GM_getValue('hdrTags', []) : JSON.parse(localStorage.getItem('rmt-hdr-tags') || '[]');
      return Array.isArray(v) ? v.filter((t) => /^[a-z][a-z0-9-]*$/.test(t)) : [];
    } catch (e) { return []; }
  }

  function blackenHeader() {
    if (!S.trueBlack || !document.body) return;
    const now = Date.now();
    // bis die Leiste gefunden ist schnell nachsehen, danach nur noch alle 2 s (Reddit baut Teile neu auf)
    if (now - headerAt < (headerFoundOnce ? 2000 : 150)) return;
    headerAt = now;
    const hdr = findHeader();
    if (!hdr) return;
    if (hdr.getBoundingClientRect().height > window.innerHeight * 0.4) return; // kein Menü o. ä.
    const base = getComputedStyle(hdr).backgroundColor;
    const candidates = [hdr, ...hdr.querySelectorAll('*')];
    // auch in offenen Shadow-Roots der Kopfleiste nachsehen
    hdr.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) candidates.push(...el.shadowRoot.querySelectorAll('*')); });
    if (hdr.shadowRoot) candidates.push(...hdr.shadowRoot.querySelectorAll('*'));
    let n = 0;
    candidates.forEach((el) => {
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      if (isBlack(bg) || !isDarkColor(bg)) return;
      // gleiche Farbe wie die Leiste, oder ein breiter, eckiger Container in dunklem Grau
      // (das abgerundete Suchfeld bleibt grau)
      const r = el.getBoundingClientRect();
      const wideBox = r.width >= window.innerWidth * 0.95 && (parseFloat(cs.borderTopLeftRadius) || 0) < 8;
      if (bg === base || wideBox) {
        el.style.setProperty('background-color', '#000', 'important');
        n++;
      }
    });
    hdr.setAttribute('data-rmt-black', '');
    headerFoundOnce = true;
    rememberHeaderTag(hdr.tagName.toLowerCase());
  }


  /* ---------------------------------------------------------------
   * Leere Hüllen ausgeblendeter Werbung im Feed entfernen
   * ------------------------------------------------------------- */
  // Reddit packt Anzeigen in eigene Container mit Hintergrund und Mindesthöhe.
  // Wird nur die Anzeige ausgeblendet, bleibt eine graue Lücke zwischen den Posts.
  const AD_SEL = 'shreddit-ad-post, shreddit-dynamic-ad-link, [slot="ad-slot"], faceplate-partial[src*="/ad"]';
  let adAt = 0;

  function collapseAdGaps() {
    if (!S.hideBelowThread || !document.body) return;
    const now = Date.now();
    if (now - adAt < 800) return;
    adAt = now;
    document.querySelectorAll(AD_SEL).forEach((ad) => {
      let el = ad;
      // hochgehen, solange der Container sonst nichts Sichtbares enthält
      for (let i = 0; i < 6 && el.parentElement; i++) {
        const p = el.parentElement;
        if (/^(SHREDDIT-FEED|MAIN|BODY)$/.test(p.tagName) || p.id === 'main-content') break;
        const others = Array.from(p.children).filter((c) => c !== el && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE' &&
          !c.hasAttribute('data-rmt-hide') && c.getClientRects().length && (c.textContent || '').trim());
        if (others.length || p.querySelector('shreddit-post')) break;
        el = p;
      }
      if (el !== ad && !el.hasAttribute('data-rmt-hide')) el.setAttribute('data-rmt-hide', '');
    });
    // Leere Lücken direkt im Feed (Platzhalter ohne Inhalt zwischen Posts)
    document.querySelectorAll('shreddit-feed > *:not(shreddit-post):not(article):not([data-rmt-hide])').forEach((el) => {
      // Nachlade-Auslöser fürs endlose Scrollen nie anfassen
      if (/^FACEPLATE-PARTIAL$|LOADER|LOADING/i.test(el.tagName) && !/\/ad/.test(el.getAttribute('src') || '')) return;
      if (el.querySelector('shreddit-post, article, faceplate-partial, faceplate-loader, shreddit-loading')) return;
      const r = el.getBoundingClientRect();
      const bg = getComputedStyle(el).backgroundColor;
      const filled = bg && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg);
      // nur sichtbare, leere „Kästen“ (eigener Hintergrund, kein Text, keine Medien)
      if (filled && r.height > 30 && !(el.textContent || '').trim() && !el.querySelector('img, video')) el.setAttribute('data-rmt-hide', '');
    });
  }

  /* ---------------------------------------------------------------
   * Weitere Beiträge und Werbung unter dem Thread ausblenden
   * ------------------------------------------------------------- */
  // Alles, was im Seiteninhalt nach dem Kommentarbereich kommt und Beiträge
  // oder Werbung enthält, wird markiert und per CSS ausgeblendet.
  const BELOW_RE = /(shreddit-post|shreddit-ad-post|article|faceplate-tracker|shreddit-feed|related|ad-)/i;

  function hideBelowThread() {
    if (!S.hideBelowThread || !isCommentPage()) return;
    const anchor = document.querySelector('shreddit-comment-tree') || (cv && cv.host && cv.host.isConnected ? cv.host : null);
    if (!anchor) return;
    const stop = anchor.closest('main') || document.body;
    let el = anchor;
    while (el && el !== stop && el.parentElement) {
      let sib = el.nextElementSibling;
      while (sib) {
        if (!sib.hasAttribute('data-rmt-hide') && sib.id !== 'rmt-host' && sib.id !== 'rmt-cv' &&
            sib.tagName !== 'SCRIPT' && sib.tagName !== 'STYLE') {
          const tag = sib.tagName.toLowerCase();
          // Kommentarbereich selbst (inkl. Nachladen) nie anfassen
          const isComments = sib.matches('shreddit-comment-tree, #rmt-cv, [id*="comment"], faceplate-partial[src*="comment"]') ||
            sib.querySelector('shreddit-comment-tree, shreddit-comment, #rmt-cv');
          if (isComments) { sib = sib.nextElementSibling; continue; }
          if (BELOW_RE.test(tag) || sib.querySelector('shreddit-post, shreddit-ad-post, article, a[href*="/comments/"]')) {
            sib.setAttribute('data-rmt-hide', '');
          }
        }
        sib = sib.nextElementSibling;
      }
      el = el.parentElement;
    }
  }

  let commentTimer = null;
  function scheduleCommentWork() {
    if (commentTimer) return;
    commentTimer = setTimeout(() => {
      commentTimer = null;
      ensureCustomView();
      hideBelowThread();
      hideAppBanner();
      collapseAdGaps();
      blackenHeader();
      composerUpdate();
    }, 300);
  }


  /* ---------------------------------------------------------------
   * Abstimmen (über Reddits interne Schnittstelle mit deiner Sitzung)
   * ------------------------------------------------------------- */
  let modhash = null;

  async function getModhash() {
    if (modhash) return modhash;
    const r = await fetch('/api/me.json', { credentials: 'include' });
    const j = await r.json().catch(() => null);
    modhash = j && j.data && j.data.modhash;
    if (!modhash) throw new Error('nicht eingeloggt');
    return modhash;
  }

  function cvSetVote(c, v) {
    c.dataset.vote = String(v);
    c.classList.toggle('up', v === 1);
    c.classList.toggle('dn', v === -1);
    const sc = c.querySelector(':scope > .self .sc');
    if (sc && c.dataset.hidden !== '1') sc.textContent = fmtNum(Number(c.dataset.base) + v);
  }

  async function cvVote(c, dir) {
    if (!c || c.dataset.voting) return;
    const cur = Number(c.dataset.vote) || 0;
    const next = cur === dir ? 0 : dir;
    cvSetVote(c, next); // sofort anzeigen
    c.dataset.voting = '1';
    try {
      const uh = await getModhash();
      const body = new URLSearchParams({ id: c.dataset.name, dir: String(next), uh, rank: '2' });
      const r = await fetch('/api/vote', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Modhash': uh },
        body: body.toString(),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    } catch (e) {
      cvSetVote(c, cur); // zurücknehmen
      toast('Abstimmen fehlgeschlagen (' + e.message + ')');
    } finally {
      delete c.dataset.voting;
    }
  }

  /* ---------------------------------------------------------------
   * Konto-Test (Vorbereitung für Abstimmen/Antworten)
   * ------------------------------------------------------------- */
  async function accountTest() {
    const out = [];
    try {
      const r = await fetch('/api/me.json', { credentials: 'include' });
      out.push(`/api/me.json: HTTP ${r.status}`);
      const j = await r.json().catch(() => null);
      const d = j && j.data;
      if (d && d.name) {
        out.push(`Eingeloggt als: ${d.name}`);
        out.push(`Token (modhash): ${d.modhash ? 'vorhanden' : 'fehlt'}`);
      } else {
        out.push('Kein Login erkannt');
      }
    } catch (e) {
      out.push('me.json Fehler: ' + e.message);
    }
    if (isCommentPage()) {
      try {
        const r = await fetch(cvJsonUrl(), { credentials: 'include' });
        out.push(`Post-JSON: HTTP ${r.status}`);
      } catch (e) {
        out.push('Post-JSON Fehler: ' + e.message);
      }
    }
    showText(out.join('\n'), 'Konto-Test');
  }

  /* ---------------------------------------------------------------
   * Diagnose: Kommentar-Struktur kopieren
   * ------------------------------------------------------------- */
  function describeEl(el, depth, out) {
    if (depth > 4 || out.length > 80) return;
    if (el.id === 'comment-children' && depth > 0) {
      out.push(`${'  '.repeat(depth)}<div id="comment-children"> …`);
      return;
    }
    const attrs = Array.from(el.attributes || [])
      .filter((a) => a.name !== 'style')
      .map((a) => `${a.name}="${String(a.value).slice(0, 60)}"`).join(' ');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.push(`${'  '.repeat(depth)}<${el.tagName.toLowerCase()} ${attrs}> {${cs.display}; x=${Math.round(r.left)} w=${Math.round(r.width)} h=${Math.round(r.height)}}${el.shadowRoot ? ' [shadow]' : ''}`);
    Array.from(el.children).forEach((ch) => describeEl(ch, depth + 1, out));
  }

  function copyDiagnostics() {
    const c = document.querySelector('shreddit-comment');
    const out = [`URL: ${location.pathname}`, `UA: ${navigator.userAgent}`];

    // Kopfleiste
    const hd = findHeader();
    out.push('--- Kopfleiste ---');
    out.push(hd ? `<${hd.tagName.toLowerCase()} class="${(hd.className && hd.className.baseVal === undefined ? hd.className : '').toString().slice(0, 80)}"> bg=${getComputedStyle(hd).backgroundColor} schwarz=${hd.hasAttribute('data-rmt-black')}` : 'nicht gefunden (evtl. gerade ausgeblendet – oben auf der Seite erneut versuchen)');

    // Galerien
    const cars = Array.from(document.querySelectorAll('*')).filter((el) => /CAROUSEL/i.test(el.tagName));
    out.push(`--- Galerien: ${cars.length} ---`);
    cars.slice(0, 2).forEach((el) => {
      const btns = [el, el.shadowRoot].filter(Boolean)
        .flatMap((sc) => Array.from(sc.querySelectorAll('button, [role="button"]')))
        .map((x) => `[${x.getAttribute('aria-label') || ''}|${x.getAttribute('slot') || ''}]`);
      out.push(`<${el.tagName.toLowerCase()}> shadow=${!!el.shadowRoot} buttons=${btns.join(' ')} erkannt=${!!galButtons(el)}`);
    });

    if (!c) { out.push('(kein Kommentar auf dieser Seite)'); showText(out.join('\n')); return; }
    describeEl(c, 0, out);
    if (c.shadowRoot) {
      out.push('--- shadow ---');
      Array.from(c.shadowRoot.children).forEach((ch) => describeEl(ch, 1, out));
    }

    // „weitere Antworten“-Element und seine Vorfahren
    const MORE_RE = /\b\d+\s+(weitere\s+antwort|more\s+repl)/i;
    const leaf = Array.from(document.querySelectorAll('shreddit-comment *, shreddit-comment-tree *'))
      .find((el) => el.children.length === 0 && MORE_RE.test(el.textContent || ''));
    out.push('--- weitere Antworten ---');
    if (leaf) {
      let el = leaf;
      for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
        const attrs = Array.from(el.attributes || []).filter((a) => a.name !== 'style')
          .map((a) => `${a.name}="${String(a.value).slice(0, 80)}"`).join(' ');
        out.push(`${i}: <${el.tagName.toLowerCase()} ${attrs}>`);
      }
      const box = leaf.closest('faceplate-partial, button, a, [role="button"]') || leaf.parentElement;
      out.push('HTML: ' + (box ? box.outerHTML.replace(/\s+/g, ' ').slice(0, 900) : '-'));
    } else {
      out.push('nicht gefunden');
    }

    const text = out.join('\n');
    const done = () => toast('Struktur kopiert');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => showText(text));
    } else showText(text);
  }

  function showText(text, title) {
    if (!modal) return;
    modal.innerHTML = `<div class="panel"><h2>${esc(title || 'Struktur')}</h2><textarea style="width:100%;height:50vh;font-size:12px">${esc(text)}</textarea><div class="actions"><span class="spacer"></span><button type="button" class="txt" data-act="cancel">Schließen</button></div></div>`;
    modal.querySelector('[data-act=cancel]').addEventListener('click', closeSettings);
    modal.classList.remove('hidden');
  }

  let suppressHideUntil = 0;

  function scrollToTop() {
    suppressHideUntil = Date.now() + 1000;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function jump(dir) {
    const list = rootComments();
    if (!list.length) { toast('Keine Kommentare gefunden'); return; }

    const off = Number(S.headerOffset) || 0;
    const tops = list.map((c) => c.getBoundingClientRect().top);
    let idx = -1;

    if (dir > 0) {
      idx = tops.findIndex((t) => t > off + 4);
    } else {
      for (let i = tops.length - 1; i >= 0; i--) {
        if (tops[i] < off - 4) { idx = i; break; }
      }
    }

    if (idx < 0) {
      toast(dir > 0 ? 'Letzter geladener Root-Kommentar' : 'Erster Root-Kommentar');
      return;
    }

    suppressHideUntil = Date.now() + 1000;
    window.scrollTo({ top: window.scrollY + tops[idx] - off, behavior: 'smooth' });
    flash(list[idx]);
  }

  /* ---------------------------------------------------------------
   * Wisch-Geste: nach rechts wischen = zurück
   * ------------------------------------------------------------- */
  const SWIPE_TRIGGER = 90; // px horizontal bis zum Auslösen
  let sw = null;

  function swipeEl() { return root && root.querySelector('.swipe'); }

  function swipeBlocked(target) {
    // Nicht bei Eingaben, Medien und horizontal scrollbaren Bereichen (Galerien, Code, Tabellen)
    let el = target;
    for (let i = 0; el && i < 25; i++) {
      if (el.nodeType === 1) {
        const tag = el.tagName;
        if (/^(INPUT|TEXTAREA|SELECT|VIDEO)$/.test(tag) || el.isContentEditable) return true;
        if (/^(GALLERY-CAROUSEL|SHREDDIT-PLAYER|SHREDDIT-PLAYER-2|FACEPLATE-CAROUSEL)$/.test(tag)) return true;
        if (el.scrollWidth > el.clientWidth + 4) {
          const ox = getComputedStyle(el).overflowX;
          if (ox === 'auto' || ox === 'scroll') return true;
        }
      }
      el = el.parentNode || el.host;
    }
    return false;
  }

  document.addEventListener('touchstart', (e) => {
    sw = null;
    if (!S.swipeBack || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX < 20) return; // ganz am Rand: Orions eigene Geste nicht stören
    const target = (e.composedPath && e.composedPath()[0]) || e.target;
    if (host && host.contains(target)) return;
    if (swipeBlocked(target)) return;
    sw = { x: t.clientX, y: t.clientY, t: Date.now(), active: false, dx: 0 };
  }, { passive: true, capture: true });

  document.addEventListener('touchmove', (e) => {
    if (!sw) return;
    const t = e.touches[0];
    const dx = t.clientX - sw.x;
    const dy = t.clientY - sw.y;
    if (!sw.active) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; } // vertikales Scrollen
      if (dx > 14 && dx > Math.abs(dy) * 1.8) sw.active = true;
      else return;
    }
    sw.dx = dx;
    const el = swipeEl();
    if (el) {
      const p = Math.min(1, Math.max(0, dx / SWIPE_TRIGGER));
      el.style.transition = 'none';
      el.style.opacity = String(p);
      el.style.transform = `translateX(${-50 + p * 64}px)`;
      el.classList.toggle('ready', p >= 1);
    }
  }, { passive: true, capture: true });

  function swipeReset() {
    const el = swipeEl();
    if (el) {
      el.style.transition = 'opacity .2s, transform .2s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50px)';
      el.classList.remove('ready');
    }
  }

  document.addEventListener('touchend', () => {
    const s0 = sw;
    sw = null;
    if (!s0 || !s0.active) return;
    swipeReset();
    if (s0.dx >= SWIPE_TRIGGER) goBack('Wischgeste');
  }, { passive: true, capture: true });

  document.addEventListener('touchcancel', () => { sw = null; swipeReset(); }, { passive: true, capture: true });

  /* ---------------------------------------------------------------
   * Bildergalerien: Wischen nach links/rechts blättert
   * (Reddits eigene Geste reagiert in Orion nur in eine Richtung)
   * ------------------------------------------------------------- */
  const NEXT_RE = /(next|nächst|weiter|vorwärts|forward)/i;
  const PREV_RE = /(prev|vorherig|zurück|back)/i;
  let gal = null;

  function galButtons(el) {
    const scopes = [el];
    if (el.shadowRoot) scopes.push(el.shadowRoot);
    let next = null, prev = null;
    for (const sc of scopes) {
      for (const b of sc.querySelectorAll('button, [role="button"]')) {
        const label = (b.getAttribute('aria-label') || b.getAttribute('title') || '') + ' ' + (b.getAttribute('slot') || '');
        if (!next && NEXT_RE.test(label)) next = b;
        else if (!prev && PREV_RE.test(label)) prev = b;
      }
    }
    return next || prev ? { next, prev } : null;
  }

  function findGallery(path) {
    for (const el of path) {
      if (!el || el.nodeType !== 1) continue;
      if (/CAROUSEL/i.test(el.tagName)) {
        const btns = galButtons(el);
        if (btns) return { el, btns };
      }
    }
    return null;
  }

  function galClick(b) {
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
    const st = getComputedStyle(b);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    b.click();
    return true;
  }

  document.addEventListener('touchstart', (e) => {
    gal = null;
    if (!S.gallerySwipe || e.touches.length !== 1) return;
    const path = e.composedPath ? e.composedPath() : [];
    const g = findGallery(path);
    if (!g) return;
    const t = e.touches[0];
    gal = { ...g, x: t.clientX, y: t.clientY, dir: 0 };
  }, { passive: true, capture: true });

  document.addEventListener('touchmove', (e) => {
    if (!gal) return;
    const t = e.touches[0];
    const dx = t.clientX - gal.x;
    const dy = t.clientY - gal.y;
    if (!gal.dir) {
      // So früh wie möglich entscheiden, damit Browser-Gesten nicht zuerst greifen
      if (Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx)) { gal = null; return; }
      if (Math.abs(dx) > 3 && Math.abs(dx) >= Math.abs(dy)) gal.dir = 1;
    }
    if (gal.dir) {
      if (e.cancelable) e.preventDefault(); // Reddits eigene Geste unterdrücken
      e.stopPropagation();
    }
    gal.dx = dx;
  }, { passive: false, capture: true });

  document.addEventListener('touchend', (e) => {
    const g = gal;
    gal = null;
    if (!g || !g.dir || Math.abs(g.dx || 0) < 40) return;
    if (e.cancelable) e.preventDefault(); // kein Klick auf das Bild auslösen
    e.stopPropagation();
    if (g.dx < 0) galClick(g.btns.next);
    else galClick(g.btns.prev);
  }, { passive: false, capture: true });

  document.addEventListener('touchcancel', () => { gal = null; }, { passive: true, capture: true });

  // Reddits eigene Wischlogik hängt an Pointer-Events. Bei großen Wischbewegungen
  // blättert sie zusätzlich zu unserem Klick, dadurch wurden Bilder übersprungen.
  // Darum Pointer-Events innerhalb von Galerien abfangen (außer auf Buttons).
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((type) => {
    document.addEventListener(type, (e) => {
      if (!S.gallerySwipe || e.pointerType === 'mouse') return;
      const path = e.composedPath ? e.composedPath() : [];
      if (path.some((el) => el && el.nodeType === 1 && /^(BUTTON|A)$/.test(el.tagName))) return;
      if (!findGallery(path)) return;
      e.stopImmediatePropagation();
      e.stopPropagation();
    }, { capture: true });
  });

  /* ---------------------------------------------------------------
   * Toolbar und Kommentarfeld ausblenden, wenn Reddit etwas darüberlegt
   * (Drei-Punkte-Menü, Profilmenü, Dialoge)
   * ------------------------------------------------------------- */
  const OVERLAY_TAG_RE = /(dialog|drawer|sheet|modal|popover|overflow-menu|bottom-sheet|flyout)/i;

  function isOverlayEl(el) {
    if (!el || el.nodeType !== 1 || el === document.body || el === document.documentElement) return false;
    if (el.id === 'rmt-host' || el.id === 'rmt-cv') return false;
    if (el.tagName === 'DIALOG' && el.open) return true;
    if (el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true') return true;
    if (OVERLAY_TAG_RE.test(el.tagName) && el.getClientRects().length) return true;
    // Feste Ebenen nur, wenn sie groß sind (Menüs/Sheets), nicht z. B. schmale Leisten
    if (getComputedStyle(el).position !== 'fixed') return false;
    const r = el.getBoundingClientRect();
    return r.height > window.innerHeight * 0.3 && r.width > window.innerWidth * 0.6;
  }

  function pageCovered() {
    if (!host) return false;
    // Reddit sperrt beim Öffnen von Menüs meist das Scrollen der Seite
    const bs = getComputedStyle(document.body);
    const hs = getComputedStyle(document.documentElement);
    if (bs.overflow === 'hidden' || hs.overflow === 'hidden' || bs.position === 'fixed') return true;
    // Was liegt unter unserer Toolbar? Dafür die eigene Oberfläche kurz „durchsichtig“ machen
    if (typeof document.elementFromPoint !== 'function') return false;
    const prev = host.style.pointerEvents;
    host.style.pointerEvents = 'none';
    let covered = false;
    try {
      for (const y of [window.innerHeight - 60, window.innerHeight - 140]) {
        let el = document.elementFromPoint(window.innerWidth / 2, y);
        for (let i = 0; el && i < 40; i++) {
          if (isOverlayEl(el)) { covered = true; break; }
          el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
        }
        if (covered) break;
      }
    } finally {
      host.style.pointerEvents = prev;
    }
    return covered;
  }

  function updateCovered() {
    if (!bar) return;
    const c = pageCovered();
    bar.classList.toggle('covered', c);
    if (composerEl && !composerEl.querySelector('.rf')) composerEl.classList.toggle('covered', c);
  }

  /* ---------------------------------------------------------------
   * Toolbar beim Scrollen ein-/ausblenden
   * ------------------------------------------------------------- */
  let lastY = 0;
  window.addEventListener('scroll', () => {
    if (!bar) return;
    const y = window.scrollY;

    // Mit der Browser-Leiste mitwandern: Orion blendet seine Leiste beim
    // Runterscrollen aus und beim Hochscrollen wieder ein, ohne dass sich
    // der Sichtbereich der Seite ändert. Darum ahmen wir das Verhalten nach.
    const follow = S.followBrowserBar && !S.hideOnScroll;
    if (!follow) bar.classList.remove('low');

    if (Math.abs(y - lastY) < 12 && y > 50) return;
    const down = y > lastY;

    if (follow) {
      const shift = (Number(S.followShift) || 0) + 'px';
      bar.style.setProperty('--shift', shift);
      let low = bar.classList.contains('low');
      if (y <= 50) low = false;
      else if (Date.now() >= suppressHideUntil) low = down;
      bar.classList.toggle('low', low);
      if (composerEl) {
        composerEl.style.setProperty('--shift', shift);
        // beim Schreiben nicht verschieben (Tastatur)
        composerEl.classList.toggle('low', low && !composerEl.querySelector('.rf'));
      }
    } else if (composerEl) {
      composerEl.classList.remove('low');
    }

    if (!S.hideOnScroll || Date.now() < suppressHideUntil) {
      bar.classList.remove('hidden');
    } else {
      bar.classList.toggle('hidden', down && y > 120);
    }
    lastY = y;
  }, { passive: true });

  /* ---------------------------------------------------------------
   * Einstellungsmenü
   * ------------------------------------------------------------- */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const options = (list, cur) => list.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('');
  const checked = (b) => (b ? ' checked' : '');

  function openSettings() {
    buildUI();
    if (!modal) return;
    modal.innerHTML = `
      <div class="panel" role="dialog" aria-label="Einstellungen">
        <h2>Reddit-Einstellungen</h2>

        <h3>Feeds</h3>
        <label>Sortierung
          <select id="feedSort">${options([
            ['off', 'Aus (Reddit-Standard)'], ['best', 'Best'], ['hot', 'Hot'],
            ['new', 'Neu'], ['top', 'Top'], ['rising', 'Rising'],
          ], S.feedSort)}</select>
        </label>
        <label>Zeitraum bei „Top“
          <select id="feedTopTime">${options([
            ['hour', 'Letzte Stunde'], ['day', 'Heute'], ['week', 'Diese Woche'],
            ['month', 'Dieser Monat'], ['year', 'Dieses Jahr'], ['all', 'Alle Zeiten'],
          ], S.feedTopTime)}</select>
        </label>
        <label class="chk"><input type="checkbox" id="applyFeedSortHome"${checked(S.applyFeedSortHome)}> Auf der Startseite anwenden</label>
        <label class="chk"><input type="checkbox" id="applyFeedSortSubs"${checked(S.applyFeedSortSubs)}> In Subreddits anwenden</label>
        <div class="hint">Greift nur, wenn in der Adresse noch keine Sortierung steht. Eine manuell gewählte Sortierung bleibt also erhalten.</div>

        <h3>Kommentare</h3>
        <label>Sortierung
          <select id="commentSort">${options([
            ['off', 'Aus (Reddit-Standard)'], ['confidence', 'Beste'], ['top', 'Top'],
            ['new', 'Neu'], ['controversial', 'Kontrovers'], ['old', 'Alt'], ['qa', 'Fragen & Antworten'],
          ], S.commentSort)}</select>
        </label>
        <div class="hint">Gilt für beide Ansichten.</div>

        <h3>Eigene Kommentaransicht</h3>
        <label class="chk"><input type="checkbox" id="hideBelowThread"${checked(S.hideBelowThread)}> Werbung (auch im Feed) und weitere Beiträge unter dem Thread ausblenden</label>
        <label class="chk"><input type="checkbox" id="customComments"${checked(S.customComments)}> Eigene Ansicht verwenden</label>
        <div class="hint">Ersetzt Reddits Kommentarbereich: alles ausgeklappt, farbige Balken, Abstimmen und Antworten. Ausgeschaltet zeigt Reddit seinen normalen, unveränderten Kommentarbereich.</div>
        <label class="chk"><input type="checkbox" id="autoMore"${checked(S.autoMore)}> „Weitere Antworten“ automatisch laden</label>
        <label class="chk"><input type="checkbox" id="floatingComposer"${checked(S.floatingComposer)}> Schwebendes Kommentarfeld unten</label>
        <label>Abstand zwischen Kommentaren (px)
          <input type="number" id="commentGap" inputmode="numeric" min="0" max="40" value="${esc(S.commentGap)}">
        </label>
        <label class="chk"><input type="checkbox" id="showAvatars"${checked(S.showAvatars)}> Profilbilder anzeigen</label>

        <h3>Darstellung</h3>
        <label class="chk"><input type="checkbox" id="trueBlack"${checked(S.trueBlack)}> Reines Schwarz im dunklen Design (OLED), inkl. Kopfleiste</label>
        <label class="chk"><input type="checkbox" id="hideAppBanner"${checked(S.hideAppBanner)}> Banner „In der Reddit-App anzeigen“ ausblenden</label>
        <label>Deckkraft von Toolbar und Kommentarfeld (%) – weniger = transparenter
          <input type="number" id="toolbarOpacity" inputmode="numeric" min="0" max="100" value="${esc(S.toolbarOpacity)}">
        </label>
        <label>Unschärfe hinter Toolbar und Kommentarfeld (px)
          <input type="number" id="toolbarBlur" inputmode="numeric" min="0" max="60" value="${esc(S.toolbarBlur)}">
        </label>

        <h3>Toolbar</h3>
        <label>Position
          <select id="toolbarPos">${options([
            ['left', 'Links'], ['center', 'Mitte'], ['right', 'Rechts'],
          ], S.toolbarPos)}</select>
        </label>
        <label>Home-Ziel
          <input type="text" id="homeUrl" value="${esc(S.homeUrl)}" placeholder="/ oder /r/popular" autocapitalize="off" autocorrect="off">
        </label>
        <label class="chk"><input type="checkbox" id="showPrevButton"${checked(S.showPrevButton)}> Button „Nach oben“ anzeigen</label>
        <label>Abstand oben beim Springen zum nächsten Kommentar (px)
          <input type="number" id="headerOffset" inputmode="numeric" min="0" max="300" value="${esc(S.headerOffset)}">
        </label>
        <label class="chk"><input type="checkbox" id="followBrowserBar"${checked(S.followBrowserBar)}> Mit der Browser-Leiste nach unten rutschen</label>
        <label>Verschiebung nach unten (px)
          <input type="number" id="followShift" inputmode="numeric" min="0" max="200" value="${esc(S.followShift)}">
        </label>
        <label class="chk"><input type="checkbox" id="hideOnScroll"${checked(S.hideOnScroll)}> Beim Runterscrollen ausblenden</label>

        <h3>Gesten</h3>
        <label class="chk"><input type="checkbox" id="swipeBack"${checked(S.swipeBack)}> Nach rechts wischen = Zurück</label>
        <label class="chk"><input type="checkbox" id="gallerySwipe"${checked(S.gallerySwipe)}> In Bildergalerien wischen zum Blättern</label>

        <h3>Fehlersuche</h3>
        <button type="button" class="txt" data-act="acct">Konto-Test</button>
        <button type="button" class="txt" data-act="navlog">Navigationsprotokoll</button>
        <button type="button" class="txt" data-act="diag">Kommentar-Struktur kopieren</button>
        <div class="hint">Auf einer Kommentarseite antippen und den kopierten Text an Claude schicken, wenn etwas nicht greift.</div>

        <div class="actions">
          <button type="button" class="txt" data-act="reset">Zurücksetzen</button>
          <span class="spacer"></span>
          <button type="button" class="txt" data-act="cancel">Abbrechen</button>
          <button type="button" class="txt primary" data-act="save">Speichern</button>
        </div>
      </div>`;

    modal.querySelector('[data-act=cancel]').addEventListener('click', closeSettings);
    modal.querySelector('[data-act=diag]').addEventListener('click', copyDiagnostics);
    modal.querySelector('[data-act=acct]').addEventListener('click', accountTest);
    modal.querySelector('[data-act=navlog]').addEventListener('click', () =>
      showText(navLog.length ? navLog.join('\n') : 'Noch keine Navigation aufgezeichnet', 'Navigationsprotokoll'));
    modal.querySelector('[data-act=reset]').addEventListener('click', () => {
      S = Object.assign({}, DEFAULTS);
      saveSettings(S);
      applyDocStyle();
      renderBar();
      openSettings();
      toast('Einstellungen zurückgesetzt');
    });
    modal.querySelector('[data-act=save]').addEventListener('click', () => {
      const $ = (id) => modal.querySelector('#' + id);
      let home = ($('homeUrl').value || '/').trim();
      if (!home.startsWith('/') && !/^https:\/\/(www\.)?reddit\.com/i.test(home)) home = '/' + home;
      const prev = S;
      let offset = parseInt($('headerOffset').value, 10);
      if (isNaN(offset)) offset = DEFAULTS.headerOffset;

      S = {
        feedSort: $('feedSort').value,
        feedTopTime: $('feedTopTime').value,
        applyFeedSortHome: $('applyFeedSortHome').checked,
        applyFeedSortSubs: $('applyFeedSortSubs').checked,
        commentSort: $('commentSort').value,
        showPrevButton: $('showPrevButton').checked,
        headerOffset: Math.min(300, Math.max(0, offset)),
        homeUrl: home,
        toolbarPos: $('toolbarPos').value,
        hideOnScroll: $('hideOnScroll').checked,
        customComments: $('customComments').checked,
        autoMore: $('autoMore').checked,
        showAvatars: $('showAvatars').checked,
        followBrowserBar: $('followBrowserBar').checked,
        swipeBack: $('swipeBack').checked,
        gallerySwipe: $('gallerySwipe').checked,
        hideBelowThread: $('hideBelowThread').checked,
        floatingComposer: $('floatingComposer').checked,
        trueBlack: $('trueBlack').checked,
        hideAppBanner: $('hideAppBanner').checked,
        toolbarOpacity: (() => { const v = parseInt($('toolbarOpacity').value, 10); return isNaN(v) ? DEFAULTS.toolbarOpacity : Math.min(100, Math.max(0, v)); })(),
        toolbarBlur: (() => { const v = parseInt($('toolbarBlur').value, 10); return isNaN(v) ? DEFAULTS.toolbarBlur : Math.min(60, Math.max(0, v)); })(),
        commentGap: (() => { const v = parseInt($('commentGap').value, 10); return isNaN(v) ? DEFAULTS.commentGap : Math.min(40, Math.max(0, v)); })(),
        followShift: (() => { const v = parseInt($('followShift').value, 10); return isNaN(v) ? DEFAULTS.followShift : Math.min(200, Math.max(0, v)); })(),
      };
      const reloadView = cv && prev.showAvatars !== S.showAvatars;
      saveSettings(S);
      if (cv) cv.host.style.setProperty('--gap', (Number(S.commentGap) || 0) + 'px');
      applyBarLook();
      if (reloadView) cvUnmount(); // neu aufbauen, wird unten wieder eingehängt
      closeSettings();
      applyDocStyle();
      scheduleCommentWork();
      renderBar();
      toast('Gespeichert');
    });

    modal.classList.remove('hidden');
  }

  function closeSettings() {
    if (modal) {
      modal.classList.add('hidden');
      modal.innerHTML = '';
    }
  }

  /* ---------------------------------------------------------------
   * Start
   * ------------------------------------------------------------- */
  if (typeof GM_registerMenuCommand === 'function') {
    try { GM_registerMenuCommand('Einstellungen', openSettings); } catch (e) { /* ignorieren */ }
  }

  function init() {
    buildUI();
    applyDocStyle();
    scheduleCommentWork();
    new MutationObserver(scheduleCommentWork).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', scheduleCommentWork, { passive: true });
    setInterval(() => { if (!document.hidden) updateCovered(); }, 600);
    // Kopfleiste in den ersten Sekunden schnell schwarz färben (nicht erst bei der nächsten DOM-Änderung)
    const fastHeader = () => {
      let n = 0;
      const t = setInterval(() => { blackenHeader(); if (++n > 30 || headerFoundOnce) clearInterval(t); }, 150);
    };
    fastHeader();
    window.addEventListener('popstate', () => { headerFoundOnce = false; fastHeader(); });
    document.addEventListener('click', () => setTimeout(updateCovered, 120), true);
    setInterval(() => {
      buildUI();       // Toolbar wieder einhängen, falls Reddit den Body neu aufbaut
      applyDocStyle(); // Stylesheet wieder einhängen, falls entfernt
      onUrlChange();   // Fallback für URL-Wechsel
    }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
