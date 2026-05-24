function showMpesa(){
  document.getElementById('mpesa-modal').style.display='flex';
}

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
