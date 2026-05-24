function showMpesa(){
  document.getElementById('mpesa-modal').style.display='flex';
}

document.addEventListener('DOMContentLoaded', () => {
  setCurrency('USD');

  // Mobile sidebar toggle
  const dh = document.getElementById('dash-hamburger');
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if(dh && sb && ov){
    dh.addEventListener('click', () => {
      sb.classList.toggle('open');
      ov.classList.toggle('open');
      dh.classList.toggle('open');
    });
    ov.addEventListener('click', () => {
      sb.classList.remove('open');
      ov.classList.remove('open');
      dh.classList.remove('open');
    });
    // Close sidebar when a nav link is clicked on mobile
    sb.querySelectorAll('.side-link').forEach(l => l.addEventListener('click', () => {
      sb.classList.remove('open');
      ov.classList.remove('open');
      dh.classList.remove('open');
    }));
  }
});

function setCurrency(cur){
  document.getElementById('cur-kes').classList.toggle('active', cur==='KES');
  document.getElementById('cur-usd').classList.toggle('active', cur==='USD');

  const sym = cur==='KES' ? 'KES' : 'USD';
  const fmt = (el, prefix='') => {
    const v = cur==='KES' ? el.dataset.kes : el.dataset.usd;
    if(!v) return;
    const p = el.dataset.prefix || prefix;
    el.textContent = p + sym + ' ' + parseFloat(v).toLocaleString('en-KE', {minimumFractionDigits:2, maximumFractionDigits:2});
  };

  const balance = document.getElementById('val-balance');
  if(balance) fmt(balance);

  const equity = document.getElementById('val-equity');
  if(equity) fmt(equity);

  const pnl = document.getElementById('val-pnl');
  if(pnl) fmt(pnl);

  const margin = document.getElementById('val-margin');
  if(margin) fmt(margin);

  const marginUsed = document.getElementById('val-margin-used');
  if(marginUsed){
    const raw = cur==='KES' ? 12200 : 94.28;
    marginUsed.textContent = 'Used: ' + sym + ' ' + raw.toLocaleString('en-KE', {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  // Update balance chip label
  document.querySelectorAll('.balance-chip span').forEach(el=>{
    if(el.textContent.includes('Balance')) el.textContent = sym + ' Balance';
  });
}
