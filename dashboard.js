function showPayoutModal(){
  document.getElementById('payout-modal').style.display='flex';
}

document.addEventListener('DOMContentLoaded', () => {
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
    sb.querySelectorAll('.side-link').forEach(l => l.addEventListener('click', () => {
      sb.classList.remove('open');
      ov.classList.remove('open');
      dh.classList.remove('open');
    }));
  }
});
