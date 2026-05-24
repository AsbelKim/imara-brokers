function switchTab(id) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.side-link[data-tab]').forEach(l => l.classList.remove('active'));
  const section = document.getElementById(id);
  if (section) section.classList.add('active');
  document.querySelectorAll(`.side-link[data-tab="${id}"]`).forEach(l => l.classList.add('active'));
  closeSidebar();
}

function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  const dh = document.getElementById('dash-hamburger');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('open');
  if (dh) dh.classList.remove('open');
}

function dashToast(msg, type) {
  const t = document.getElementById('dash-toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast toast-' + type + ' show';
  setTimeout(() => t.className = 'toast', 4500);
}

document.addEventListener('DOMContentLoaded', () => {
  // Mobile sidebar toggle
  const dh = document.getElementById('dash-hamburger');
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (dh && sb && ov) {
    dh.addEventListener('click', () => {
      sb.classList.toggle('open');
      ov.classList.toggle('open');
      dh.classList.toggle('open');
    });
    ov.addEventListener('click', closeSidebar);
  }

  // Tab switching via sidebar clicks
  document.querySelectorAll('.side-link[data-tab]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      switchTab(link.dataset.tab);
    });
  });

  // Trade history filter buttons (cosmetic)
  document.querySelectorAll('.table-filter .tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.table-filter').querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Payout form submit
  const payoutForm = document.getElementById('payout-form');
  if (payoutForm) {
    payoutForm.addEventListener('submit', e => {
      e.preventDefault();
      dashToast('Payout request submitted! Processing within 24 hours.', 'success');
      payoutForm.reset();
    });
  }
});
