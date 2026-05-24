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

// Navbar
const nb=document.getElementById('navbar');
if(nb)window.addEventListener('scroll',()=>{nb.style.background=window.scrollY>40?'rgba(2,11,24,0.98)':'rgba(2,11,24,0.9)';});

// Hamburger
const ham=document.getElementById('hamburger');
const nc=document.getElementById('nav-collapse');
if(ham&&nc)ham.addEventListener('click',()=>{nc.classList.toggle('open');ham.classList.toggle('open');});
// Close nav when a link is clicked on mobile
if(nc)nc.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nc.classList.remove('open');ham&&ham.classList.remove('open');}));

// Scroll reveal
const ro=new IntersectionObserver(e=>e.forEach(x=>{if(x.isIntersecting)x.target.classList.add('visible');}),{threshold:0.1});
document.querySelectorAll('.market-card,.mt5-feat,.acc-card,.dep-card,.ci-item').forEach(el=>{el.classList.add('reveal');ro.observe(el);});

// Currency toggle — default USD on load
document.addEventListener('DOMContentLoaded', () => setCurrency('USD'));

function setCurrency(cur){
  document.getElementById('cur-kes').classList.toggle('active', cur==='KES');
  document.getElementById('cur-usd').classList.toggle('active', cur==='USD');
  document.querySelectorAll('.cur-sym').forEach(el=>el.textContent=cur);
  document.querySelectorAll('.cur-val').forEach(el=>{
    el.textContent=cur==='KES'?(el.dataset.kes||el.textContent):(el.dataset.usd||el.textContent);
  });
}

// Form submit
function submitForm(e){
  e.preventDefault();
  alert('✅ Application received!\n\nOur team will contact you within 1 business hour to complete your account setup.\n\nWelcome to Imara Logic Brokers.');
  e.target.reset();
}
