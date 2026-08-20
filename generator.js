/* ============================================================
   ПУМА Биллинг — генератор PDF-отчёта диагностики (тёмная тема)
   jsPDF + svg2pdf. Шрифты: Gilroy Medium/Bold, JetBrains Mono.
   Логика берётся из logic_clean.js (reportData()).
   ============================================================ */

/* --- регистрация шрифтов из base64 (window.PUMA_FONTS) --- */
function registerFonts(doc){
  const F = window.PUMA_FONTS;
  doc.addFileToVFS('Gilroy-Medium.ttf', F.GILROY_MEDIUM);
  doc.addFont('Gilroy-Medium.ttf', 'Gilroy', 'normal');
  doc.addFileToVFS('Gilroy-Bold.ttf', F.GILROY_BOLD);
  doc.addFont('Gilroy-Bold.ttf', 'Gilroy', 'bold');
  doc.addFileToVFS('JBMono-Medium.ttf', F.JBMONO_MEDIUM);
  doc.addFont('JBMono-Medium.ttf', 'JBMono', 'normal');
}

/* --- палитра из тёмных макетов --- */
const P = {
  bg:    [34, 42, 38],    // #222A26 фон страницы
  card:  [50, 62, 56],    // #323E38 тёмная карточка
  light: [213, 231, 222], // #D5E7DE светлый блок
  lime:  [154, 238, 101], // #9AEE65 акцент
  ink:   [237, 244, 239], // почти белый текст на тёмном
  inkDark:[23, 24, 24],   // тёмный текст (на лайме/светлом)
  body:  [213, 231, 222], // #D5E7DE наборный текст (светлее)
  mute:  [160, 178, 165], // приглушённый на тёмном
  muteL: [90, 99, 82],
  red:   [233, 117, 99],  // #E97563 высокий риск
  amber: [247, 180, 48],  // #F7B430 повышенный
  green: [78, 154, 49],   // норма/низкий
  hair:  [70, 84, 74],    // тонкие линии
};
/* severity → [подпись, цвет] */
const SEV = {
  high: ['КРИТИЧНО', P.red],
  mid:  ['ВНИМАНИЕ', P.amber],
  low:  ['НОРМА',    P.green],
};
/* карта заголовок→ключ иконки (window.PUMA_ICONMAP) */
const ICONMAP = (typeof window!=='undefined' && window.PUMA_ICONMAP) || {titleKey:{}, groupKey:{}};

/* делит длинный текст на абзацы, не ломая сокращения (ст., п., №), номера законов и т.п. */
function splitParagraphs(text){
  const s = String(text).trim();
  if(s.length < 240) return [s];
  const MK = String.fromCharCode(1);
  let masked = s.replace(/(^|[\s(«"'])(ст|стт|пп|п|ч|гл|абз|рис|табл|см|г|гг|руб|тыс|млн|млрд)\.(?=\s|\d)/gi,
                         function(m,pre,ab){ return pre+ab+MK; });
  masked = masked.replace(/\bт\.([едпк])\./gi, function(m,x){ return 'т'+MK+x+MK; });
  masked = masked.replace(/(\d)\.(\d)/g, '$1'+MK+'$2');
  const sentences = masked.match(/[^.!?]+[.!?]+[)»"']*\s*/g) || [masked];
  if(sentences.length <= 2) return [s];
  const out=[]; let buf='';
  sentences.forEach(function(sent,i){
    buf += sent;
    if((i+1)%2===0){ out.push(buf.trim()); buf=''; }
  });
  if(buf.trim()) out.push(buf.trim());
  return out.map(function(p){ return p.split(MK).join('.'); });
}

/* --- рендер SVG-иконки в квадрат через svg2pdf --- */
/* Возвращает промис. color — цвет обводки иконки (currentColor). */
async function drawIcon(doc, key, x, y, size, strokeRGB){
  const raw = (window.PUMA_ICONS||{})[key];
  if(!raw) return;
  // подставим currentColor → нужный цвет
  const hex = '#' + strokeRGB.map(c=>c.toString(16).padStart(2,'0')).join('');
  const svgStr = raw.replace(/currentColor/g, hex);
  const el = new DOMParser().parseFromString(svgStr, 'image/svg+xml').documentElement;
  await doc.svg(el, { x, y, width:size, height:size });
}

/* --- рендер логотипа (SVG) --- */
async function drawLogo(doc, x, y, w){
  const el = new DOMParser().parseFromString(window.PUMA_LOGO_SVG, 'image/svg+xml').documentElement;
  const h = w * 51/181; // пропорции оригинала
  await doc.svg(el, { x, y, width:w, height:h });
  return h;
}

/* ============================================================
   ГЛАВНАЯ ФУНКЦИЯ — собирает документ из reportData()
   ============================================================ */
async function makeReportPdf(jsPDFCtor, data){
  const doc = new jsPDFCtor({ unit:'mm', format:'a4', compress:true });
  registerFonts(doc);

  const M = { l:15, r:15, t:15, b:16 };
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = W - M.l - M.r;
  let y = M.t;

  /* --- заливка фона страницы тёмным --- */
  function paintBg(){
    doc.setFillColor(...P.bg);
    doc.rect(0, 0, W, H, 'F');
  }
  paintBg();

  /* helpers */
  const setF = (font, style, size, color) => {
    doc.setFont(font, style); doc.setFontSize(size);
    doc.setTextColor(...(color||P.ink));
  };
  function need(h){ if(y + h > H - M.b){ doc.addPage(); paintBg(); y = M.t; } }

  /* многострочный абзац; charSpace задаёт letter-spacing */
  function para(txt, {font='Gilroy', style='normal', size=10, color=P.ink, lh=null, indent=0, cs=0}={}){
    const x = M.l + indent;
    setF(font, style, size, color);
    if(cs) doc.setCharSpace(cs);
    const lines = doc.splitTextToSize(String(txt), CW - indent);
    const step = lh || size*0.42;
    lines.forEach(ln=>{ need(step+1); doc.text(ln, x, y); y += step; });
    if(cs) doc.setCharSpace(0);
    return y;
  }

  /* mono-тег на подложке. cs — межбуквенный интервал (мм). */
  function tag(txt, x, yTag, {fg=P.red, bg=P.bg, size=7}={}){
    doc.setFont('JBMono','normal'); doc.setFontSize(size);
    const cs = -(size*0.3528)*0.04; // -4% от кегля в мм
    doc.setCharSpace(cs);
    const tw = doc.getTextWidth(txt);
    const padX = 2.4, padY = 1.5, h = size*0.35 + padY*2;
    doc.setFillColor(...bg);
    doc.roundedRect(x, yTag - h + padY, tw + padX*2, h, 1.2, 1.2, 'F');
    doc.setTextColor(...fg);
    doc.text(txt, x + padX, yTag - 0.4);
    doc.setCharSpace(0);
    return tw + padX*2;
  }

  /* заголовок секции: крупный Gilroy Bold + линия (без иконок) */
  function section(txt){
    need(18);
    y += 7;
    setF('Gilroy','bold', 16.5, P.ink);
    doc.setCharSpace(-0.2);
    doc.text(txt, M.l, y + 4);
    doc.setCharSpace(0);
    y += 9;
    doc.setDrawColor(...P.hair); doc.setLineWidth(0.3);
    doc.line(M.l, y, M.l+CW, y);
    y += 6;
  }

  /* ---------------- ШАПКА ---------------- */
  const logoH = await drawLogo(doc, M.l, y, 34);
  // дата справа, mono
  doc.setFont('JBMono','normal'); doc.setFontSize(8); doc.setTextColor(...P.mute);
  doc.text(data.date.toUpperCase(), W - M.r, y + 5, {align:'right'});
  y += logoH + 6;

  // Заголовок отчёта
  setF('Gilroy','bold', 22, P.ink);
  doc.setCharSpace(-0.3);
  const titleLines = doc.splitTextToSize('Регуляторный статус СУБД под биллингом', CW);
  titleLines.forEach(ln=>{ doc.text(ln, M.l, y+7); y += 9; });
  doc.setCharSpace(0);
  y += 5.6;   // отступ ~16px между заголовком и подзагом
  // подзаголовок-пояснение
  para('Оценка одного компонента инсталляции — базы данных под биллингом — по ответам на четыре вопроса.',
       {size:9.5, color:P.mute, lh:4.6});
  y += 4;

  /* ---------------- ВЕРДИКТ (карточка) ---------------- */
  const vColor = data.verdict.title.indexOf('Высок')>-1 ? P.red
              : data.verdict.title.indexOf('Повыш')>-1 ? P.amber : P.green;
  setF('Gilroy','normal', 9.5, P.ink);           // метрики ДО измерения
  const vBodyLines = doc.splitTextToSize(data.verdict.text, CW - 40);
  const vH = 26 + vBodyLines.length*4.6;
  need(vH);
  // карточка-вердикт (тёмная с цветной левой полосой)
  doc.setFillColor(...P.card);
  doc.roundedRect(M.l, y, CW, vH, 3, 3, 'F');
  doc.setFillColor(...vColor);
  doc.roundedRect(M.l, y, 2.4, vH, 1, 1, 'F');
  // eyebrow mono
  doc.setFont('JBMono','normal'); doc.setFontSize(7.5); doc.setTextColor(...P.lime);
  doc.setCharSpace(0.4);
  doc.text('РЕЗУЛЬТАТ ДИАГНОСТИКИ', M.l+8, y+8);
  doc.setCharSpace(0);
  // балл справа
  setF('Gilroy','bold', 30, vColor);
  doc.text(String(data.score), W-M.r-6, y+16, {align:'right'});
  doc.setFont('JBMono','normal'); doc.setFontSize(7); doc.setTextColor(...P.mute);
  doc.text('из 100 риск', W-M.r-6, y+21, {align:'right'});
  // заголовок вердикта
  setF('Gilroy','bold', 17, P.ink);
  doc.setCharSpace(-0.2);
  doc.text(data.verdict.title, M.l+8, y+16);
  doc.setCharSpace(0);
  // текст вердикта
  setF('Gilroy','normal', 9.5, P.ink);
  let vy = y+22;
  vBodyLines.forEach(ln=>{ doc.text(ln, M.l+8, vy); vy += 4.6; });
  y += vH + 2;

  /* ---------------- ВАШИ ОТВЕТЫ (сразу после вердикта) ---------------- */
  section('Ваши ответы');
  data.answersRows.forEach(r=>{
    setF('Gilroy','bold', 9.4, P.body);           // метрики ответа ДО измерения
    const aLines = doc.splitTextToSize(r.a, CW-4);
    need(6 + aLines.length*4.3);
    setF('Gilroy','normal', 8.4, P.mute);
    doc.text(r.q, M.l, y);
    y += 4.4;
    setF("Gilroy","bold", 9.4, P.body);
    aLines.forEach(ln=>{ doc.text(ln, M.l, y); y += 4.3; });
    y += 2.4;
  });

  /* ---------------- ЧТО ПОКАЗЫВАЕТ ДИАГНОСТИКА ---------------- */
  section('Что показывает диагностика');
  const PAD = 4.2;           // ~12px внутренний отступ карточки
  const BOX = 9;             // контейнер иконки
  const GAP = 5;             // отступ иконка→заголовок
  for(const f of data.findings){
    const [label, col] = SEV[f.sev];
    const iconKey = (ICONMAP.titleKey && ICONMAP.titleKey[f.title]) || f.sev;
    const paras = splitParagraphs(f.body);
    const innerW = CW - PAD*2;
    // ширина заголовка: минус контейнер иконки, минус место под тег справа
    const tagReserve = 30;
    const titleW = innerW - (BOX+GAP) - tagReserve;
    setF('Gilroy','bold', 12.5, P.ink);           // метрики заголовка ДО измерения
    const titleLines = doc.splitTextToSize(f.title, titleW);
    // высота
    setF('Gilroy','normal', 9.4, P.body);         // метрики тела ДО измерения
    let bodyH = 0;
    const paraLines = paras.map(p=>{
      const L = doc.splitTextToSize(p, innerW);
      bodyH += L.length*4.7; bodyH += 3;
      return L;
    });
    bodyH -= 3;
    const headH = Math.max(BOX, titleLines.length*5.8);
    const cardH = PAD + headH + 6 + bodyH + PAD;
    need(cardH+3);
    // карточка
    doc.setFillColor(...P.card);
    doc.roundedRect(M.l, y, CW, cardH, 4, 4, 'F');
    const innerX = M.l + PAD;
    // --- шапка карточки: контейнер иконки + заголовок + тег ---
    const headTop = y + PAD;
    // контейнер иконки (тёмный квадрат #222A26, как на макете)
    doc.setFillColor(...P.bg);
    doc.roundedRect(innerX, headTop, BOX, BOX, 2.2, 2.2, 'F');
    await drawIcon(doc, iconKey, innerX+1.9, headTop+1.9, BOX-3.8, col);
    // тег severity справа (капс)
    doc.setFont('JBMono','normal'); doc.setFontSize(7.5);
    doc.setCharSpace(-(7.5*0.3528)*0.02);
    const tw = doc.getTextWidth(label);
    const tagX = M.l + CW - PAD - tw - 6;
    doc.setFillColor(...P.bg);
    doc.roundedRect(tagX, headTop+0.5, tw+6, 6, 1.6, 1.6, 'F');
    doc.setTextColor(...col);
    doc.text(label, tagX+3, headTop+4.5);
    doc.setCharSpace(0);
    // заголовок (вертикально по центру относительно контейнера иконки)
    setF('Gilroy','bold', 12.5, P.ink);
    doc.setCharSpace(-0.1);
    const titleX = innerX + BOX + GAP;
    let ty0 = headTop + 5;            // базовая линия для 1 строки ≈ центр BOX
    if(titleLines.length>1) ty0 = headTop + 3.8;
    titleLines.forEach(ln=>{ doc.text(ln, titleX, ty0); ty0 += 5.8; });
    doc.setCharSpace(0);
    // --- тело: на всю ширину, абзацами ---
    let cy = headTop + headH + 6;
    setF('Gilroy','normal', 9.4, P.body);
    paraLines.forEach(L=>{
      L.forEach(ln=>{ doc.text(ln, innerX, cy); cy += 4.7; });
      cy += 3;
    });
    y += cardH + 3.5;
  }

  /* ---------------- ЧТО НАРУШАЕТСЯ И КОГДА ---------------- */
  section('Что нарушается и когда');
  const COL = 32;                    // ширина левой колонки (срок)
  const RCW = CW - COL;              // ширина правой колонки
  data.timeline.forEach(r=>{
    setF('Gilroy','normal', 9, P.ink);            // задать метрики ДО измерения
    const whatLines = doc.splitTextToSize(r.what, RCW);
    setF('Gilroy','normal', 8, P.mute);
    const consLines = doc.splitTextToSize(r.cons, RCW);
    const rowH = Math.max(9, whatLines.length*4.4 + consLines.length*3.9 + 4);
    need(rowH+2);
    // левая колонка — срок как mono-тег (капсом)
    const whenCol = r.now ? P.red : P.lime;
    doc.setFont('JBMono','normal'); doc.setFontSize(7); doc.setTextColor(...whenCol);
    doc.setCharSpace(-(7*0.3528)*0.04);
    const whenLines = doc.splitTextToSize(String(r.when).toUpperCase(), COL-4);
    let wy = y+3;
    whenLines.forEach(ln=>{ doc.text(ln, M.l, wy); wy += 3.6; });
    doc.setCharSpace(0);
    // правая колонка
    let ty = y+3;
    setF('Gilroy','normal', 9, P.ink);
    whatLines.forEach(ln=>{ doc.text(ln, M.l+COL, ty); ty += 4.4; });
    setF('Gilroy','normal', 8, P.mute);
    consLines.forEach(ln=>{ doc.text(ln, M.l+COL, ty); ty += 3.9; });
    // разделитель
    y += rowH;
    doc.setDrawColor(...P.hair); doc.setLineWidth(0.2);
    doc.line(M.l, y, M.l+CW, y);
    y += 3;
  });

  /* ---------------- ВОПРОСЫ (каждая группа — карточка, стиль как findings) ---------------- */
  section('Вопросы, которые стоит задать');
  const QPAD = 4.2;
  const QBOX = 9;
  const QGAP = 5;
  for(const g of data.groups){
    const innerW = CW - QPAD*2;
    const qIndent = 6;
    setF('Gilroy','normal', 9.4, P.body);         // метрики ДО измерения
    let bodyH = 0;
    const qLinesArr = g.qs.map(q=>{
      const L = doc.splitTextToSize(q, innerW - qIndent);
      bodyH += L.length*4.5 + 2.6;
      return L;
    });
    bodyH -= 2.6;
    const qh = QPAD + QBOX + 6 + bodyH + QPAD;
    need(qh+3);
    doc.setFillColor(...P.card);
    doc.roundedRect(M.l, y, CW, qh, 4, 4, 'F');
    const ix = M.l + QPAD;
    const headTop = y + QPAD;
    // контейнер иконки группы
    const gKey = (ICONMAP.groupKey && ICONMAP.groupKey[g.who]) || null;
    doc.setFillColor(...P.bg);
    doc.roundedRect(ix, headTop, QBOX, QBOX, 2.2, 2.2, 'F');
    if(gKey) await drawIcon(doc, gKey, ix+1.9, headTop+1.9, QBOX-3.8, P.lime);
    // название группы — mono, зелёный, капс, вертикально по центру контейнера
    doc.setFont('JBMono','normal'); doc.setFontSize(9);
    doc.setCharSpace(-(9*0.3528)*0.02);
    doc.setTextColor(...P.lime);
    doc.text(g.who.toUpperCase(), ix + QBOX + QGAP, headTop + 6);
    doc.setCharSpace(0);
    // вопросы
    let qy = headTop + QBOX + 6;
    qLinesArr.forEach((L,i)=>{
      setF('Gilroy','normal', 9.4, P.body);
      doc.setTextColor(...P.lime);
      doc.text(String(i+1)+'.', ix, qy);
      doc.setTextColor(...P.body);
      L.forEach(ln=>{ doc.text(ln, ix+qIndent, qy); qy += 4.5; });
      qy += 2.6;
    });
    y += qh + 3.5;
  }

  /* ---------------- ЧЕК-ЛИСТ ---------------- */
  section('Чек-лист приёмки ответов');
  data.checklist.forEach(item=>{
    setF('Gilroy','normal', 9, P.ink);
    const lines = doc.splitTextToSize(item, CW-8);
    need(lines.length*4.3+3);
    doc.setDrawColor(...P.lime); doc.setLineWidth(0.35);
    doc.roundedRect(M.l, y-3.1, 3.4, 3.4, 0.6, 0.6, 'D');
    lines.forEach((ln,j)=>{ if(j) need(4.5); doc.text(ln, M.l+7, y); y += 4.3; });
    y += 1.7;
  });

  /* ---------------- ОГОВОРКА + КОНТАКТЫ ---------------- */
  y += 3;
  need(28);
  doc.setDrawColor(...P.hair); doc.setLineWidth(0.3); doc.line(M.l, y, M.l+CW, y); y += 5;
  para('Это оценка одного компонента, а не полное регуляторное заключение и не юридический документ. Отчёт не оценивает вашего поставщика и не содержит рекомендаций по выбору решения. Ссылки на нормы приведены для самостоятельной проверки.',
       {size:8.4, color:P.mute, lh:4});
  y += 3;
  setF('Gilroy','bold', 9, P.lime);
  doc.text('ПУМА Биллинг', M.l, y);
  setF('Gilroy','normal', 9, P.mute);
  doc.text(' — BSS/OSS и MVNE-платформа. Готовы разобрать вашу конфигурацию предметно.', M.l+doc.getTextWidth('ПУМА Биллинг'), y);
  y += 5;
  doc.setFont('JBMono','normal'); doc.setFontSize(8.4); doc.setTextColor(...P.ink);
  doc.text('info@pumabilling.ru   ·   +7 (495) 134-47-42   ·   pumabilling.ru', M.l, y);

  /* ---------------- НУМЕРАЦИЯ СТРАНИЦ ---------------- */
  const total = doc.internal.getNumberOfPages();
  for(let p=1;p<=total;p++){
    doc.setPage(p);
    doc.setFont('JBMono','normal'); doc.setFontSize(7); doc.setTextColor(...P.mute);
    doc.text(p+' / '+total, W-M.r, H-8, {align:'right'});
    doc.text('ПУМА Биллинг · Регуляторный статус СУБД', M.l, H-8);
  }
  return doc;
}
