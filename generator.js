/* ============================================================
   ПУМА Биллинг — генератор PDF-отчёта диагностики (СВЕТЛАЯ ТЕМА)
   jsPDF + svg2pdf. Шрифты: Gilroy Medium/Bold, JetBrains Mono.
   Логика берётся из logic_pure.js (reportData()).
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

/* --- палитра СВЕТЛОЙ темы (нейтральная шкала + бренд + состояния) --- */
const P = {
  bg:    [255, 255, 255], // #FFFFFF фон страницы (по требованию — чисто белый)
  card:  [244, 249, 246], // очень светлая подложка (для контейнера иконки/чипов)
  light: [245, 250, 248], // n-50 #F5FAF8 подложка карточки результата
  n75:   [237, 246, 242], // n-75 #EDF6F2
  lime:  [123, 211, 68],  // brand-500 #7BD344 — акцент, читаемый на белом
  ink:   [23, 24, 24],    // n-900 #171818 основной тёмный текст
  head:  [28, 33, 31],    // n-850 #1C211F — заголовки
  inkDark:[23, 24, 24],   // тёмный текст (на лайме/светлом)
  body:  [42, 52, 47],    // n-750 #2A342F наборный текст
  mute:  [102, 127, 115], // n-500 #667F73 приглушённый на белом
  muteL: [181, 206, 193], // n-300 #B5CEC1
  red:   [147, 42, 26],   // danger-700 #932A1A — читаемый акцент на белом
  amber: [168, 108, 13],  // warning-700 #A86C0D — читаемый акцент на белом
  green: [76, 144, 34],   // brand-600 #4C9022 норма/низкий
  hair:  [213, 231, 222], // n-200 #D5E7DE тонкие линии-разделители
  chip:  [42, 52, 47],    // текст чипа — тёмный (на светлой подложке)
  chipBg:[228, 241, 235], // n-100 #E4F1EB подложка ЧИПОВ в наборном тексте
  // теги состояний — цветные мягкие подложки (Danger/Warning/Success 150 / brand-100)
  redBg:  [248, 208, 203], // danger-150 #F8D1CB
  amberBg:[253, 229, 169], // warning-150 #FDE5A9
  greenBg:[214, 255, 188], // brand-100 #D6FFBC
};
/* severity → [подпись, цвет текста, цвет подложки тега] */
const SEV = {
  high: ['КРИТИЧНО', P.red,   P.redBg],
  mid:  ['ВНИМАНИЕ', P.amber, P.amberBg],
  low:  ['НОРМА',    P.green, P.greenBg],
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

  // no_tag: чипы в тексте рендерятся как Gilroy Bold того же кегля, без подложки.
  // По умолчанию ВКЛ. Отключить: data.noTag === false или window.PUMA_NO_TAG === false.
  const NO_TAG = (data && data.noTag === false) ? false
    : (typeof window !== 'undefined' && window.PUMA_NO_TAG === false) ? false
    : true;

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

  /* Типографика: приклеивает короткие предлоги/союзы (1–2 буквы) к следующему
     слову неразрывным пробелом, чтобы они не висели в конце строки.
     Работает и вне <code>…</code>, теги не трогает. */
  const NBSP = '\u00A0';
  function typo(str){
    return String(str).replace(
      /(^|[\s(«"])([а-яёa-z]{1,2}|из-за|из-под|для|под|при|над|про|без|как|что|это|его|её|их|над|обо)\s+/gi,
      (m, pre, w) => pre + w + NBSP
    );
  }
  /* разбивает текст на строки, склеивая висячие предлоги, затем возвращает
     обычные пробелы (глиф NBSP в шрифте шире — печатать его нельзя) */
  function splitTyped(txt, w){
    return doc.splitTextToSize(typo(txt), w).map(s => s.split(NBSP).join(' '));
  }

  /* многострочный абзац; charSpace задаёт letter-spacing */
  function para(txt, {font='Gilroy', style='normal', size=10, color=P.ink, lh=null, indent=0, cs=0}={}){
    const x = M.l + indent;
    setF(font, style, size, color);
    if(cs) doc.setCharSpace(cs);
    const lines = splitTyped(String(txt), CW - indent);
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
    doc.setCharSpace(0);
    const S = String(str);
    // нет тегов — один нативный проход
    if(S.indexOf('<code>') === -1){
      doc.setFont('Gilroy','normal'); doc.setFontSize(size); doc.setTextColor(...color);
      const lines = splitTyped(S, w);
      lines.forEach(ln=>{ need(lh+1); doc.text(ln, x, y); y += lh; });
      return y;
    }
    const chipPadX = 1.4;
    const chipFS = Math.max(6.5, size - 1.0);
    const rightEdge = x + w;
    let cx = x;                 // текущая позиция в строке
    let lineStarted = false;

    const spaceW = ()=>{ doc.setFont('Gilroy','normal'); doc.setFontSize(size); doc.setCharSpace(0); return doc.getTextWidth(' '); };
    const wordW  = s=>{ doc.setFont('Gilroy','normal'); doc.setFontSize(size); doc.setCharSpace(0); return doc.getTextWidth(s); };
    // ширина «чипа»: в no_tag — просто Gilroy Bold того же кегля, без подложки/паддинга
    const chipW  = s=> NO_TAG
      ? (doc.setFont('Gilroy','bold'), doc.setFontSize(size), doc.setCharSpace(0), doc.getTextWidth(s))
      : (doc.setFont('JBMono','normal'), doc.setFontSize(chipFS), doc.setCharSpace(0), doc.getTextWidth(s) + chipPadX*2);
    const newline = ()=>{ y += lh; cx = x; lineStarted = false; need(lh+1); };
    let lastOpen = false;   // последний видимый символ — открывающая скобка «([ и т.п.

    // печать текстового фрагмента цельными кусками (нативные пробелы),
    // с переносами; продолжает строку с текущего cx
    function drawText(text){
      // нормализуем пробелы, разбиваем на слова
      const words = text.split(/\s+/).filter(w=>w!=='');
      let i = 0;
      let runStart = true;    // самый первый прогон этого текстового токена
      while(i < words.length){
        // жадно набираем максимум слов, влезающих в остаток строки
        let line = '';
        let lineW = 0;
        // если строка уже начата — учитываем ведущий пробел перед первым словом
        let firstOnRun = true;
        while(i < words.length){
          const wd = words[i];
          // no_tag: не ставить ведущий пробел, если сразу после чипа идёт закрывающая
          // скобка/пунктуация (), ] . , ; :) — тогда первое слово примыкает вплотную
          const noLeadSpace = NO_TAG && line==='' && runStart && firstOnRun
            && /^[)\]»,.;:!?]/.test(wd);
          const lead = (line===''? ((lineStarted && firstOnRun && !noLeadSpace) ? spaceW() : 0) : spaceW());
          const add = lead + wordW(wd);
          if(cx + lineW + add > rightEdge && (line!=='' || lineStarted)){
            break;
          }
          if(line===''){
            if(lineStarted && firstOnRun && !noLeadSpace){ line = ' ' + wd; }
            else line = wd;
          } else {
            line += ' ' + wd;
          }
          lineW += add;
          firstOnRun = false;
          i++;
        }
        if(line!==''){
          doc.setFont('Gilroy','normal'); doc.setFontSize(size); doc.setTextColor(...color); doc.setCharSpace(0);
          doc.text(line, cx, y);
          cx += lineW;
          lineStarted = true;
          // запомнить, оканчивается ли напечатанное на открывающую скобку
          lastOpen = /[(\[«]$/.test(line.trimEnd());
        }
        runStart = false;
        if(i < words.length){ newline(); }   // ещё есть слова — перенос
      }
    }

    function drawChip(s){
      const cw = chipW(s);
      // no_tag: если прямо перед чипом открывающая скобка — без ведущего пробела
      const suppress = NO_TAG && lastOpen;
      const gap = (lineStarted && !suppress) ? spaceW() : 0;
      if(cx + gap + cw > rightEdge && lineStarted){ newline(); }
      else { cx += gap; }
      lastOpen = false;
      if(NO_TAG){
        // no_tag: жирный Gilroy того же размера, без подложки
        doc.setFont('Gilroy','bold'); doc.setFontSize(size); doc.setTextColor(...color); doc.setCharSpace(0);
        doc.text(s, cx, y);
        cx += cw; lineStarted = true;
        return;
      }
      const h = chipFS*0.35 + 1.9;
      doc.setFillColor(...P.chipBg);              // n-100 подложка, без обводки
      doc.roundedRect(cx, y - chipFS*0.30 - 1.2, cw, h, 0.8, 0.8, 'F');
      doc.setFont('JBMono','normal'); doc.setFontSize(chipFS); doc.setTextColor(...P.chip); doc.setCharSpace(0);
      doc.text(s, cx + chipPadX, y);
      cx += cw; lineStarted = true;
    }

    need(lh+1);
    tokenizeCode(S).forEach(tok=>{
      if(tok.t==='text') drawText(tok.s);
      else drawChip(tok.s.trim());
    });
    y += lh;
    return y;
  }

  /* измерение высоты paraRich без отрисовки */
  function measureRich(str, {w=CW, size=9.4, lh=4.7}={}){
    const S = String(str);
    if(S.indexOf('<code>') === -1){
      doc.setFont('Gilroy','normal'); doc.setFontSize(size); doc.setCharSpace(0);
      return splitTyped(S, w).length * lh;
    }
    const tokens = tokenizeCode(S);
    const units = [];
    tokens.forEach(tok=>{
      if(tok.t==='text'){ tok.s.split(/\s+/).forEach(p=>{ if(p!=='') units.push({chip:false,s:p}); }); }
      else units.push({chip:true, s:tok.s.trim()});
    });
    const chipPadX=1.4, chipFS=Math.max(6.5, size-1.0);
    doc.setFont('Gilroy','normal'); doc.setFontSize(size); doc.setCharSpace(0);
    const spaceW=doc.getTextWidth(' ');
    const wOf=(u)=>{ if(u.chip){ if(NO_TAG){doc.setFont('Gilroy','bold');doc.setFontSize(size);return doc.getTextWidth(u.s);} doc.setFont('JBMono','normal');doc.setFontSize(chipFS);return doc.getTextWidth(u.s)+chipPadX*2;} doc.setFont('Gilroy','normal');doc.setFontSize(size);return doc.getTextWidth(u.s); };
    let cx=0, first=true, lines=1;
    for(const u of units){
      const uw=wOf(u); const gap=first?0:spaceW;
      if(cx+gap+uw> w && !first){ lines++; cx=uw; }
      else { cx+= (first?0:spaceW)+uw; }
      first=false;
    }
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

  /* заголовок секции: крупный Gilroy Bold (без линии-разделителя).
     firstH — высота первого блока содержимого: заголовок не отрывается от него
     при переносе страницы (keep-with-next). */
  const SECTION_GAP_TOP = 7;                       // отступ между большими блоками
  const SECTION_HEAD_H = SECTION_GAP_TOP + 6 + 3;  // отступ + строка(15pt) + воздух
  function section(txt, firstH){
    need(SECTION_HEAD_H + (firstH||6));           // резервируем шапку + первый блок
    y += SECTION_GAP_TOP;
    setF('Gilroy','bold', 15, P.head);
    doc.setCharSpace(-0.2);
    doc.text(txt, M.l, y + 3.5);
    doc.setCharSpace(0);
    y += 6 + 3;                                    // строка заголовка(15pt) + воздух до контента
  }

  /* ---------------- ШАПКА ---------------- */
  const logoH = await drawLogo(doc, M.l, y, 34);
  // дата справа — Gilroy, без капса, с пояснением
  doc.setFont('Gilroy','normal'); doc.setFontSize(9); doc.setTextColor(...P.mute);
  doc.text('Отчёт сформирован ' + data.date, W - M.r, y + 5, {align:'right'});
  y += logoH + 9;   // ×1.5 промежуток шапка → заголовок

  // Заголовок отчёта
  setF('Gilroy','bold', 22, P.ink);
  doc.setCharSpace(-0.3);
  const titleLines = doc.splitTextToSize('Регуляторный статус СУБД под биллингом', CW);
  titleLines.forEach(ln=>{ doc.text(ln, M.l, y+7); y += 9; });
  doc.setCharSpace(0);
  y += 5.6;   // отступ ~16px между заголовком и подзагом
  // подзаголовок-пояснение
  para('Оценка одного компонента инсталляции — базы данных под биллингом — по ответам на пять вопросов.',
       {size:9.5, color:P.mute, lh:4.6});
  y += 1.5;   // подзаголовок прижат ближе вниз к плашке результата

  /* ---------------- ВЕРДИКТ (карточка со ВСТРОЕННЫМ графиком) ---------------- */
  const vColor = data.verdict.title.indexOf('Высок')>-1 ? P.red
              : data.verdict.title.indexOf('Повыш')>-1 ? P.amber : P.green;
  setF('Gilroy','normal', 9.5, P.ink);           // метрики ДО измерения
  const vBodyLines = splitTyped(data.verdict.text, CW - 40);
  // геометрия встроенного графика
  const barH2 = 3.2;                              // толщина полосы
  const barGapTop = 4.5;                            // текст вердикта → полоса
  const barZonesH = 4.5;                            // место под подписи зон
  const cardPadB = 2;                             // нижний внутренний отступ карточки
  const textBlockH = 26 + vBodyLines.length*4.6;  // прежняя высота текстовой части
  const vH = textBlockH + barGapTop + barH2 + barZonesH + cardPadB;
  need(vH);
  const cardTop = y;
  // карточка-вердикт (светлая плашка n-50 с цветной левой полосой)
  doc.setFillColor(...P.light);
  doc.roundedRect(M.l, cardTop, CW, vH, 3, 3, 'F');
  doc.setFillColor(...vColor);
  doc.roundedRect(M.l, cardTop, 2.4, vH, 1, 1, 'F');
  // eyebrow mono
  doc.setFont('JBMono','normal'); doc.setFontSize(7.5); doc.setTextColor(...P.mute);
  doc.setCharSpace(0.4);
  doc.text('РЕЗУЛЬТАТ ДИАГНОСТИКИ', M.l+8, cardTop+8);
  doc.setCharSpace(0);
  // балл справа
  setF('Gilroy','bold', 30, vColor);
  doc.text(String(data.score), W-M.r-6, cardTop+16, {align:'right'});
  doc.setFont('JBMono','normal'); doc.setFontSize(7); doc.setTextColor(...P.mute);
  doc.text('из 100 риск', W-M.r-6, cardTop+21, {align:'right'});
  // заголовок вердикта
  setF('Gilroy','bold', 17, P.head);
  doc.setCharSpace(-0.2);
  doc.text(data.verdict.title, M.l+8, cardTop+16);
  doc.setCharSpace(0);
  // текст вердикта
  setF('Gilroy','normal', 9.5, P.body);
  let vy = cardTop+22;
  vBodyLines.forEach(ln=>{ doc.text(ln, M.l+8, vy); vy += 4.6; });

  /* --- ПОЛОСА РИСКА внутри карточки --- */
  {
    const bx = M.l + 8, bw = CW - 8 - 8;           // внутренние отступы карточки
    let by = cardTop + textBlockH + barGapTop;     // ниже текстового блока
    const b1 = 29/100, b2 = 54/100;
    const wG = bw*b1, wA = bw*(b2-b1), wR = bw*(1-b2);
    const r = barH2/2;
    doc.setFillColor(...P.green);
    doc.roundedRect(bx, by, wG+r, barH2, r, r, 'F');
    doc.setFillColor(...P.amber);
    doc.rect(bx+wG, by, wA, barH2, 'F');
    doc.setFillColor(...P.red);
    doc.roundedRect(bx+wG+wA - r, by, wR + r, barH2, r, r, 'F');
    doc.setFillColor(...P.amber); doc.rect(bx+wG, by, Math.min(r,wA), barH2, 'F');
    doc.setFillColor(...P.amber); doc.rect(bx+wG+wA - Math.min(r,wA), by, Math.min(r,wA), barH2, 'F');
    // подписи зон под полосой
    doc.setFont('JBMono','normal'); doc.setFontSize(6); doc.setCharSpace(0);
    doc.setTextColor(...P.green); doc.text('0', bx, by+barH2+3.4);
    doc.setTextColor(...P.mute);  doc.text('29', bx+wG, by+barH2+3.4, {align:'center'});
    doc.setTextColor(...P.mute);  doc.text('54', bx+wG+wA, by+barH2+3.4, {align:'center'});
    doc.setTextColor(...P.red);   doc.text('100', bx+bw, by+barH2+3.4, {align:'right'});
    // метка текущего балла
    const sc = Math.max(0, Math.min(100, Number(data.score)||0));
    const mx = bx + bw*(sc/100);
    doc.setFillColor(...P.ink);
    const dotR = 2.2;
    doc.circle(mx, by+barH2/2, dotR, 'F');
    doc.setFillColor(...vColor);
    doc.circle(mx, by+barH2/2, dotR-0.9, 'F');
    // значение над меткой
    doc.setFont('Gilroy','bold'); doc.setFontSize(8.5); doc.setTextColor(...vColor);
    doc.text(String(sc), mx, by-2.2, {align:'center'});
  }
  y = cardTop + vH + 2;
  /* ---------------- ВАШИ ОТВЕТЫ (две колонки: вопрос слева, ответ справа Bold) ---------------- */
  const QCOL = Math.round(CW*0.54);      // ширина левой колонки (вопрос)
  const ACOL = CW - QCOL - 6;            // ширина правой колонки (ответ), 6мм зазор
  const AX   = M.l + QCOL + 6;           // левый край правой колонки
  // keep-with-next: высота первой строки ответов
  let ansFirstH = 8;
  if(data.answersRows[0]){
    setF('Gilroy','normal', 9, P.mute);
    const q0 = splitTyped(data.answersRows[0].q, QCOL);
    setF('Gilroy','bold', 9, P.ink);
    const a0 = splitTyped(data.answersRows[0].a, ACOL);
    ansFirstH = Math.max(q0.length, a0.length)*4.6 + 3;
  }
  section('Ваши ответы', ansFirstH);
  data.answersRows.forEach((r,i)=>{
    // измеряем обе колонки, высота строки = максимум
    setF('Gilroy','normal', 9, P.mute);
    const qLines = splitTyped(r.q, QCOL);
    setF('Gilroy','bold', 9, P.ink);
    const aLines = splitTyped(r.a, ACOL);
    const step = 4.6;
    const rowH = Math.max(qLines.length, aLines.length)*step;
    need(rowH + 3);
    const base = y + step*0.72;
    // вопрос
    setF('Gilroy','normal', 9, P.mute);
    let qy = base; qLines.forEach(ln=>{ doc.text(ln, M.l, qy); qy += step; });
    // ответ (Bold, правая колонка)
    setF('Gilroy','bold', 9, P.ink);
    let ay = base; aLines.forEach(ln=>{ doc.text(ln, AX, ay); ay += step; });
    y += rowH + 3;
    // тонкий разделитель между строками (кроме последней)
    if(i < data.answersRows.length-1){
      doc.setDrawColor(...P.hair); doc.setLineWidth(0.15);
      doc.line(M.l, y-1.4, M.l+CW, y-1.4);
    }
  });

  /* ---------------- ЧТО ПОКАЗЫВАЕТ ДИАГНОСТИКА (плоский список) ----------------
     Формат: тег критичности → заголовок Bold → текст → тонкая линия-разделитель. */
  // mono-тег severity на мягкой цветной подложке; возвращает высоту тега
  function sevTag(label, fg, bg, x, yTop){
    doc.setFont('JBMono','normal'); doc.setFontSize(7.2);
    doc.setCharSpace(-(7.2*0.3528)*0.02);
    const tw = doc.getTextWidth(label);
    const padX = 2.4, h = 5.6;
    doc.setFillColor(...bg);
    doc.roundedRect(x, yTop, tw + padX*2, h, 1.4, 1.4, 'F');
    doc.setTextColor(...fg);
    doc.text(label, x + padX, yTop + 3.9);
    doc.setCharSpace(0);
    return h;
  }
  // keep-with-next: высота тега + заголовка + первого абзаца первого finding
  function findingHeadH(f){
    setF('Gilroy','bold', 10.5, P.head);
    const tl = splitTyped(f.title, CW).length*5.2;
    const p0 = splitParagraphs(f.body)[0] || '';
    const bh = measureRich(p0, {w:CW, size:8.4, lh:4.4});
    return 5.6 + 3 + tl + 3 + bh;   // тег + gap + заголовок + gap + 1-й абзац
  }
  // полная высота finding (тег + заголовок + все абзацы) — чтобы не дробить блок
  function findingFullH(f){
    setF('Gilroy','bold', 10.5, P.head);
    const tl = splitTyped(f.title, CW).length*5.2;
    const paras = splitParagraphs(f.body);
    let bh = 0;
    paras.forEach((p,i)=>{ bh += measureRich(p, {w:CW, size:8.4, lh:4.4}) + (i<paras.length-1?3:0); });
    return 5.6 + 3.4 + tl + 3.2 + bh;   // тег + gap + заголовок + gap + все абзацы
  }
  section('Что показывает диагностика', data.findings[0] ? findingFullH(data.findings[0]) : 8);
  const TAG_GAP = 3.4;       // тег → заголовок
  const TITLE_GAP = 6;       // заголовок → текст (визуально равный тег→заголовок)
  const pageInnerH0 = H - M.t - M.b;
  data.findings.forEach((f, idx)=>{
    const [label, col, bg] = SEV[f.sev];
    const paras = splitParagraphs(f.body);
    // keep-together: если finding влезает на страницу целиком — переносим целиком;
    // иначе (аномально длинный) держим тег + заголовок + первый абзац
    const fullH = findingFullH(f);
    if(fullH <= pageInnerH0){
      need(fullH + 2);
    } else {
      need(findingHeadH(f) + 2);
    }
    // тег
    y += sevTag(label, col, bg, M.l, y) + TAG_GAP;
    // заголовок Bold
    setF('Gilroy','bold', 10.5, P.head);
    doc.setCharSpace(-0.1);
    const titleLines = splitTyped(f.title, CW);
    titleLines.forEach(ln=>{ need(5.2+1); doc.text(ln, M.l, y+3.6); y += 5.2; });
    doc.setCharSpace(0);
    y += TITLE_GAP;
    // текст абзацами (с чипами)
    paras.forEach((p,i)=>{
      paraRich(p, {x:M.l, w:CW, size:8.4, color:P.body, lh:4.4});
      if(i<paras.length-1) y += 3;
    });
    // тонкая линия-разделитель (n-200) в блоке findings
    if(idx < data.findings.length-1){
      y -= 2;                                     // текст → линия: в 2 раза ближе
      doc.setDrawColor(...P.hair); doc.setLineWidth(0.15);
      doc.line(M.l, y, M.l+CW, y);
      y += 5.3;                                   // линия → следующий тег: ÷1.5 (было 8)
    } else {
      y += 3;
    }
  });

  /* ---------------- ЧТО НАРУШАЕТСЯ И КОГДА ---------------- */
  const COL = 32;                    // ширина левой колонки (срок)
  const RCW = CW - COL;              // ширина правой колонки
  // keep-with-next: высота первой строки timeline
  let tlFirstH = 10;
  if(data.timeline[0]){
    const w0 = measureRich(data.timeline[0].what, {w:RCW, size:9, lh:4.4});
    const c0 = measureRich(data.timeline[0].cons, {w:RCW, size:8, lh:3.9});
    tlFirstH = Math.max(9, w0 + c0 + 4) + 3;
  }
  section('Что нарушается и когда', tlFirstH);
  data.timeline.forEach((r, idx)=>{
    const whatH = measureRich(r.what, {w:RCW, size:9, lh:4.4});
    const consH = measureRich(r.cons, {w:RCW, size:8, lh:3.9});
    const rowH = Math.max(9, whatH + consH + 2.5);
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
    // разделитель между строками (кроме последней)
    y = rowTop + rowH;
    if(idx < data.timeline.length-1){
      doc.setDrawColor(...P.hair); doc.setLineWidth(0.15);
      doc.line(M.l, y, M.l+CW, y);
    }
    y += 1.5;
  });

  /* ---------------- ВОПРОСЫ, КОТОРЫЕ СТОИТ ЗАДАТЬ (плоский список) ----------------
     Формат: название группы (mono, зелёный) → нумерованные вопросы → разделитель. */
  const qIndent = 6;
  // полная высота группы (название + все вопросы) — чтобы не дробить блок
  function groupFullH(g){
    setF('Gilroy','normal', 9.4, P.body);
    let h = 11;                                     // строка названия + воздух
    g.qs.forEach(q=>{ h += splitTyped(q, CW - qIndent).length*4.6 + 2.4; });
    return h;
  }
  section('Вопросы, которые стоит задать', data.groups[0] ? groupFullH(data.groups[0]) : 8);
  const pageInnerH = H - M.t - M.b;                 // полезная высота страницы
  data.groups.forEach((g, gi)=>{
    // keep-together: если группа целиком влезает на страницу — переносим её целиком;
    // иначе (аномально длинная) держим хотя бы название + первый вопрос
    const fullH = groupFullH(g);
    if(fullH <= pageInnerH){
      need(fullH + 2);
    } else {
      setF('Gilroy','normal', 9.4, P.body);
      const first = g.qs[0] ? splitTyped(g.qs[0], CW-qIndent).length*4.6 : 0;
      need(11 + first + 2);
    }
    // название группы — mono, зелёный (brand-600), капс
    doc.setFont('JBMono','normal'); doc.setFontSize(8.6);
    doc.setCharSpace(-(8.6*0.3528)*0.02);
    doc.setTextColor(...P.green);
    doc.text(g.who.toUpperCase(), M.l, y+3.5);
    doc.setCharSpace(0);
    y += 11;                                       // больше воздуха: название группы → первый вопрос
    // вопросы
    const numX = M.l + 0.4;
    g.qs.forEach((q,i)=>{
      setF('Gilroy','normal', 9.4, P.body);
      const L = splitTyped(q, CW - qIndent);
      need(L.length*4.6 + 1);
      doc.setTextColor(...P.green);
      doc.text(String(i+1)+'.', numX, y);
      doc.setTextColor(...P.body);
      L.forEach(ln=>{ doc.text(ln, numX+qIndent, y); y += 4.6; });
      y += 1.2;                                    // между пунктами: в 2 раза меньше (было 2.4)
    });
    // разделитель между группами (n-200) — прижат к концу текста группы
    if(gi < data.groups.length-1){
      y -= 2.5;                                     // текст → линия: в 2+ раза ближе (красное)
      doc.setDrawColor(...P.hair); doc.setLineWidth(0.15);
      doc.line(M.l, y, M.l+CW, y);
      y += 5;                                       // линия → следующий заголовок сохранено (фиолетовое)
    } else {
      y += 2.5;
    }
  });

  /* ---------------- ЧЕК-ЛИСТ ---------------- */
  let clFirstH = 8;
  if(data.checklist[0]){
    setF('Gilroy','normal', 9, P.ink);
    clFirstH = splitTyped(data.checklist[0], CW-8).length*4.3 + 5;
  }
  section('Чек-лист приёмки ответов', clFirstH);
  data.checklist.forEach(item=>{
    setF('Gilroy','normal', 9, P.ink);
    const lines = splitTyped(item, CW-8);
    const lineStep = 4.3;                                   // чуть больше воздуха между пунктами
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
    y = rowTop + blockH + 2.8;                              // зазор между пунктами (÷1.5 от 3.8)
  });

  /* ---------------- ОГОВОРКА + КОНТАКТЫ ---------------- */
  y += SECTION_GAP_TOP;                            // отступ как между большими блоками
  need(22);
  doc.setDrawColor(...P.hair); doc.setLineWidth(0.15); doc.line(M.l, y, M.l+CW, y); y += 5;
  para('Это оценка одного компонента, а не полное регуляторное заключение и не юридический документ. Отчёт не оценивает вашего поставщика и не содержит рекомендаций по выбору решения. Ссылки на нормы приведены для самостоятельной проверки.',
       {size:8.4, color:P.mute, lh:4});
  y += 3;
  setF('Gilroy','bold', 9, P.green);
  const brandStr = 'ПУМА Биллинг';
  doc.text(brandStr, M.l, y);
  const brandW = doc.getTextWidth(brandStr);
  setF('Gilroy','normal', 9, P.mute);
  doc.text('— BSS/OSS и MVNE-платформа. Готовы разобрать вашу конфигурацию предметно.', M.l+brandW+1.6, y);
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
