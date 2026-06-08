// IMARA trading calculators — position size, pip value, profit & loss
(function () {
  'use strict';

  const tabs = document.querySelectorAll('.calc-tab');
  const panels = {
    position: document.getElementById('panel-position'),
    pipvalue: document.getElementById('panel-pipvalue'),
    pnl: document.getElementById('panel-pnl'),
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      Object.values(panels).forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      panels[tab.dataset.tab].classList.add('active');
    });
  });

  const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const row = (label, val, cls) => `<div class="cr-row"><span class="cr-label">${label}</span><span class="cr-val${cls ? ' ' + cls : ''}">${val}</span></div>`;

  // ── Position Size ──
  const psBalance = document.getElementById('ps-balance');
  const psRisk = document.getElementById('ps-risk');
  const psSl = document.getElementById('ps-sl');
  const psPipVal = document.getElementById('ps-pipval');
  const psResult = document.getElementById('ps-result');

  function calcPositionSize() {
    const balance = parseFloat(psBalance.value) || 0;
    const risk = parseFloat(psRisk.value) || 0;
    const sl = parseFloat(psSl.value) || 0;
    const pipVal = parseFloat(psPipVal.value) || 0;

    const riskAmount = balance * (risk / 100);
    let lots = 0;
    if (sl > 0 && pipVal > 0) lots = riskAmount / (sl * pipVal);

    psResult.innerHTML =
      row('Amount risked', `$${fmt(riskAmount)}`) +
      row('Recommended position size', `${lots.toFixed(2)} lots`, 'green') +
      row('Risk per pip', `$${fmt(sl > 0 ? riskAmount / sl : 0)}`);
  }
  [psBalance, psRisk, psSl, psPipVal].forEach(el => el.addEventListener('input', calcPositionSize));
  calcPositionSize();

  // ── Pip Value ──
  const pvLot = document.getElementById('pv-lot');
  const pvPip = document.getElementById('pv-pip');
  const pvRate = document.getElementById('pv-rate');
  const pvResult = document.getElementById('pv-result');

  function calcPipValue() {
    const lot = parseFloat(pvLot.value) || 0;
    const pip = parseFloat(pvPip.value) || 0.0001;
    const rate = parseFloat(pvRate.value) || 1;

    const pipValue = (pip * lot) / rate;

    pvResult.innerHTML =
      row('Value of 1 pip', `$${fmt(pipValue)}`, 'green') +
      row('Value of 10 pips', `$${fmt(pipValue * 10)}`) +
      row('Value of 50 pips', `$${fmt(pipValue * 50)}`);
  }
  [pvLot, pvPip, pvRate].forEach(el => el.addEventListener('input', calcPipValue));
  pvPip.addEventListener('change', calcPipValue);
  calcPipValue();

  // ── Profit & Loss ──
  const plDir = document.getElementById('pl-dir');
  const plLot = document.getElementById('pl-lot');
  const plEntry = document.getElementById('pl-entry');
  const plExit = document.getElementById('pl-exit');
  const plPip = document.getElementById('pl-pip');
  const plRate = document.getElementById('pl-rate');
  const plResult = document.getElementById('pl-result');

  function calcPnl() {
    const dir = plDir.value;
    const lot = parseFloat(plLot.value) || 0;
    const entry = parseFloat(plEntry.value) || 0;
    const exit = parseFloat(plExit.value) || 0;
    const pip = parseFloat(plPip.value) || 0.0001;
    const rate = parseFloat(plRate.value) || 1;

    const priceDiff = dir === 'buy' ? (exit - entry) : (entry - exit);
    const pips = priceDiff / pip;
    const pipValue = (pip * lot) / rate;
    const pnl = pips * pipValue;

    const isProfit = pnl >= 0;
    plResult.innerHTML =
      row('Movement', `${pips >= 0 ? '+' : ''}${fmt(pips)} pips`) +
      row('Pip value', `$${fmt(pipValue)}`) +
      row(isProfit ? 'Estimated profit' : 'Estimated loss', `${isProfit ? '+' : '-'}$${fmt(Math.abs(pnl))}`, isProfit ? 'green' : 'red');
  }
  [plDir, plLot, plEntry, plExit, plPip, plRate].forEach(el => el.addEventListener('input', calcPnl));
  [plDir, plPip].forEach(el => el.addEventListener('change', calcPnl));
  calcPnl();
})();
