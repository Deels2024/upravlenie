'use strict';
(function(){
  const rawRenderShell=renderShell;
  let installPrompt=null;
  const primary=['dashboard','buildings','inspections','issues'];
  const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true;
  const ios=()=>/iphone|ipad|ipod/i.test(navigator.userAgent||'');
  const canInstall=()=>!!installPrompt&&!isStandalone();

  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;decorate();});
  window.addEventListener('appinstalled',()=>{installPrompt=null;document.documentElement.classList.add('pwa-installed');decorate();});

  function moreItems(){
    if(!app.user||app.user.role==='tenant')return [];
    const all=navItems();
    return all.filter(([v])=>!primary.includes(v));
  }
  function openMore(){
    const items=moreItems();
    const install=canInstall()?`<button type="button" class="pwa-more-row install" id="pwaInstall"><span>${uiIcon('plus')}</span><span><b>Установить приложение</b><small>Добавить Owner Property на экран телефона</small></span></button>`:'';
    const iosHint=ios()&&!isStandalone()&&!installPrompt?`<div class="pwa-ios-hint"><b>Установка на iPhone</b><span>Откройте меню «Поделиться» в Safari и выберите «На экран Домой».</span></div>`:'';
    modal(`<div class="pwa-more-sheet"><div class="modal-head"><div><h3>Разделы</h3><small>Все доступные функции</small></div><button class="icon-btn" type="button" data-close>×</button></div><div class="pwa-more-list">${items.map(([v,l,ico])=>`<button type="button" class="pwa-more-row ${app.view===v?'active':''}" data-pwa-view="${esc(v)}"><span>${uiIcon(ico)}</span><span><b>${esc(l)}</b><small>${v==='calendar'?'Планы, ТО и сроки':v==='tenants'?'Компании и помещения':v==='tasks'?'Работы сотрудников':v==='equipment'?'Инженерные системы':v==='metrics'?'Ресурсы и показания':v==='expenses'?'Эксплуатационные расходы':v==='admin'?'Сотрудники и доступы':v==='security'?'2FA, аудит и резервирование':'Открыть раздел'}</small></span><em>›</em></button>`).join('')}${install}${iosHint}</div></div>`,true);
    $$('[data-close]').forEach(x=>x.onclick=closeModal);
    $$('[data-pwa-view]').forEach(x=>x.onclick=()=>{app.view=x.dataset.pwaView;closeModal();renderShell();});
    $('#pwaInstall')?.addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();try{await installPrompt.userChoice;}catch{}installPrompt=null;closeModal();decorate();});
  }
  function decorate(){
    if(!app.user)return;
    document.documentElement.classList.toggle('pwa-standalone',isStandalone());
    const nav=document.querySelector('.mobile-nav');if(!nav)return;
    if(app.user.role!=='tenant'){
      const all=navItems();
      const chosen=primary.map(v=>all.find(x=>x[0]===v)).filter(Boolean);
      const extras=all.filter(x=>!primary.includes(x[0]));
      const extraActive=extras.some(x=>x[0]===app.view);
      nav.innerHTML=chosen.map(([v,l,ico])=>`<button data-pwa-nav="${esc(v)}" class="${app.view===v?'active':''}"><span class="ico">${uiIcon(ico)}</span><span>${esc(l)}</span></button>`).join('')+`<button id="pwaMore" class="${extraActive?'active':''}"><span class="ico">${uiIcon('folder')}</span><span>Ещё</span></button>`;
      $$('[data-pwa-nav]',nav).forEach(b=>b.onclick=()=>{app.view=b.dataset.pwaNav;renderShell();});
      $('#pwaMore')?.addEventListener('click',openMore);
    }
    const top=document.querySelector('.topbar');
    if(top&&!top.querySelector('.pwa-brand-mini')){const b=document.createElement('div');b.className='pwa-brand-mini';b.innerHTML='<span>OP</span>';top.prepend(b);}
  }
  renderShell=function(){const r=rawRenderShell();decorate();return r;};
  setTimeout(()=>{document.documentElement.classList.toggle('pwa-standalone',isStandalone());decorate();},400);
  window.v26Pwa={openMore,isStandalone,canInstall};
})();
