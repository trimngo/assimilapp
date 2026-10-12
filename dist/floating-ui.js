// Keep the controls outside the scrolling document and inside Safari's visible viewport.
export function setupFloatingUI(){
  const header=document.querySelector('.top-bar');
  const spacer=document.createElement('div');spacer.className='toolbar-spacer';spacer.setAttribute('aria-hidden','true');
  header.before(spacer);
  const layer=document.createElement('div');layer.id='floating-ui';document.body.append(layer);layer.append(header);
  let frame=0;
  function update(){
    frame=0;const viewport=window.visualViewport;
    const values={top:viewport?.offsetTop||0,left:viewport?.offsetLeft||0,width:viewport?.width||innerWidth,height:viewport?.height||innerHeight};
    for(const [name,value] of Object.entries(values))layer.style.setProperty(`--viewport-${name}`,`${value}px`);
    document.documentElement.style.setProperty('--toolbar-height',`${header.getBoundingClientRect().height}px`);
    document.dispatchEvent(new Event('floating-layout'));
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(update);}
  new ResizeObserver(schedule).observe(header);
  for(const event of ['resize','orientationchange','pageshow','scroll'])window.addEventListener(event,schedule,{passive:true});
  window.visualViewport?.addEventListener('resize',schedule,{passive:true});
  window.visualViewport?.addEventListener('scroll',schedule,{passive:true});
  document.addEventListener('visibilitychange',schedule);
  // iOS finishes keyboard dismissal after focusout; refresh through that transition.
  document.addEventListener('focusout',()=>{schedule();setTimeout(schedule,250);setTimeout(schedule,600);});
  update();return layer;
}
