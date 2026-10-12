// Apply before styles paint, including offline launches.
(() => {
  const key='german-study-appearance',modes=['system','light','dark'];
  const device=matchMedia('(prefers-color-scheme: dark)');
  let mode='system';
  try{const saved=localStorage.getItem(key);if(modes.includes(saved))mode=saved;}catch{}
  function apply(){
    const dark=mode==='dark'||(mode==='system'&&device.matches);
    document.documentElement.dataset.theme=dark?'dark':'light';
    document.querySelector('meta[name="theme-color"]').content=dark?'#111b19':'#f5f2e9';
  }
  apply();device.addEventListener('change',apply);
  document.addEventListener('DOMContentLoaded',()=>{
    const select=document.getElementById('theme-mode');select.value=mode;
    select.addEventListener('change',()=>{
      mode=select.value;apply();
      const status=document.getElementById('theme-status');
      try{localStorage.setItem(key,mode);status.textContent='Appearance saved on this device.';}
      catch{status.textContent='Appearance changed. Device storage could not save your choice.';}
    });
  });
})();
