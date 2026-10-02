/* 視覺揭曉與抽樣分離：此檔不讀候選名單、不發 API、不決定得獎者。 */
(() => {
  let overlay=null, started=0, animation=0, previousFocus=null, previousOverflow='', mainWasInert=false;
  const reelAnimations=new Set();
  const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function element(tag,cls,text) { const el=document.createElement(tag); el.className=cls; if(text!==undefined) el.textContent=text; return el; }
  function close() {
    if(!overlay) return;
    cancelAnimationFrame(animation); reelAnimations.forEach(a=>a.cancel()); reelAnimations.clear(); overlay.remove(); overlay=null;
    document.body.style.overflow=previousOverflow;
    const main=document.getElementById('main'); if(main) main.inert=mainWasInert;
    if(previousFocus?.isConnected && !previousFocus.disabled) previousFocus.focus({preventScroll:true});
  }
  function start({eventName,prize,count,demo}) {
    close(); started=performance.now(); previousFocus=document.activeElement;
    previousOverflow=document.body.style.overflow; document.body.style.overflow='hidden';
    const main=document.getElementById('main'); mainWasInert=!!main?.inert; if(main) main.inert=true;
    overlay=element('section','draw-theater'); overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true'); overlay.setAttribute('aria-label','抽獎揭曉'); overlay.tabIndex=-1;
    overlay.append(element('p','motion-event',eventName),element('p','motion-kicker',demo?'示範抽獎 · 虛構名單':'好運，即將揭曉'),element('h2','motion-prize',prize));
    const suspense=element('div','motion-suspense'),orbit=element('div','motion-orbit');
    orbit.append(element('i','motion-ring'));
    for(let i=0;i<12;i++){const spark=element('i','motion-spark');spark.style.setProperty('--i',i);orbit.append(spark);}
    orbit.setAttribute('aria-hidden','true');orbit.append(element('div','motion-symbol','✦'));suspense.append(orbit);
    const caption=element('p','motion-caption','正在抽選 '+count+' 位幸運學員…');caption.setAttribute('role','status');
    overlay.append(suspense,caption,element('p','motion-bottom','下一份好運，會是誰？'));
    overlay.addEventListener('keydown',event=>{
      if(event.key==='Escape' && overlay?.classList.contains('revealed')) {event.stopPropagation();close();}
      if(event.key==='Tab'){event.preventDefault();const focus=overlay?.querySelector('button') || overlay;focus?.focus();}
    });
    document.body.append(overlay);overlay.focus();
  }
  function confetti(target) {
    if(reduced()) return;
    const canvas=element('canvas','motion-confetti');canvas.setAttribute('aria-hidden','true');target.append(canvas);
    const ctx=canvas.getContext('2d');if(!ctx)return;
    const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio || 1,2);
    canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);
    const colors=['#ffe6ab','#ddae5f','#fff4da','#bc91ce','#f2cba1'];
    const pieces=Array.from({length:w<600?90:160},(_,i)=>({x:w/2,y:h*.42,vx:(Math.random()-.5)*19,vy:-7-Math.random()*13,a:Math.random()*6,s:4+Math.random()*7,color:colors[i%colors.length]}));
    let before=performance.now();const begin=before;
    function frame(now){
      if(overlay!==target)return;
      const dt=Math.min((now-before)/16.67,2);before=now;
      ctx.clearRect(0,0,w,h);ctx.globalAlpha=Math.min(1,(4400-(now-begin))/900);
      pieces.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=.24*dt;p.vx*=Math.pow(.99,dt);p.a+=.07*dt;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.a);ctx.fillStyle=p.color;ctx.fillRect(-p.s/2,-p.s/4,p.s,p.s*.5);ctx.restore();});
      if(now-begin<4400)animation=requestAnimationFrame(frame);else canvas.remove();
    }
    animation=requestAnimationFrame(frame);
  }
  async function spinReels(target, draw) {
    target.classList.add('spinning');
    const suspense=target.querySelector('.motion-suspense');suspense.replaceChildren();
    const grid=element('div','motion-reel-grid'+(draw.winners.length===1?' single':''));suspense.append(grid);
    target.querySelector('.motion-caption').textContent='好運轉動中…';
    target.querySelector('.motion-bottom').textContent='等待最後一格，停在你的好運。';
    // 滾動的是末三碼的數字，不載入或假造其他學員姓名；停點只使用已保存的得獎資料。
    const cards=draw.winners.map((winner,index)=>{
      const card=element('div','motion-reel-card');card.append(element('p','motion-reel-order','第 '+String(index+1).padStart(2,'0')+' 位'));
      const slots=element('div','motion-slots');slots.setAttribute('aria-hidden','true');
      const rowHeight=innerWidth<600?64:88;slots.style.setProperty('--reel-height',rowHeight+'px');
      const columns=String(winner.phoneTail).padStart(3,'0').slice(-3).split('').map((digit,col)=>{
        const viewport=element('div','motion-reel'),track=element('div','motion-reel-track');
        const last=40+Number(digit);
        for(let i=0;i<=last+1;i++) track.append(element('span','motion-reel-digit',String(i%10)));
        viewport.append(track);slots.append(viewport);
        return {viewport,track,last,digit,col,rowHeight};
      });
      card.append(slots,element('small','motion-reel-label','手機末三碼'),element('strong','motion-reel-name','•••'));
      grid.append(card);return {card,columns,winner,index};
    });
    target.scrollTop=0;
    await Promise.all(cards.map(async item=>{
      await Promise.all(item.columns.map(async column=>{
        const distance=column.last*column.rowHeight;
        const reel=column.track.animate([{transform:'translateY(0)'},{transform:'translateY(-'+distance+'px)'}],{
          duration:3400+column.col*500+Math.min(item.index,4)*180,
          easing:'cubic-bezier(.12,.78,.2,1)',fill:'forwards'
        });
        reelAnimations.add(reel);
        try {await reel.finished;} catch(_) {return;} finally {reelAnimations.delete(reel);}
        if(overlay!==target)return;
        // 結束後換成單一數字，確保停格精準、調整視窗也不偏移。
        column.track.style.transform='translateY(0)';reel.cancel();
        column.track.replaceChildren(element('span','motion-reel-digit',column.digit));
        column.viewport.classList.add('stopped');
      }));
      if(overlay!==target)return;
      item.card.querySelector('.motion-reel-name').textContent=item.winner.name;
      item.card.classList.add('locked');
    }));
    if(overlay!==target)return;
    target.querySelector('.motion-caption').textContent='好運，停在這一刻！';
    await delay(700);
    if(overlay===target) target.classList.remove('spinning');
  }
  async function reveal(draw) {
    if(!overlay || !draw) {close();return;}
    const target=overlay;
    if(!reduced()) {
      await delay(Math.max(0,900-(performance.now()-started)));
      if(overlay!==target)return;
      target.querySelector('.motion-caption').textContent='準備揭曉';
      for(const n of ['3','2','1']) {
        if(overlay!==target)return;
        const old=target.querySelector('.motion-symbol'),symbol=element('div','motion-symbol counting',n);old.replaceWith(symbol);
        await delay(800);
      }
      if(overlay!==target)return;
      await spinReels(target,draw);
    }
    if(overlay!==target)return;
    target.classList.add('revealed');target.querySelector('.motion-suspense').remove();target.querySelector('.motion-caption').remove();target.querySelector('.motion-bottom').remove();
    target.querySelector('.motion-kicker').textContent='THE LUCKY MOMENT';
    const results=element('div','motion-results');results.append(element('h2','motion-congrats','恭喜中獎！'));
    const list=element('div','motion-winners'+(draw.winners.length===1?' single':draw.winners.length>6?' many':''));
    draw.winners.forEach((w,i)=>{const card=element('div','motion-winner');card.style.setProperty('--order',Math.min(i,6));card.append(element('strong','',w.name),element('small','','手機末三碼 '+w.phoneTail));list.append(card);});
    results.append(list);const button=element('button','motion-close','回到抽獎台');button.type='button';button.addEventListener('click',close);
    target.append(results,element('p','motion-bottom','本輪 '+draw.winners.length+' 位得獎者 · 結果已保存'),button);
    target.setAttribute('aria-label',draw.prize+'：'+draw.winners.length+' 位得獎者已揭曉');
    target.scrollTop=0;button.focus({preventScroll:true});confetti(target);
  }
  window.RaffleMotion={start,reveal,abort:close};
})();
