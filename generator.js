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
  chip:  [154, 176, 165], // #9AB0A5 цвет выделения дат/законов
};
/* severity → [подпись, цвет] */
const SEV = {
  high: ['КРИТИЧНО', P.red],
  mid:  ['ВНИМАНИЕ', P.amber],
  low:  ['НОРМА',    P.lime],
};
/* карта заголовок→ключ иконки (window.PUMA_ICONMAP) */
const ICONMAP = (typeof window!=='undefined' && window.PUMA_ICONMAP) || {titleKey:{}, groupKey:{}};

/* делит длинный текст на абзацы, не ломая сокращения (ст., п., №), номера законов и т.п. */
function splitParagraphs(text){
  const s = String(text).trim();
  if(s.length < 240) return [s];
  const MK = String.fromCharCode(1);
  // 1) вырезаем <code>…</code> в плейсхолдеры, чтобы их не резал сплиттер предложений
  const codes = [];
  let work = s.replace(/<code>[\s\S]*?<\/code>/g, function(m){ codes.push(m); return String.fromCharCode(2)+(codes.length-1)+String.fromCharCode(3); });
  let masked = work.replace(/(^|[\s(«"'])(ст|стт|пп|п|ч|гл|абз|рис|табл|см|г|гг|руб|тыс|млн|млрд)\.(?=\s|\d)/gi,
                         function(m,pre,ab){ return pre+ab+MK; });
  masked = masked.replace(/\bт\.([едпк])\./gi, function(m,x){ return 'т'+MK+x+MK; });
  masked = masked.replace(/(\d)\.(\d)/g, '$1'+MK+'$2');
  const sentences = masked.match(/[^.!?]+[.!?]+[)»"']*\s*/g) || [masked];
  if(sentences.length <= 2) return [restore(s)];
  const out=[]; let buf='';
  sentences.forEach(function(sent,i){
    buf += sent;
    if((i+1)%2===0){ out.push(buf.trim()); buf=''; }
  });
  if(buf.trim()) out.push(buf.trim());
  function restore(str){
    return str.split(MK).join('.')
      .replace(new RegExp(String.fromCharCode(2)+'(\\d+)'+String.fromCharCode(3),'g'), function(m,idx){ return codes[+idx]; });
  }
  return out.map(restore);
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

  /* ---- разметка <code>…</code> → чипы в потоке текста ----
     Токенизирует строку на обычный текст и «чипы» (моно, зелёная подложка).
     Возвращает массив токенов: {t:'text'|'chip', s:string}. */
  function tokenizeCode(str){
    const out = [];
    const re = /<code>([\s\S]*?)<\/code>/g;
    let last = 0, m;
    while((m = re.exec(str))){
      if(m.index > last) out.push({t:'text', s:str.slice(last, m.index)});
      out.push({t:'chip', s:m[1]});
      last = re.lastIndex;
    }
    if(last < str.length) out.push({t:'text', s:str.slice(last)});
    return out;
  }

  /* Рендер абзаца с чипами. Чип = моноширинный на тёмной подложке #222A26.
     Межбуквенное сжато лёгким charSpace, межсловное — в 1.5 раза меньше. */
  function paraRich(str, {x=M.l, w=CW, size=9.4, color=P.body, lh=4.7}={}){
    const CS = -(size*0.3528)*0.012;        // лёгкое сжатие межбуквенного (~-1.2%)
    doc.setCharSpace(CS);
    const S = String(str);
    // нет тегов — один нативный проход (с тем же CS для единообразия)
    if(S.indexOf('<code>') === -1){
      doc.setFont('Gilroy','normal'); doc.setFontSize(size); doc.setTextColor(...color);
      const lines = doc.splitTextToSize(S, w);
      lines.forEach(ln=>{ need(lh+1); doc.text(ln, x, y); y += lh; });
      doc.setCharSpace(0);
      return y;
    }
    const tokens = tokenizeCode(S);
    const units = [];
    tokens.forEach(tok=>{
      if(tok.t==='text'){
        tok.s.split(/(\s+)/).forEach(p=>{ if(p!=='') units.push({chip:false, s:p}); });
      } else {
        units.push({chip:true, s:tok.s.trim()});   // чип — цельный блок (моно)
      }
    });
    const chipPadX = 1.4;
    const chipFS = Math.max(6.5, size - 1.0);       // моно чуть меньше наборного
    doc.setFont('Gilroy','normal'); doc.setFontSize(size); doc.setCharSpace(CS);
    const spaceW = doc.getTextWidth(' ') / 1.5;      // межсловное в 1.5 раза меньше
    const wWord = (s)=>{ doc.setFont('Gilroy','normal'); doc.setFontSize(size); doc.setCharSpace(CS); return doc.getTextWidth(s); };
    const wChip = (s)=>{ doc.setFont('JBMono','normal'); doc.setFontSize(chipFS); doc.setCharSpace(0); return doc.getTextWidth(s) + chipPadX*2; };
    let cx = x, first = true;
    need(lh+1);
    for(let i=0;i<units.length;i++){
      const u = units[i];
      const uw = u.chip ? wChip(u.s) : wWord(u.s);
      const gap = first ? 0 : spaceW;
      if(cx + gap + uw > x + w && !first){ y += lh; cx = x; need(lh+1); first = true; }
      else if(!first){ cx += spaceW; }
      if(u.chip){
        const h = chipFS*0.35 + 1.9;
        doc.setFillColor(...P.bg);
        doc.roundedRect(cx, y - chipFS*0.30 - 1.2, uw, h, 0.8, 0.8, 'F');
        doc.setFont('JBMono','normal'); doc.setFontSize(chipFS); doc.setTextColor(...P.chip); doc.setCharSpace(0);
        doc.text(u.s, cx + chipPadX, y);
      } else {
        doc.setFont('Gilroy','normal'); doc.setFontSize(size); doc.setTextColor(...color); doc.setCharSpace(CS);
        doc.text(u.s, cx, y);
      }
      cx += uw; first = false;
    }
    doc.setCharSpace(0);
    y += lh;
    return y;
  }

  /* измерение высоты paraRich без отрисовки */
  function measureRich(str, {w=CW, size=9.4, lh=4.7}={}){
    const CS = -(size*0.3528)*0.012;
    const S = String(str);
    if(S.indexOf('<code>') === -1){
      doc.setFont('Gilroy','normal'); doc.setFontSize(size); doc.setCharSpace(CS);
      const n = doc.splitTextToSize(S, w).length; doc.setCharSpace(0);
      return n * lh;
    }
    const tokens = tokenizeCode(S);
    const units = [];
    tokens.forEach(tok=>{
      if(tok.t==='text'){ tok.s.split(/(\s+)/).forEach(p=>{ if(p!=='') units.push({chip:false,s:p}); }); }
      else units.push({chip:true, s:tok.s.trim()});
    });
    const chipPadX=1.4, chipFS=Math.max(6.5, size-1.0);
    doc.setFont('Gilroy','normal'); doc.setFontSize(size); doc.setCharSpace(CS);
    const spaceW=doc.getTextWidth(' ')/1.5;
    const wOf=(u)=>{ if(u.chip){doc.setFont('JBMono','normal');doc.setFontSize(chipFS);doc.setCharSpace(0);return doc.getTextWidth(u.s)+chipPadX*2;} doc.setFont('Gilroy','normal');doc.setFontSize(size);doc.setCharSpace(CS);return doc.getTextWidth(u.s); };
    let cx=0, first=true, lines=1;
    for(const u of units){
      const uw=wOf(u); const gap=first?0:spaceW;
      if(cx+gap+uw> w && !first){ lines++; cx=uw; }
      else { cx+= (first?0:spaceW)+uw; }
      first=false;
    }
    doc.setCharSpace(0);
    return lines*lh;
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

  /* ---------------- ПОЛОСА РИСКА (шкала 0–100 с тремя зонами и меткой) ---------------- */
  {
    const barH = 3.2;                 // толщина полосы
    const gapTop = 8;                 // отступ сверху (после вердикта)
    need(gapTop + 20);
    y += gapTop;
    const bx = M.l, bw = CW;
    // границы зон: 0–29 зелёная, 30–54 оранжевая, 55–100 красная
    const b1 = 29/100, b2 = 54/100;
    const wG = bw*b1, wA = bw*(b2-b1), wR = bw*(1-b2);
    const r = barH/2;
    // сегменты (скруглены только на крайних концах)
    doc.setFillColor(...P.green);
    doc.roundedRect(bx, y, wG+ r, barH, r, r, 'F');
    doc.setFillColor(...P.amber);
    doc.rect(bx+wG, y, wA, barH, 'F');
    doc.setFillColor(...P.red);
    doc.roundedRect(bx+wG+wA - r, y, wR + r, barH, r, r, 'F');
    // перекрываем стыки, чтобы скругления не заходили на соседей
    doc.setFillColor(...P.amber); doc.rect(bx+wG, y, Math.min(r,wA), barH, 'F');
    doc.setFillColor(...P.amber); doc.rect(bx+wG+wA - Math.min(r,wA), y, Math.min(r,wA), barH, 'F');
    // подписи зон (mono, мелкие) под полосой
    doc.setFont('JBMono','normal'); doc.setFontSize(6); doc.setCharSpace(0);
    doc.setTextColor(...P.green); doc.text('0', bx, y+barH+3.4);
    doc.setTextColor(...P.mute);  doc.text('29', bx+wG, y+barH+3.4, {align:'center'});
    doc.setTextColor(...P.mute);  doc.text('54', bx+wG+wA, y+barH+3.4, {align:'center'});
    doc.setTextColor(...P.red);   doc.text('100', bx+bw, y+barH+3.4, {align:'right'});
    // метка текущего балла
    const sc = Math.max(0, Math.min(100, Number(data.score)||0));
    const mx = bx + bw*(sc/100);
    // вертикальная риска + кружок
    doc.setFillColor(...P.ink);
    const dotR = 2.2;
    doc.circle(mx, y+barH/2, dotR, 'F');
    doc.setFillColor(...vColor);
    doc.circle(mx, y+barH/2, dotR-0.9, 'F');
    // значение над меткой
    doc.setFont('Gilroy','bold'); doc.setFontSize(8.5); doc.setTextColor(...vColor);
    const scStr = String(sc);
    doc.text(scStr, mx, y-2.2, {align:'center'});
    y += barH + 6;
  }
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
    // высота тела с учётом чипов
    let bodyH = 0;
    const paraH = paras.map(p=>{
      const h = measureRich(p, {w:innerW, size:9.4, lh:4.7});
      bodyH += h + 3;
      return h;
    });
    bodyH -= 3;
    const headH = Math.max(BOX, titleLines.length*5.8);
    const HEAD_GAP = 9;                             // отступ шапка→тело (×1.5)
    const cardH = PAD + headH + HEAD_GAP + bodyH + PAD;
    need(cardH+3);
    const cardTop = y;
    // карточка
    doc.setFillColor(...P.card);
    doc.roundedRect(M.l, cardTop, CW, cardH, 4, 4, 'F');
    const innerX = M.l + PAD;
    // --- шапка карточки: контейнер иконки + заголовок + тег ---
    const headTop = cardTop + PAD;
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
    // заголовок — вертикально по ЦЕНТРУ контейнера иконки
    setF('Gilroy','bold', 12.5, P.ink);
    doc.setCharSpace(-0.1);
    const titleX = innerX + BOX + GAP;
    // центр блока строк заголовка совмещаем с центром BOX
    const lineStep = 5.8;
    const titleBlockH = titleLines.length*lineStep;
    const boxCenter = headTop + BOX/2;
    let ty0 = boxCenter - titleBlockH/2 + lineStep*0.72;  // 0.72 — базовая линия внутри строки
    titleLines.forEach(ln=>{ doc.text(ln, titleX, ty0); ty0 += lineStep; });
    doc.setCharSpace(0);
    // --- тело: на всю ширину, абзацами, с чипами ---
    y = headTop + headH + HEAD_GAP;
    paras.forEach((p,i)=>{
      paraRich(p, {x:innerX, w:innerW, size:9.4, color:P.body, lh:4.7});
      if(i<paras.length-1) y += 3;
    });
    // y сейчас у конца тела; выставим на конец карточки детерминированно
    y = cardTop + cardH + 3.5;
  }

  /* ---------------- ЧТО НАРУШАЕТСЯ И КОГДА ---------------- */
  section('Что нарушается и когда');
  const COL = 32;                    // ширина левой колонки (срок)
  const RCW = CW - COL;              // ширина правой колонки
  data.timeline.forEach(r=>{
    const whatH = measureRich(r.what, {w:RCW, size:9, lh:4.4});
    const consH = measureRich(r.cons, {w:RCW, size:8, lh:3.9});
    const rowH = Math.max(9, whatH + consH + 4);
    need(rowH+2);
    // левая колонка — срок как mono-тег (капсом)
    const whenCol = r.now ? P.red : P.amber;
    doc.setFont('JBMono','normal'); doc.setFontSize(7); doc.setTextColor(...whenCol);
    doc.setCharSpace(-(7*0.3528)*0.04);
    const whenLines = doc.splitTextToSize(String(r.when).toUpperCase(), COL-4);
    let wy = y+3;
    whenLines.forEach(ln=>{ doc.text(ln, M.l, wy); wy += 3.6; });
    doc.setCharSpace(0);
    // правая колонка — с чипами
    const rowTop = y;
    y = rowTop + 3;
    paraRich(r.what, {x:M.l+COL, w:RCW, size:9, color:P.ink, lh:4.4});
    paraRich(r.cons, {x:M.l+COL, w:RCW, size:8, color:P.mute, lh:3.9});
    // разделитель
    y = rowTop + rowH;
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
    const QHEAD_GAP = 8;                        // −25% к отступу «группа → пункты» (было 11)
    const qh = QPAD + QBOX + QHEAD_GAP + bodyH + QPAD;
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
    let qy = headTop + QBOX + QHEAD_GAP;
    const numX = ix + 0.7;                       // номер чуть правее (пара px)
    qLinesArr.forEach((L,i)=>{
      setF('Gilroy','normal', 9.4, P.body);
      doc.setTextColor(...P.lime);
      doc.text(String(i+1)+'.', numX, qy);
      doc.setTextColor(...P.body);
      L.forEach(ln=>{ doc.text(ln, numX+qIndent, qy); qy += 4.5; });
      qy += 2.6;
    });
    y += qh + 3.5;
  }

  /* ---------------- ЧЕК-ЛИСТ ---------------- */
  section('Чек-лист приёмки ответов');
  data.checklist.forEach(item=>{
    setF('Gilroy','normal', 9, P.ink);
    const lines = doc.splitTextToSize(item, CW-8);
    const lineStep = 4.8;                                   // чуть больше воздуха между пунктами
    const blockH = lines.length*lineStep;
    need(blockH+5);
    const rowTop = y;
    const fontSize = 9;
    const firstBaseline = rowTop + lineStep*0.72;           // базовая линия 1-й строки
    // оптический центр строки ≈ базовая линия минус ~треть кегля (в мм)
    const capMid = (fontSize*0.3528)*0.36;
    const boxSize = 3.4;
    const boxCenterY = firstBaseline - capMid;
    doc.setDrawColor(...P.lime); doc.setLineWidth(0.35);
    doc.roundedRect(M.l, boxCenterY - boxSize/2, boxSize, boxSize, 0.6, 0.6, 'D');
    // текст
    doc.setFont('Gilroy','normal'); doc.setFontSize(fontSize); doc.setTextColor(...P.ink);
    let ly = firstBaseline;
    lines.forEach(ln=>{ doc.text(ln, M.l+7, ly); ly += lineStep; });
    y = rowTop + blockH + 3.8;                              // зазор между пунктами
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
