// Particle canvas
(function(){
  const c=document.getElementById('bg-canvas');
  if(!c)return;
  const ctx=c.getContext('2d');
  let W,H,pts;
  function resize(){W=c.width=c.offsetWidth;H=c.height=c.offsetHeight;}
  function make(){return{x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.1+0.3,dx:(Math.random()-.5)*.28,dy:(Math.random()-.5)*.28,a:Math.random()*.35+0.08};}
  function init(){resize();pts=Array.from({length:90},make);}
  function draw(){
    ctx.clearRect(0,0,W,H);
    pts.forEach(p=>{
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(14,165,233,${p.a})`;ctx.fill();
      p.x+=p.dx;p.y+=p.dy;
      if(p.x<0||p.x>W)p.dx*=-1;if(p.y<0||p.y>H)p.dy*=-1;
    });
    for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++){
      const a=pts[i],b=pts[j],d=Math.hypot(a.x-b.x,a.y-b.y);
      if(d<85){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=`rgba(14,165,233,${.06*(1-d/85)})`;ctx.lineWidth=.5;ctx.stroke();}
    }
    requestAnimationFrame(draw);
  }
  window.addEventListener('resize',resize);
  init();draw();
})();

// Navbar scroll
const nb=document.getElementById('navbar');
if(nb)window.addEventListener('scroll',()=>{nb.style.background=window.scrollY>40?'rgba(6,9,15,0.98)':'rgba(6,9,15,0.88)';});

// Hamburger
const ham=document.getElementById('hamburger');
const nc=document.getElementById('nav-collapse');
if(ham&&nc)ham.addEventListener('click',()=>{nc.classList.toggle('open');ham.classList.toggle('open');});
if(nc)nc.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nc.classList.remove('open');ham&&ham.classList.remove('open');}));

// Mobile dropdown toggles
document.querySelectorAll('.has-drop .nav-link-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    if(window.innerWidth>1140)return;
    const li=btn.closest('.has-drop');
    li.classList.toggle('mob-open');
  });
});

// Language selector — nav (index.html)
(function(){
  const sel = document.getElementById('lang-sel');
  if (!sel) return;

  const LANGS = [
    { code:'EN', country:'gb' }, { code:'FR', country:'fr' }, { code:'ES', country:'es' },
    { code:'DE', country:'de' }, { code:'IT', country:'it' }, { code:'PT', country:'pt' },
    { code:'CS', country:'cz' }, { code:'VI', country:'vn' }, { code:'SW', country:'ke' },
    { code:'AR', country:'sa' }, { code:'ZH', country:'cn' },
  ];

  function flagUrl(c){ return `https://flagcdn.com/w40/${c}.png`; }

  // build dropdown
  const drop = document.getElementById('lang-drop');
  LANGS.forEach(l => {
    const d = document.createElement('div');
    d.className = 'lang-opt';
    d.dataset.code = l.code;
    d.innerHTML = `<span class="flag-circle"><img src="${flagUrl(l.country)}" alt="${l.code}" /></span><span>${l.code}</span>`;
    d.addEventListener('click', () => pick(l.code, l.country));
    drop.appendChild(d);
  });

  function pick(code, country) {
    document.getElementById('nav-flag-img').src = flagUrl(country);
    document.getElementById('nav-flag-img').alt = code;
    document.getElementById('lang-code').textContent = code;
    sel.querySelectorAll('.lang-opt').forEach(o => o.classList.toggle('active', o.dataset.code === code));
    drop.classList.remove('open');
    localStorage.setItem('ilf_lang', code);
    localStorage.setItem('ilf_lang_country', country);
    if (window.IMARA_I18N) window.IMARA_I18N.applyLang(code);
  }

  // restore saved
  const saved = localStorage.getItem('ilf_lang') || 'EN';
  const savedCountry = localStorage.getItem('ilf_lang_country') || 'gb';
  document.getElementById('nav-flag-img').src = flagUrl(savedCountry);
  document.getElementById('nav-flag-img').alt = saved;
  document.getElementById('lang-code').textContent = saved;
  sel.querySelectorAll('.lang-opt').forEach(o => o.classList.toggle('active', o.dataset.code === saved));

  // toggle
  sel.querySelector('.lang-btn').addEventListener('click', e => { e.stopPropagation(); drop.classList.toggle('open'); });
  document.addEventListener('click', e => { if (!sel.contains(e.target)) drop.classList.remove('open'); });
})();

// Auth gate — starting a challenge requires login (viewing pricing does not)
document.querySelectorAll('.btn-plan, .btn-plan-featured, .btn-nav-cta').forEach(el => {
  el.addEventListener('click', e => {
    if (localStorage.getItem('ilf_token')) return; // already logged in — proceed normally
    e.preventDefault();
    window.location.href = 'login.html';
  });
});

// MT5 server card — only visible to logged-in traders
(function () {
  const card = document.getElementById('server-card');
  const locked = document.getElementById('server-locked');
  if (!card || !locked) return;
  if (localStorage.getItem('ilf_token')) {
    card.classList.add('show');
    locked.classList.add('hide');
  }
})();

// Scroll reveal
const ro=new IntersectionObserver(e=>e.forEach(x=>{if(x.isIntersecting)x.target.classList.add('visible');}),{threshold:0.1});
document.querySelectorAll('.market-card,.mt5-feat,.acc-card,.dep-card,.ci-item,.step-card,.rule-card,.tcard,.why-card,.trader-card,.payout-card,.pf-item,.plan-card,.step,.reveal').forEach(el=>{if(!el.classList.contains('reveal'))el.classList.add('reveal');ro.observe(el);});

// FAQ accordion
document.querySelectorAll('.faq-q').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const item=btn.closest('.faq-item');
    const isOpen=item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(i=>i.classList.remove('open'));
    if(!isOpen)item.classList.add('open');
  });
});

// Password toggle (used in signup form on index.html)
function toggleRegPass(inputId, iconId) {
  const p = document.getElementById(inputId);
  if (p) p.type = p.type === 'password' ? 'text' : 'password';
}

// Password match indicator on confirm field
const regPass = document.getElementById('reg-pass');
const regConfirm = document.getElementById('reg-pass-confirm');
const matchMsg = document.getElementById('pass-match-msg');
if (regConfirm && regPass && matchMsg) {
  regConfirm.addEventListener('input', () => {
    if (!regConfirm.value) { matchMsg.style.display = 'none'; return; }
    if (regPass.value === regConfirm.value) {
      matchMsg.textContent = '✓ Passwords match';
      matchMsg.style.color = 'var(--green)';
    } else {
      matchMsg.textContent = '✗ Passwords do not match';
      matchMsg.style.color = '#ef4444';
    }
    matchMsg.style.display = 'block';
  });
}

// Toast
function showToast(msg,type='success'){
  const t=document.getElementById('toast');
  if(!t)return;
  t.textContent=msg;
  t.className='toast toast-'+type+' show';
  setTimeout(()=>t.className='toast',4500);
}

const API_BASE = '/api';

// Form submit — signup
async function submitForm(e) {
  e.preventDefault();
  const p1 = document.getElementById('reg-pass');
  const p2 = document.getElementById('reg-pass-confirm');
  if (p1 && p2 && p1.value !== p2.value) {
    showToast('Passwords do not match — please try again.', 'error');
    return;
  }

  const form = e.target;
  const btn = form.querySelector('button[type=submit]');
  const originalText = btn.textContent;
  btn.textContent = 'Creating account…';
  btn.disabled = true;

  const inputs = form.querySelectorAll('input, select');
  const [fullName, phone, email, plan, experience, country, password] = [
    inputs[0].value.trim(),
    inputs[1].value.trim(),
    inputs[2].value.trim(),
    inputs[3].value,
    inputs[4].value,
    inputs[5].value,
    p1.value,
  ];

  try {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, email, phone, country, plan, experience, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Signup failed — please try again.', 'error');
      return;
    }

    localStorage.setItem('ilf_token', data.token);
    localStorage.setItem('ilf_trader', JSON.stringify(data.trader));
    showToast('Account created! Redirecting to your portal…', 'success');
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 1800);
  } catch {
    showToast('Could not reach the server. Please try again later.', 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}
