/* ============================================================
   ПУМА Биллинг — движок квиза-диагностики (Webflow)
   Отвечает ТОЛЬКО за логику, экранный результат и вызов PDF.
   Разметка свёрстана в Webflow, стыковка через data-атрибуты.

   Порядок подключения на странице (перед </body>):
     jsPDF → svg2pdf → assets-fonts → assets-visual → logic_pure → generator → quiz
   Зависит от глобалей из logic_pure.js:
     QUESTIONS, answers, reportData()
   и из generator.js: makeReportPdf()
   ============================================================ */
(function () {
  'use strict';

  /* ---- ждём DOM ---- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    var root = document.querySelector('[data-quiz="root"]');
    if (!root) return; // на странице нет квиза — тихо выходим

    // порядок экранов берём из модели логики, а не из DOM,
    // чтобы совпадал с тем, что читает reportData()
    var ORDER = (typeof QUESTIONS !== 'undefined')
      ? QUESTIONS.map(function (q) { return q.id; })
      : ['dbms', 'stage', 'cat', 'vendor'];

    // экраны в порядке ORDER (терпимы к отсутствию какого-то экрана в DOM)
    var screens = ORDER
      .map(function (id) { return root.querySelector('[data-quiz="question"][data-q="' + id + '"]'); })
      .filter(Boolean);

    if (!screens.length) return;

    var progressBar = root.querySelector('[data-quiz="progress-bar"]');
    var resultWrap  = root.querySelector('[data-quiz="result"]');
    var resultBody  = root.querySelector('[data-quiz="result-body"]');
    var downloadBtn = root.querySelector('[data-quiz="download"]');

    // гарантируем наличие глобального объекта ответов (его читает reportData)
    if (typeof window.answers === 'undefined') {
      window.answers = { dbms: '', stage: '', cat: '', vendor: [] };
    }
    var A = window.answers;
    if (!Array.isArray(A.vendor)) A.vendor = [];

    var current = 0;

    /* ---------- утилиты ---------- */
    function qidOf(screen) { return screen.getAttribute('data-q'); }
    function isMulti(screen) { return screen.getAttribute('data-multi') === 'true'; }
    function optsOf(screen) { return Array.prototype.slice.call(screen.querySelectorAll('[data-opt]')); }

    function hasAnswer(screen) {
      var id = qidOf(screen);
      if (isMulti(screen)) return Array.isArray(A[id]) && A[id].length > 0;
      return !!A[id];
    }

    /* ---------- отрисовка выбранных состояний ---------- */
    function paintScreen(screen) {
      var id = qidOf(screen);
      var multi = isMulti(screen);
      optsOf(screen).forEach(function (opt) {
        var v = opt.getAttribute('data-opt');
        var on = multi ? (A[id].indexOf(v) > -1) : (A[id] === v);
        opt.classList.toggle('is-selected', on);
        opt.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    /* ---------- навигация ---------- */
    function show(i) {
      current = Math.max(0, Math.min(screens.length - 1, i));
      screens.forEach(function (s, idx) {
        s.classList.toggle('is-active', idx === current);
      });
      if (resultWrap) resultWrap.classList.remove('is-active');

      updateProgress();
      updateNav();
      paintScreen(screens[current]);
    }

    function updateProgress() {
      if (!progressBar) return;
      // шаги 25/50/75/100 при 4 вопросах — (шаг+1)/всего
      var pct = Math.round(((current + 1) / screens.length) * 100);
      progressBar.style.width = pct + '%';
    }

    function updateNav() {
      var screen = screens[current];

      // «Назад» — скрываем на первом экране (в т.ч. если верстальщик не убрал)
      var backBtns = screen.querySelectorAll('[data-quiz="back"]');
      Array.prototype.forEach.call(backBtns, function (b) {
        b.style.display = (current === 0) ? 'none' : '';
      });

      // «Далее» — блокируем без выбора
      var ready = hasAnswer(screen);
      var nextBtns = screen.querySelectorAll('[data-quiz="next"]');
      Array.prototype.forEach.call(nextBtns, function (b) {
        b.classList.toggle('is-disabled', !ready);
        b.setAttribute('aria-disabled', ready ? 'false' : 'true');
      });
    }

    function next() {
      var screen = screens[current];
      if (!hasAnswer(screen)) return; // страховка от клика по заблокированной
      if (current < screens.length - 1) {
        show(current + 1);
      } else {
        finish();
      }
    }

    function back() {
      if (current > 0) show(current - 1);
    }

    /* ---------- выбор варианта ---------- */
    function choose(screen, opt) {
      var id = qidOf(screen);
      var v = opt.getAttribute('data-opt');

      if (isMulti(screen)) {
        var pos = A[id].indexOf(v);
        if (pos > -1) A[id].splice(pos, 1);
        else A[id].push(v);
      } else {
        A[id] = v;
      }
      paintScreen(screen);
      updateNav();
    }

    /* ---------- финал: экранный результат + разблокировка PDF ---------- */
    function finish() {
      var data = (typeof reportData === 'function') ? reportData() : null;
      if (data && resultBody) renderResult(data, resultBody);

      screens.forEach(function (s) { s.classList.remove('is-active'); });
      if (progressBar) progressBar.style.width = '100%';
      if (resultWrap) {
        resultWrap.classList.add('is-active');
        if (resultWrap.scrollIntoView) resultWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    /* ---------- экранный результат (в дизайн-языке отчёта) ---------- */
    var SEV_LABELS = { high: 'Критично', mid: 'Внимание', low: 'Норма' };

    function levelClass(title) {
      if (title.indexOf('Высок') > -1) return 'high';
      if (title.indexOf('Повыш') > -1) return 'mid';
      return 'low';
    }

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function el(tag, cls, html) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html != null) e.innerHTML = html;
      return e;
    }

    function renderResult(data, mount) {
      mount.innerHTML = '';
      var lvl = levelClass(data.verdict.title);

      /* --- карточка вердикта --- */
      var vcard = el('div', 'pq-verdict pq-lvl-' + lvl);
      var vhead = el('div', 'pq-verdict__head');
      vhead.appendChild(el('span', 'pq-verdict__badge', esc(data.verdict.title)));
      vhead.appendChild(el('span', 'pq-verdict__score', esc(data.score) + '<i>/100</i>'));
      vcard.appendChild(vhead);
      vcard.appendChild(el('p', 'pq-verdict__text', esc(data.verdict.text)));
      mount.appendChild(vcard);

      /* --- ваши ответы --- */
      if (data.answersRows && data.answersRows.length) {
        var asec = section('Ваши ответы');
        var dl = el('dl', 'pq-answers');
        data.answersRows.forEach(function (r) {
          dl.appendChild(el('dt', 'pq-answers__q', esc(r.q)));
          dl.appendChild(el('dd', 'pq-answers__a', esc(r.a)));
        });
        asec.appendChild(dl);
        mount.appendChild(asec);
      }

      /* --- что показывает диагностика (findings) --- */
      if (data.findings && data.findings.length) {
        var fsec = section('Что показывает диагностика');
        data.findings.forEach(function (f) {
          var card = el('div', 'pq-find pq-sev-' + f.sev);
          var top = el('div', 'pq-find__top');
          top.appendChild(el('span', 'pq-tag pq-tag--' + f.sev, esc(SEV_LABELS[f.sev] || '')));
          top.appendChild(el('h4', 'pq-find__title', esc(f.title)));
          card.appendChild(top);
          card.appendChild(el('p', 'pq-find__body', esc(f.body)));
          fsec.appendChild(card);
        });
        mount.appendChild(fsec);
      }

      /* --- что нарушается и когда (timeline) --- */
      if (data.timeline && data.timeline.length) {
        var tsec = section('Что нарушается и когда');
        var tl = el('ul', 'pq-timeline');
        data.timeline.forEach(function (row) {
          var li = el('li', 'pq-timeline__row' + (row.now ? ' is-now' : ''));
          li.appendChild(el('span', 'pq-timeline__when', esc(row.when)));
          var b = el('div', 'pq-timeline__body');
          b.appendChild(el('div', 'pq-timeline__what', esc(row.what)));
          b.appendChild(el('div', 'pq-timeline__cons', esc(row.cons)));
          li.appendChild(b);
          tl.appendChild(li);
        });
        tsec.appendChild(tl);
        mount.appendChild(tsec);
      }

      /* --- вопросы, которые стоит задать --- */
      if (data.groups && data.groups.length) {
        var gsec = section('Вопросы, которые стоит задать');
        data.groups.forEach(function (g) {
          var gc = el('div', 'pq-group');
          gc.appendChild(el('div', 'pq-group__who', esc(g.who)));
          var ul = el('ul', 'pq-group__list');
          g.qs.forEach(function (q) { ul.appendChild(el('li', null, esc(q))); });
          gc.appendChild(ul);
          gsec.appendChild(gc);
        });
        mount.appendChild(gsec);
      }

      /* --- чек-лист приёмки --- */
      if (data.checklist && data.checklist.length) {
        var csec = section('Чек-лист приёмки');
        var cl = el('ul', 'pq-checklist');
        data.checklist.forEach(function (item) { cl.appendChild(el('li', null, esc(item))); });
        csec.appendChild(cl);
        mount.appendChild(csec);
      }
    }

    function section(title) {
      var s = el('section', 'pq-section');
      s.appendChild(el('h3', 'pq-section__title', esc(title)));
      return s;
    }

    /* ---------- PDF ---------- */
    var pdfBusy = false;
    function downloadPdf() {
      if (pdfBusy) return;
      if (typeof makeReportPdf !== 'function' ||
          !(window.jspdf && window.jspdf.jsPDF) ||
          typeof reportData !== 'function') {
        console.error('[quiz] PDF-генератор не загружен (jsPDF / makeReportPdf / reportData).');
        return;
      }
      pdfBusy = true;
      if (downloadBtn) downloadBtn.classList.add('is-loading');

      Promise.resolve()
        .then(function () { return makeReportPdf(window.jspdf.jsPDF, reportData()); })
        .then(function (doc) { doc.save('puma-diagnostika-subd.pdf'); })
        .catch(function (err) { console.error('[quiz] Ошибка генерации PDF:', err); })
        .then(function () {
          pdfBusy = false;
          if (downloadBtn) downloadBtn.classList.remove('is-loading');
        });
    }

    /* ---------- делегирование кликов ---------- */
    root.addEventListener('click', function (e) {
      var optEl = e.target.closest('[data-opt]');
      if (optEl && root.contains(optEl)) {
        var scr = optEl.closest('[data-quiz="question"]');
        if (scr) { choose(scr, optEl); return; }
      }

      var ctl = e.target.closest('[data-quiz]');
      if (!ctl || !root.contains(ctl)) return;
      var role = ctl.getAttribute('data-quiz');

      if (role === 'next') {
        if (ctl.classList.contains('is-disabled')) return;
        e.preventDefault(); next();
      } else if (role === 'back') {
        e.preventDefault(); back();
      } else if (role === 'download') {
        e.preventDefault(); downloadPdf();
      }
    });

    /* ---------- клавиатура на вариантах (доступность) ---------- */
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var optEl = e.target.closest && e.target.closest('[data-opt]');
      if (optEl && root.contains(optEl)) {
        var scr = optEl.closest('[data-quiz="question"]');
        if (scr) { e.preventDefault(); choose(scr, optEl); }
      }
    });

    // делаем варианты фокусируемыми, если верстальщик не проставил tabindex
    screens.forEach(function (scr) {
      optsOf(scr).forEach(function (opt) {
        if (!opt.hasAttribute('tabindex')) opt.setAttribute('tabindex', '0');
        if (!opt.hasAttribute('role')) opt.setAttribute('role', 'button');
      });
    });

    /* ---------- старт ---------- */
    if (resultWrap) resultWrap.classList.remove('is-active');
    show(0);
  }
})();
