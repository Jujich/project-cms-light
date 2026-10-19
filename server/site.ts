import type { Integration, SiteContent, SiteFiles, SiteSection } from '../shared/types.ts';

type RenderOptions = { preview: boolean; formToken?: string; formBase?: string; exported?: boolean };

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeUrl(value: string | undefined, fallback = '#'): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(trimmed) ? escapeHtml(trimmed) : fallback;
}

// HTML is an editable markup surface. Active code belongs in the separately
// editable script.js, which executes only on the site's isolated origin.
function cleanCustomHtml(value: string): string {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<\/?(?:base|meta)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src|action)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '');
}

const interiorSvg = `<svg class="interior-art" viewBox="0 0 1100 670" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Солнечная гостиная с мягким диваном, круглым столом и оливковым деревом">
<defs><linearGradient id="wall" x2="1" y2="1"><stop stop-color="#eee6d6"/><stop offset="1" stop-color="#c7b99e"/></linearGradient><linearGradient id="floor" x2=".1" y2="1"><stop stop-color="#c4b296"/><stop offset="1" stop-color="#e3d3b8"/></linearGradient><linearGradient id="sofa" y2="1" x2="0"><stop stop-color="#c7bea9"/><stop offset="1" stop-color="#a39a82"/></linearGradient><linearGradient id="vase"><stop stop-color="#785c3d"/><stop offset=".5" stop-color="#a78d66"/><stop offset="1" stop-color="#695036"/></linearGradient><filter id="blur"><feGaussianBlur stdDeviation="13"/></filter><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".65" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".045"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs>
<g filter="url(#grain)"><path fill="url(#wall)" d="M0 0h1100v465H0z"/><path fill="#d8cbb4" d="M0 0h215v465H0z"/><path fill="url(#floor)" d="M0 465h1100v205H0z"/><path d="M0 465h1100" stroke="#bba889" stroke-width="3"/>
<path fill="#f3ecd9" d="M20 10h170v400H20z"/><path fill="#d2d3bb" d="M35 24h141v368H35z"/><path fill="#e5e4cb" d="M35 210h141v182H35z"/><path d="M105 20v381M25 210h160" stroke="#f9f1df" stroke-width="12"/><path d="M0 66L94 0h54L0 108zm0 180L188 94v59L0 291zm0 191L188 277v55L0 481z" fill="#fff9df" opacity=".47"/>
<path fill="#b6a58a" d="M687 0h14v467h-14z"/><path fill="#d0c2a7" d="M701 0h399v465H701z"/><path d="M1028 0v464" stroke="#a99476" stroke-width="5"/><rect x="358" y="76" width="176" height="213" fill="#b4a080"/><rect x="367" y="85" width="158" height="195" fill="#eee7d8"/><path d="M387 254V133a41 41 0 0 1 82 0v121" fill="#b5aa8a"/><path d="M430 254V170a37 37 0 0 1 74 0v84" fill="#716b55"/><path d="M387 242h117" stroke="#e7dbc1" stroke-width="3"/>
<ellipse cx="513" cy="548" rx="378" ry="55" fill="#665c42" opacity=".16" filter="url(#blur)"/><path d="M74 563l613-74 270 124-595 57z" fill="#dbd1b9"/><path d="M92 570l593-68 244 111-569 49z" fill="#d5c9ae" stroke="#e3d9c4" stroke-width="3"/>
<rect x="208" y="377" width="449" height="118" rx="30" fill="#928b76"/><rect x="195" y="371" width="222" height="108" rx="27" fill="url(#sofa)"/><rect x="419" y="371" width="222" height="108" rx="27" fill="url(#sofa)"/><rect x="159" y="440" width="526" height="91" rx="25" fill="#aaa28b"/><path d="M187 468h472v29H187z" fill="#b9b09a"/><rect x="156" y="416" width="60" height="112" rx="21" fill="#b9af96"/><rect x="631" y="416" width="60" height="112" rx="21" fill="#b1a58b"/><path d="M194 527v20m460-20v20" stroke="#655a44" stroke-width="11"/><path d="M238 386l76-9 15 65-77 10z" fill="#dbceb6"/><path d="M545 391l60 8-10 57-63-9z" fill="#7c7259"/>
<ellipse cx="563" cy="582" rx="114" ry="28" fill="#7b674a" opacity=".2"/><path d="M486 528l-13 62m155-62l17 64m-82-61v78" stroke="#69523a" stroke-width="11"/><ellipse cx="561" cy="523" rx="119" ry="37" fill="#7d6042"/><ellipse cx="561" cy="517" rx="119" ry="35" fill="#947454"/><path d="M522 503l48-9 35 12-51 10z" fill="#e4d8bd"/><path d="M522 503v5l32 13 51-11v-4l-51 10z" fill="#c6b89b"/><ellipse cx="619" cy="509" rx="15" ry="6" fill="#5c4c39"/><path d="M607 505l3-21h16l4 21z" fill="#c8b58c"/>
<path d="M879 445l-5-169m4 96l-47-61m46 16l44-87m-44 56l-51-78m49 60l9-98" stroke="#69654b" stroke-width="6" fill="none"/><g fill="#717357"><ellipse cx="824" cy="232" rx="30" ry="16" transform="rotate(31 824 232)"/><ellipse cx="846" cy="274" rx="28" ry="14" transform="rotate(-20 846 274)"/><ellipse cx="827" cy="313" rx="30" ry="15" transform="rotate(23 827 313)"/><ellipse cx="885" cy="202" rx="15" ry="30" transform="rotate(18 885 202)"/><ellipse cx="920" cy="243" rx="33" ry="15" transform="rotate(-36 920 243)"/><ellipse cx="911" cy="282" rx="24" ry="13" transform="rotate(15 911 282)"/><ellipse cx="874" cy="250" rx="26" ry="13" transform="rotate(-29 874 250)"/><ellipse cx="852" cy="341" rx="25" ry="13" transform="rotate(26 852 341)"/></g><path d="M839 428h79l-9 96q-30 18-60 0z" fill="url(#vase)"/><ellipse cx="879" cy="428" rx="40" ry="10" fill="#685540"/><path d="M877 425v-35" stroke="#6a6148" stroke-width="6"/>
<path fill="#f9edce" opacity=".36" d="M0 485l172-20 423 205H357z"/><path fill="#fff1d0" opacity=".24" d="M0 562l73-16 253 124H170z"/><path d="M1100 0v670h-28V0" fill="#8c7960" opacity=".2"/></g></svg>`;

function renderField(field: NonNullable<SiteSection['fields']>[number]): string {
  const id = escapeHtml(field.name);
  const required = field.required ? ' required' : '';
  const label = escapeHtml(field.label);
  const type = ['text', 'email', 'tel'].includes(field.type) ? field.type : 'text';
  return `<label class="form-field"><span>${label}${field.required ? ' <span aria-hidden="true">*</span>' : ''}</span>${field.type === 'textarea' ? `<textarea name="${id}" rows="3" placeholder="${label}"${required}></textarea>` : `<input name="${id}" type="${type}" placeholder="${label}"${required}>`}</label>`;
}

function renderSection(section: SiteSection, index: number, options: RenderOptions): string {
  const attrs = `id="${escapeHtml(section.id)}" data-section-id="${escapeHtml(section.id)}" data-section-type="${escapeHtml(section.type)}"`;
  const title = escapeHtml(section.title);
  const subtitle = section.subtitle ? `<p class="eyebrow">${escapeHtml(section.subtitle)}</p>` : '';
  const body = section.body ? `<p class="section-body">${escapeHtml(section.body).replace(/\n/g, '<br>')}</p>` : '';
  if (section.type === 'hero') {
    return `<section ${attrs} class="hero"><div class="hero-intro">${subtitle}<h1>${title}</h1><div class="hero-bottom">${body}${section.buttonText ? `<a class="round-link" href="${safeUrl(section.buttonUrl, '#contact')}"><span>${escapeHtml(section.buttonText)}</span><span class="arrow-circle" aria-hidden="true">↗</span></a>` : ''}</div></div><div class="hero-image">${section.image ? `<img src="${safeUrl(section.image)}" alt="${title}" fetchpriority="high">` : interiorSvg}<div class="image-caption"><span>ДОМ, В КОТОРОМ ХОЧЕТСЯ ЖИТЬ</span><span>ЛИНИЯ / 2026</span></div></div><div class="hero-note"><span>Чувствовать. Создавать. Жить.</span><span>Москва · Работаем по всей России</span></div></section>`;
  }
  if (section.type === 'services') {
    return `<section ${attrs} class="services content-section"><div class="section-heading">${subtitle}<h2>${title}</h2>${body}</div><div class="service-grid">${(section.items ?? []).map((item, itemIndex) => `<article class="service-card"><span class="service-number">${String(itemIndex + 1).padStart(2, '0')}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.text)}</p><a href="#contact" aria-label="Обсудить ${escapeHtml(item.title)}">↗</a></article>`).join('')}</div></section>`;
  }
  if (section.type === 'form') {
    const action = options.exported && !options.formBase ? '#' : `${options.formBase ?? ''}/forms/${encodeURIComponent(section.id)}`;
    return `<section ${attrs} class="contact content-section"><div class="contact-copy">${subtitle}<h2>${title}</h2>${body}<div class="contact-detail">Каждый хороший проект начинается с разговора. ↗</div></div><form class="contact-form" data-forma-form="${escapeHtml(section.id)}" data-forma-preview="${options.preview}" data-forma-configured="${!options.exported || Boolean(options.formBase)}" method="post" action="${escapeHtml(action)}">${options.formToken ? `<input type="hidden" name="_formaToken" value="${escapeHtml(options.formToken)}">` : ''}${(section.fields ?? []).map(renderField).join('')}<button class="form-submit" type="submit">${escapeHtml(section.buttonText || 'Обсудить проект')} <span aria-hidden="true">↗</span></button><p class="form-note">Нажимая кнопку, вы отправляете указанные данные владельцу сайта для ответа на обращение.</p><p class="form-status" role="status" aria-live="polite"></p></form></section>`;
  }
  if (section.type === 'custom') {
    return `<section ${attrs} class="custom-section">${cleanCustomHtml(section.html ?? '')}</section>`;
  }
  return `<section ${attrs} class="text-section content-section"><div>${subtitle}<span class="text-marker" aria-hidden="true">${String(index + 1).padStart(2, '0')} —</span></div><div><h2>${title}</h2>${body}${section.buttonText ? `<a class="text-link" href="${safeUrl(section.buttonUrl, '#contact')}">${escapeHtml(section.buttonText)} ↗</a>` : ''}</div></section>`;
}

function renderContent(content: SiteContent, options: RenderOptions): string {
  const menu = content.sections.filter(section => section.type !== 'hero').slice(0, 3);
  return `<header class="site-header"><a class="wordmark" href="#" aria-label="${escapeHtml(content.name)} — главная">${escapeHtml(content.name)}<span class="wordmark-dot">®</span></a><nav aria-label="Главная навигация">${menu.map(section => `<a href="#${escapeHtml(section.id)}">${escapeHtml(section.type === 'services' ? 'Услуги' : section.type === 'form' ? 'Контакты' : section.subtitle || section.title)}</a>`).join('')}</nav><a class="header-cta" href="#contact">Обсудить проект <span aria-hidden="true">↗</span></a></header><main>${content.sections.map((section, index) => renderSection(section, index, options)).join('')}</main><footer class="site-footer"><a href="#" class="wordmark">${escapeHtml(content.name)}<span class="wordmark-dot">®</span></a><div><a href="${safeUrl('mailto:' + content.email)}">${escapeHtml(content.email)}</a><a href="${safeUrl('tel:' + content.phone.replace(/[^+\d]/g, ''))}">${escapeHtml(content.phone)}</a></div><span>© 2026 · Пространство для жизни</span></footer>`;
}

const baseStyles = `:root{--accent:#666c53;--ink:#272820;--muted:#747568;--paper:#f8f7f2;--line:#deded3;font-family:Arial,Helvetica,sans-serif;color:var(--ink);background:var(--paper);font-synthesis:none}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:28px}body{margin:0}button,input,textarea{font:inherit}a{color:inherit;text-decoration:none}button,a,input,textarea{-webkit-tap-highlight-color:transparent}a:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:5px}img,svg{display:block;max-width:100%}.site-header{margin:0 5.1%;height:91px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:24px}.wordmark{font-size:29px;font-weight:500;letter-spacing:-1.7px;display:inline-flex;align-items:flex-start}.wordmark-dot{font-size:10px;letter-spacing:0;margin:4px 0 0 3px}.site-header nav{display:flex;gap:25px;font-size:11px}.header-cta{font-size:10px;border-bottom:1px solid #9b9e8f;padding:8px 0;white-space:nowrap}.header-cta span{margin-left:16px}.hero{padding:0 5.1%}.hero-intro{padding:47px 0 32px}.eyebrow{font-size:9px;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted);margin:0 0 20px;line-height:1.6}.hero h1{font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:clamp(42px,6.9vw,88px);letter-spacing:-3px;line-height:1.04;max-width:810px;margin:0;text-wrap:balance}.hero-bottom{display:flex;align-items:flex-end;justify-content:space-between;gap:30px;margin-top:25px}.section-body{font-size:13px;line-height:1.8;color:var(--muted);max-width:440px;margin:0;white-space:normal}.hero .section-body{max-width:310px;font-size:11px;line-height:1.8}.round-link{display:flex;gap:19px;align-items:center;font-size:10px;flex-shrink:0}.arrow-circle{border:1px solid #b1b5a3;border-radius:50%;width:35px;height:35px;display:grid;place-items:center;font-size:18px}.round-link:hover .arrow-circle{background:var(--accent);color:white}.hero-image{position:relative;overflow:hidden;background:#d4c5ad;aspect-ratio:1.84}.hero-image>img,.hero-image>svg{width:100%;height:100%;object-fit:cover}.image-caption{position:absolute;left:20px;right:20px;bottom:17px;display:flex;justify-content:space-between;font-size:7px;letter-spacing:1.25px;color:#fff9e9;text-shadow:0 1px 6px #463d2c}.hero-note{display:flex;justify-content:space-between;font-size:8px;letter-spacing:.2px;color:var(--muted);padding:16px 0;border-bottom:1px solid var(--line)}.content-section{margin:0 5.1%;padding:70px 0}.section-heading{display:grid;grid-template-columns:1fr 1fr;gap:12px 35px;align-items:start}.section-heading .eyebrow{grid-column:1/-1;margin-bottom:3px}.section-heading h2{font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:36px;line-height:1.15;letter-spacing:-1.2px;margin:0}.section-heading .section-body{font-size:11px;max-width:275px;justify-self:end}.service-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:25px;margin-top:38px}.service-card{position:relative;border-top:1px solid #b7bbae;padding:18px 0 30px;min-height:180px}.service-number{font-size:9px;color:var(--muted)}.service-card h3{font-size:16px;font-weight:400;line-height:1.3;margin:24px 0 12px;letter-spacing:-.3px}.service-card p{font-size:10px;line-height:1.8;color:var(--muted);margin:0;max-width:220px}.service-card>a{position:absolute;bottom:0;right:0;font-size:19px}.text-section{border-top:1px solid var(--line);display:grid;grid-template-columns:1fr 2fr;gap:35px;padding:50px 0 65px}.text-section h2{font-family:Georgia,'Times New Roman',serif;font-size:37px;font-weight:400;letter-spacing:-1px;line-height:1.2;margin:0 0 20px;max-width:480px}.text-section .section-body{font-size:11px}.text-marker{font-family:Georgia,serif;font-size:38px;color:#b5b7a6}.text-link{display:inline-block;font-size:11px;border-bottom:1px solid var(--line);padding:10px 0;margin-top:15px}.contact{margin:0;padding:55px 5.1%;background:#eaece3;display:grid;grid-template-columns:1fr 1fr;gap:65px}.contact h2{font-family:Georgia,'Times New Roman',serif;font-size:37px;line-height:1.13;letter-spacing:-1px;font-weight:400;margin:0 0 20px}.contact .section-body{font-size:11px}.contact-detail{font-size:9px;color:var(--muted);margin-top:35px;max-width:180px;line-height:1.8}.contact-form{display:grid;gap:15px}.form-field{display:grid;gap:6px}.form-field>span{font-size:9px;color:#606655}.form-field input,.form-field textarea{width:100%;border:0;border-bottom:1px solid #b8bead;background:transparent;border-radius:0;padding:9px 0 12px;font-size:12px;outline:none;color:var(--ink);resize:vertical}.form-field input:focus,.form-field textarea:focus{border-color:var(--accent)}.form-field input::placeholder,.form-field textarea::placeholder{color:#858b79}.form-submit{cursor:pointer;background:var(--accent);color:white;border:none;padding:16px 18px;text-align:left;display:flex;justify-content:space-between;font-size:11px;margin-top:5px}.form-submit:hover{filter:brightness(.92)}.form-submit:disabled{opacity:.65;cursor:wait}.form-note{font-size:8px;line-height:1.6;color:#79816e;margin:0}.form-status{font-size:11px;line-height:1.6;margin:0}.form-status[data-state=error]{color:#a43e29}.form-status[data-state=success]{color:#44643c}.site-footer{display:flex;justify-content:space-between;align-items:flex-end;margin:0 5.1%;padding:38px 0;gap:25px}.site-footer>div{display:flex;flex-direction:column;gap:7px;font-size:10px}.site-footer>span{font-size:8px;color:var(--muted)}.custom-section{margin:0 5.1%;padding:35px 0}.custom-section h2{font-family:Georgia,serif;font-weight:400;font-size:36px}.custom-section img{height:auto}.custom-section p{line-height:1.7}@media(min-width:1200px){.site-header,.hero,.content-section,.site-footer,.custom-section{max-width:1280px;margin-left:auto;margin-right:auto}.site-header{width:89.8%}.hero{padding:0;width:89.8%}.content-section,.site-footer,.custom-section{width:89.8%}.contact{max-width:none;width:100%;padding-left:max(5.1%,calc((100% - 1280px)/2));padding-right:max(5.1%,calc((100% - 1280px)/2))}}@media(max-width:600px){.site-header{height:74px;gap:15px}.wordmark{font-size:26px}.site-header nav{display:none}.header-cta{font-size:9px}.hero-intro{padding:34px 0 25px}.hero h1{font-size:46px;letter-spacing:-2px}.eyebrow{font-size:8px;letter-spacing:1.2px;margin-bottom:18px}.hero-bottom{align-items:flex-start;flex-direction:column;gap:20px;margin-top:20px}.hero .section-body{font-size:11px;max-width:290px}.hero-image{aspect-ratio:1.15}.hero-image>svg{width:160%;max-width:none;transform:translateX(-18%)}.image-caption{left:12px;right:12px;bottom:12px;font-size:5px}.hero-note{font-size:7px;gap:15px;line-height:1.6}.hero-note span:last-child{text-align:right;max-width:140px}.content-section{padding-top:45px;padding-bottom:45px}.section-heading{grid-template-columns:1fr;gap:15px}.section-heading .section-body{justify-self:start;max-width:none}.section-heading h2{font-size:33px}.service-grid{grid-template-columns:1fr;gap:16px;margin-top:28px}.service-card{min-height:140px;padding-top:14px;padding-left:40px}.service-number{position:absolute;left:0;top:18px}.service-card h3{margin-top:0;font-size:19px}.service-card p{font-size:11px;max-width:85%}.service-card>a{bottom:20px}.text-section{grid-template-columns:1fr;gap:15px}.text-section>div:first-child{display:flex;align-items:center;justify-content:space-between}.text-section .eyebrow{margin:0}.text-marker{font-size:25px}.text-section h2{font-size:32px}.contact{grid-template-columns:1fr;gap:30px;margin:0;padding:40px 5.1%}.contact-detail{display:none}.contact h2{font-size:34px}.form-field input,.form-field textarea{font-size:16px}.site-footer{flex-wrap:wrap;padding:30px 0;gap:25px}.site-footer>span{width:100%;font-size:9px}.site-footer>div{font-size:11px}.custom-section{padding:25px 0}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`;

const formRuntime = `document.addEventListener('submit', async function(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches('[data-forma-form]')) return;
  event.preventDefault();
  const status = form.querySelector('.form-status');
  if (!status) return;
  if (form.dataset.formaPreview === 'true') { status.textContent = 'Это предпросмотр. Заявки принимаются после публикации.'; status.dataset.state = 'info'; return; }
  if (form.dataset.formaConfigured === 'false') { status.textContent = 'Форма пока не подключена. Свяжитесь с нами по контактам внизу страницы.'; status.dataset.state = 'error'; return; }
  if (!form.reportValidity()) return;
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  status.textContent = 'Отправляем…'; status.dataset.state = 'loading';
  try {
    const response = await fetch(form.action, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.fromEntries(new FormData(form))), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw new Error(result.error || 'Не удалось отправить заявку. Попробуйте ещё раз.');
    status.textContent = 'Спасибо! Мы получили вашу заявку и скоро свяжемся с вами.'; status.dataset.state = 'success'; form.reset();
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'Не удалось отправить заявку.'; status.dataset.state = 'error'; }
  finally { if (button) button.disabled = false; }
});`;

const previewRuntime = `(() => {
  const style = document.createElement('style');
  style.textContent = '[data-section-id]{position:relative}[data-section-id]:hover{outline:2px solid #73905a;outline-offset:-2px}[data-section-id]:hover::after{content:"Нажмите, чтобы редактировать";position:absolute;right:7px;top:7px;background:#32472c;color:#fff;padding:6px 9px;font:10px Arial;pointer-events:none;z-index:999}';
  document.head.appendChild(style);
  document.addEventListener('click', function(event) {
    if (!(event.target instanceof Element)) return;
    const section = event.target.closest('[data-section-id]');
    if (section) window.parent.postMessage({type:'forma:select',sectionId:section.dataset.sectionId}, 'http://127.0.0.1:4310');
    const anchor = event.target.closest('a');
    if (anchor && anchor.getAttribute('href') && !anchor.getAttribute('href').startsWith('#')) event.preventDefault();
  });
})();`;

function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function executeScript(source: string): string {
  return `<script>(()=>{const s=document.createElement('script');s.textContent=${jsLiteral(source)};document.body.appendChild(s)})()</script>`;
}

function integrationRuntime(integrations: Integration[]): string {
  return integrations.filter(integration => integration.type === 'script' && integration.enabled).map(integration => {
    const external = integration.endpoint && /^https:\/\//i.test(integration.endpoint) ? `(() => { const script = document.createElement('script'); script.src = ${jsLiteral(integration.endpoint)}; script.async = true; document.head.appendChild(script); })();` : '';
    return `${external}\n${integration.script ?? ''}`;
  }).join('\n;\n');
}

export function seedFiles(): SiteFiles {
  const content: SiteContent = {
    name: 'линия', title: 'Линия — интерьеры для вашей жизни',
    description: 'Создаём спокойные и продуманные пространства. Дизайн интерьера, комплектация и авторское сопровождение в Москве и по всей России.',
    accent: '#666c53', email: 'hello@linia.example', phone: '+7 (495) 000-00-00',
    sections: [
      { id: 'home', type: 'hero', title: 'Пространство, в котором вы — дома.', subtitle: 'СТУДИЯ ИНТЕРЬЕРА · МОСКВА', body: 'Создаём интерьеры, которые отражают вас.\nВнимательно к деталям. С заботой о главном.', buttonText: 'Давайте познакомимся', buttonUrl: '#contact' },
      { id: 'services', type: 'services', title: 'От первой идеи\nдо вашего дома', subtitle: 'ЧЕМ МЫ МОЖЕМ ПОМОЧЬ', body: 'Берём на себя весь путь к вашему интерьеру. Вы выбираете, на каком этапе мы подключимся.', items: [
        { id: 'design', title: 'Дизайн-проект', text: 'Планировка, настроение, материалы и рабочие чертежи. Всё, чтобы ваша идея стала пространством.' },
        { id: 'furnishing', title: 'Комплектация', text: 'Найдём ту самую мебель, свет и детали. Соберём интерьер в рамках вашего бюджета.' },
        { id: 'supervision', title: 'Авторское сопровождение', text: 'Останемся рядом во время ремонта. Поможем воплотить проект именно таким, каким он задуман.' }
      ] },
      { id: 'approach', type: 'text', title: 'Хороший интерьер начинается с внимания к человеку.', subtitle: 'НАШ ПОДХОД', body: 'Как проходит ваше утро? Где вы любите читать? Как собираетесь с друзьями? Мы начинаем с простых вопросов, чтобы создать пространство, которое живёт в вашем ритме.\n\nНатуральные материалы, спокойные цвета и вещи с характером. Ничего лишнего — только то, что важно вам.' },
      { id: 'contact', type: 'form', title: 'Расскажите о вашем будущем доме', subtitle: 'ДАВАЙТЕ СОЗДАДИМ ЧТО-ТО ВАШЕ', body: 'Оставьте контакты — познакомимся, обсудим вашу идею и подскажем, с чего начать.', buttonText: 'Обсудить проект', fields: [
        { name: 'name', label: 'Как к вам обращаться', type: 'text', required: true },
        { name: 'email', label: 'Ваш email', type: 'email', required: true },
        { name: 'message', label: 'Пара слов о вашем проекте', type: 'textarea' }
      ] }
    ]
  };
  return { 'content.json': JSON.stringify(content, null, 2), 'styles.css': baseStyles, 'script.js': '// Здесь можно добавить интерактивность сайта.\n// Этот код запускается после разметки страницы в отдельном origin.\n' };
}

export function renderSite(files: SiteFiles, options: { preview: boolean; formToken?: string; integrations?: Integration[] }): string {
  const content: SiteContent = JSON.parse(files['content.json']);
  const scripts = options.preview ? '' : integrationRuntime(options.integrations ?? []);
  const accent = /^#[0-9a-f]{3,8}$/i.test(content.accent) ? content.accent : '#666c53';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(content.title)}</title><meta name="description" content="${escapeHtml(content.description)}"><meta name="referrer" content="no-referrer"><style id="forma-styles"></style><script>document.getElementById('forma-styles').textContent=${jsLiteral(files['styles.css'] + '\n:root{--accent:' + accent + '}')};</script></head><body>${renderContent(content, options)}${executeScript(formRuntime)}${executeScript(files['script.js'])}${scripts ? executeScript(scripts) : ''}${options.preview ? executeScript(previewRuntime) : ''}</body></html>`;
}

function sharedRendererSource(): string {
  // These pure functions are serialized from the same implementation used by
  // the preview, so exported content has the same rendering semantics.
  return `// Generated shared renderer; edit site/content.json and assets/styles.css.\n// @ts-nocheck\nconst __name = (target, name) => target;\nconst interiorSvg = ${JSON.stringify(interiorSvg)};\n${[escapeHtml, safeUrl, cleanCustomHtml, renderField, renderSection, renderContent].map(fn => fn.toString()).join('\n\n')}\nexport { renderContent };\n`;
}

export function exportSite(files: SiteFiles, framework: 'nuxt' | 'next', integrations: Integration[]): Record<string, string> {
  const content: SiteContent = JSON.parse(files['content.json']);
  const accent = /^#[0-9a-f]{3,8}$/i.test(content.accent) ? content.accent : '#666c53';
  const scripts = integrationRuntime(integrations);
  const common: Record<string, string> = {
    'site/content.json': files['content.json'], 'site/render.ts': sharedRendererSource(),
    '.nvmrc': '22.22.3\n',
    'assets/styles.css': files['styles.css'] + '\n:root{--accent:' + accent + '}\n',
    'public/script.js': files['script.js'], 'public/forma-runtime.js': formRuntime,
    'public/forma-integrations.js': scripts || '// No enabled browser integrations.\n',
    '.gitignore': 'node_modules\n.next\n.nuxt\n.output\nout\ndist\n.env\n.env.local\n',
    'README.md': `# ${content.name} — Forma export (${framework})\n\nThis is a standalone starter, not an automatic adapter for arbitrary existing projects. Requires Node.js ${framework === 'nuxt' ? '22.22.3+ (or 24.15+)' : '22.12+'}.\n\n## Run\n\n1. Run \`npm install\`.\n2. Run \`npm run dev\`.\n3. Edit \`site/content.json\`, \`assets/styles.css\`, and \`public/script.js\`. The shared renderer is in \`site/render.ts\`.\n4. Run \`npm run build\` for a static production build.\n\n## Forms and integrations\n\nForms are **not connected by default**. Implement a separate public forms backend and configure ${framework === 'nuxt' ? '`NUXT_PUBLIC_FORMA_API_URL`' : '`NEXT_PUBLIC_FORMA_API_URL`'} before building. A form POSTs JSON to \`<API_URL>/forms/<section-id>\` and expects \`{ "ok": true }\`. Configure CORS for your site's actual origin, field validation, rate limiting, and storage/delivery on that backend. This export does not contain private tokens or a backend. The local Forma form endpoint requires its published form token and cannot be used as the exported backend unchanged.\n\nWebhook integrations and their secrets are server settings and are not exported. Browser integration code is in \`public/forma-integrations.js\`; review it, then set ${framework === 'nuxt' ? '`NUXT_PUBLIC_FORMA_ENABLE_SCRIPTS=true`' : '`NEXT_PUBLIC_FORMA_ENABLE_SCRIPTS=true`'} to enable it. Only integrations already enabled in the CMS are included. Never put secrets into browser code or public environment variables.\n\nImages uploaded to Forma are copied into \`public/media/\` by the archive exporter. External image URLs remain external. Links to local CMS assets require the ZIP exporter, not just the JSON file listing.\n\n## Editing\n\nThe JSON source stores typed sections. Custom HTML sections can be added with \`type: "custom"\` and \`html\`. Add behavior to \`public/script.js\`; script tags and inline event handlers in custom HTML are removed. To integrate into an existing Nuxt/Next application, register the shared renderer or port the section types to native components. This starter preserves editable files but is not a live connection back to the CMS.\n`,
  };
  if (framework === 'nuxt') common['README.md'] += '\n## Dependency status\n\nValidated with Nuxt 4.6.2 and Node 22.22.3. Its build tooling currently reports upstream npm audit advisories in braces and node-forge (including transitive dependents). This starter generates static output; do not expose its development server publicly. Review dependency updates before production work.\n';
  for (const [path, source] of Object.entries(files)) {
    if (!['content.json', 'styles.css', 'script.js'].includes(path)) common['site/source/' + path] = source;
  }
  if (framework === 'nuxt') {
    return { ...common,
      'package.json': JSON.stringify({ name: 'forma-nuxt-site', version: '0.1.0', private: true, type: 'module', scripts: { dev: 'nuxt dev', build: 'nuxt generate', preview: 'nuxt preview', postinstall: 'nuxt prepare' }, engines: { node: '^22.22.3 || ^24.15.0 || >=26.0.0' }, dependencies: { nuxt: '^4.6.2', vue: '^3.5.0', 'vue-router': '^4.5.0' } }, null, 2),
      '.env.example': 'NUXT_PUBLIC_FORMA_API_URL=\nNUXT_PUBLIC_FORMA_ENABLE_SCRIPTS=false\n',
      'nuxt.config.ts': `export default defineNuxtConfig({\n  compatibilityDate: '2025-07-01',\n  srcDir: '.',\n  css: ['~/assets/styles.css'],\n  runtimeConfig: { public: { formaApiUrl: '', formaEnableScripts: false } },\n  typescript: { strict: true }\n});\n`,
      'tsconfig.json': '{"extends":"./.nuxt/tsconfig.json"}\n',
      'app.vue': `<script setup lang="ts">\nimport content from './site/content.json'\nimport { renderContent } from './site/render'\nconst config = useRuntimeConfig()\nconst html = renderContent(content, { preview: false, exported: true, formBase: String(config.public.formaApiUrl || '').replace(/\\/$/, '') })\nuseHead({ htmlAttrs: { lang: 'ru' }, title: content.title, meta: [{ name: 'description', content: content.description }], script: [{ src: '/forma-runtime.js', defer: true }, { src: '/script.js', defer: true }, ...(['true', true].includes(config.public.formaEnableScripts) ? [{ src: '/forma-integrations.js', defer: true }] : [])] })\n</script>\n\n<template>\n  <div v-html="html" />\n</template>\n`,
    };
  }
  return { ...common,
    'package.json': JSON.stringify({ name: 'forma-next-site', version: '0.1.0', private: true, scripts: { dev: 'next dev', build: 'next build', start: 'npx serve out' }, engines: { node: '>=22.12.0' }, dependencies: { next: '^16.4.2', react: '^19.0.0', 'react-dom': '^19.0.0' }, devDependencies: { typescript: '^5.7.0', '@types/node': '^22.0.0', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' } }, null, 2),
    '.env.example': 'NEXT_PUBLIC_FORMA_API_URL=\nNEXT_PUBLIC_FORMA_ENABLE_SCRIPTS=false\n',
    'next.config.mjs': 'export default { output: "export" };\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['dom', 'dom.iterable', 'esnext'], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true, jsx: 'react-jsx', incremental: true, plugins: [{ name: 'next' }] }, include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts', '.next/dev/types/**/*.ts'], exclude: ['node_modules'] }, null, 2),
    'app/layout.tsx': `import '../assets/styles.css';\nimport content from '../site/content.json';\nexport const metadata = { title: content.title, description: content.description };\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="ru"><body>{children}</body></html>;\n}\n`,
    'app/page.tsx': `import Script from 'next/script';\nimport content from '../site/content.json';\nimport { renderContent } from '../site/render';\nexport default function Home() {\n  const html = renderContent(content, { preview: false, exported: true, formBase: (process.env.NEXT_PUBLIC_FORMA_API_URL || '').replace(/\\/$/, '') });\n  return <><div dangerouslySetInnerHTML={{ __html: html }} /><Script src="/forma-runtime.js" strategy="afterInteractive" /><Script src="/script.js" strategy="afterInteractive" />{process.env.NEXT_PUBLIC_FORMA_ENABLE_SCRIPTS === 'true' && <Script src="/forma-integrations.js" strategy="afterInteractive" />}</>;\n}\n`,
  };
}
