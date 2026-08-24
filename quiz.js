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
    var progressWrap = root.querySelector('[data-quiz="progress-wrap"]');
    var progressSegs = Array.prototype.slice.call(root.querySelectorAll('[data-quiz="progress-seg"]'));
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
      // сегментированный прогресс: заполнены первые (current+1) сегментов
      if (progressSegs.length) {
        progressSegs.forEach(function (seg, i) {
          seg.classList.toggle('is-filled', i <= current);
        });
      }
      // легаси-режим: одна полоса на ширину %
      if (progressBar) {
        var pct = Math.round(((current + 1) / screens.length) * 100);
        progressBar.style.width = pct + '%';
      }
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
      // скрываем прогресс целиком на экране результата
      if (progressWrap) {
        progressWrap.style.display = 'none';
      } else if (progressSegs.length) {
        progressSegs.forEach(function (seg) { seg.style.display = 'none'; });
      } else if (progressBar) {
        progressBar.style.width = '100%';
      }
      if (resultWrap) {
        resultWrap.classList.add('is-active');
        resultWrap.classList.add('is-done'); // маркер «результат наполнен» → показываем кнопку PDF
        // мягкий скролл к верху квиза с учётом фиксированной шапки сайта
        try {
          var top = root.getBoundingClientRect().top + window.pageYOffset - 90;
          window.scrollTo({ top: top, behavior: 'smooth' });
        } catch (e) {}
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

    /* как esc, но <code>…</code> → чип-плашка (моно, зелёный фон) */
    function escChips(s) {
      var str = String(s == null ? '' : s);
      var out = '', last = 0, re = /<code>([\s\S]*?)<\/code>/g, m;
      while ((m = re.exec(str))) {
        out += esc(str.slice(last, m.index));
        out += '<span class="pq-chip">' + esc(m[1]) + '</span>';
        last = re.lastIndex;
      }
      out += esc(str.slice(last));
      return out;
    }

    function el(tag, cls, html) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html != null) e.innerHTML = html;
      return e;
    }

    /* иконка из PUMA_ICONS по ключу; вернёт SVG-разметку нужного цвета или '' */
    function iconSVG(key, hex) {
      var raw = (window.PUMA_ICONS || {})[key];
      if (!raw) return '';
      return raw.replace(/currentColor/g, hex);
    }
    function findingIconKey(f) {
      var m = (window.PUMA_ICONMAP && window.PUMA_ICONMAP.titleKey) || {};
      return m[f.title] || f.sev;
    }
    function groupIconKey(who) {
      var m = (window.PUMA_ICONMAP && window.PUMA_ICONMAP.groupKey) || {};
      return m[who] || null;
    }

    var SEV_HEX = { high: '#E97563', mid: '#F7B430', low: '#9AEE65' };

    function renderResult(data, mount) {
      mount.innerHTML = '';
      var lvl = levelClass(data.verdict.title);
      var accent = lvl === 'high' ? '#E97563' : lvl === 'mid' ? '#F7B430' : '#9AEE65';

      /* --- карточка вердикта (eyebrow + заголовок + балл справа) --- */
      var vcard = el('div', 'pq-verdict pq-lvl-' + lvl);
      var vmain = el('div', 'pq-verdict__main');
      vmain.appendChild(el('div', 'pq-verdict__eyebrow', 'РЕЗУЛЬТАТ ДИАГНОСТИКИ'));
      vmain.appendChild(el('div', 'pq-verdict__title', esc(data.verdict.title)));
      vmain.appendChild(el('p', 'pq-verdict__text', esc(data.verdict.text)));
      var vscore = el('div', 'pq-verdict__scorebox');
      vscore.appendChild(el('div', 'pq-verdict__score', esc(data.score)));
      vscore.appendChild(el('div', 'pq-verdict__scorecap', 'из 100 риск'));
      vcard.appendChild(vmain);
      vcard.appendChild(vscore);
      mount.appendChild(vcard);

      /* --- полоса риска (3 зоны + метка на позиции балла) --- */
      mount.appendChild(riskBar(Number(data.score) || 0, accent));

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

      /* --- что показывает диагностика (findings: иконка + заголовок + тег) --- */
      if (data.findings && data.findings.length) {
        var fsec = section('Что показывает диагностика');
        data.findings.forEach(function (f) {
          var card = el('div', 'pq-find pq-sev-' + f.sev);
          var head = el('div', 'pq-find__head');
          var ic = el('div', 'pq-find__icon');
          ic.innerHTML = iconSVG(findingIconKey(f), SEV_HEX[f.sev] || '#9AEE65');
          head.appendChild(ic);
          head.appendChild(el('h4', 'pq-find__title', esc(f.title)));
          head.appendChild(el('span', 'pq-tag pq-tag--' + f.sev, esc(SEV_LABELS[f.sev] || '')));
          card.appendChild(head);
          card.appendChild(el('p', 'pq-find__body', escChips(f.body)));
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
          li.appendChild(el('span', 'pq-timeline__when', esc(String(row.when).toUpperCase())));
          var b = el('div', 'pq-timeline__body');
          b.appendChild(el('div', 'pq-timeline__what', escChips(row.what)));
          b.appendChild(el('div', 'pq-timeline__cons', escChips(row.cons)));
          li.appendChild(b);
          tl.appendChild(li);
        });
        tsec.appendChild(tl);
        mount.appendChild(tsec);
      }

      /* --- вопросы, которые стоит задать (аккордеон: иконка + заголовок + стрелка) --- */
      if (data.groups && data.groups.length) {
        var gsec = section('Вопросы, которые стоит задать');
        data.groups.forEach(function (g, gi_idx) {
          var gc = el('div', 'pq-group' + (gi_idx === 0 ? ' is-open' : '')); // первая раскрыта
          var gh = el('div', 'pq-group__head');
          var gk = groupIconKey(g.who);
          if (gk) {
            var gi = el('div', 'pq-group__icon');
            gi.innerHTML = iconSVG(gk, '#9AEE65');
            gh.appendChild(gi);
          }
          gh.appendChild(el('div', 'pq-group__who', esc(String(g.who).toUpperCase())));
          // стрелка-шеврон справа
          var chev = el('span', 'pq-group__chev');
          chev.innerHTML = '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 8l5 5 5-5" stroke="#9AEE65" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          gh.appendChild(chev);
          gc.appendChild(gh);
          var body = el('div', 'pq-group__body');
          var ol = el('ol', 'pq-group__list');
          g.qs.forEach(function (q) { ol.appendChild(el('li', null, esc(q))); });
          body.appendChild(ol);
          gc.appendChild(body);
          // клик по всей карточке — раскрыть эту, свернуть остальные.
          // клики внутри раскрытого тела (по тексту вопросов) не сворачивают.
          gc.addEventListener('click', function (e) {
            if (e.target.closest('.pq-group__body')) return;
            var willOpen = !gc.classList.contains('is-open');
            var allGroups = gsec.querySelectorAll('.pq-group');
            Array.prototype.forEach.call(allGroups, function (other) { other.classList.remove('is-open'); });
            if (willOpen) gc.classList.add('is-open');
          });
          gsec.appendChild(gc);
        });
        mount.appendChild(gsec);
      }

      /* --- чек-лист приёмки (интерактивный: клик ставит галочку) --- */
      if (data.checklist && data.checklist.length) {
        var csec = section('Чек-лист приёмки ответов');
        var cl = el('ul', 'pq-checklist');
        data.checklist.forEach(function (item) {
          var li = el('li');
          var box = el('span', 'pq-checklist__box');
          // галочка (SVG) цветом #323E38 — видна только в checked-состоянии
          box.innerHTML = '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 8.5l3 3 6-6.5" stroke="#323E38" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          li.appendChild(box);
          li.appendChild(el('span', 'pq-checklist__txt', esc(item)));
          li.addEventListener('click', function () { li.classList.toggle('is-checked'); });
          cl.appendChild(li);
        });
        csec.appendChild(cl);
        mount.appendChild(csec);
      }
    }

    /* полоса риска: зоны 0–29 / 30–54 / 55–100, метка на score/100 */
    function riskBar(score, accent) {
      var pct = Math.max(0, Math.min(100, score));
      var wrap = el('div', 'pq-riskbar');
      var track = el('div', 'pq-riskbar__track');
      track.appendChild(el('span', 'pq-riskbar__seg pq-riskbar__seg--g'));
      track.appendChild(el('span', 'pq-riskbar__seg pq-riskbar__seg--a'));
      track.appendChild(el('span', 'pq-riskbar__seg pq-riskbar__seg--r'));
      var marker = el('div', 'pq-riskbar__marker');
      marker.style.left = pct + '%';
      marker.style.borderColor = accent;
      var val = el('div', 'pq-riskbar__val', esc(score));
      val.style.left = pct + '%';
      val.style.color = accent;
      track.appendChild(marker);
      wrap.appendChild(val);
      wrap.appendChild(track);
      var scale = el('div', 'pq-riskbar__scale');
      scale.appendChild(el('span', null, '0'));
      scale.appendChild(el('span', null, '29'));
      scale.appendChild(el('span', null, '54'));
      scale.appendChild(el('span', null, '100'));
      wrap.appendChild(scale);
      return wrap;
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
    if (resultWrap) {
      resultWrap.classList.remove('is-active');
      resultWrap.classList.remove('is-done'); // на случай, если класс остался в вёрстке
    }
    // прогресс виден на старте (сбрасываем возможное скрытие из прошлого прохода)
    if (progressWrap) progressWrap.style.display = '';
    progressSegs.forEach(function (seg) { seg.style.display = ''; });
    show(0);
  }
})();
