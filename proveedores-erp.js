// Proveedores · ERP: cuentas por pagar (D1) y órdenes de compra (D2).
//
// Se carga después del script principal de proveedores.html y usa sus datos
// (proveedores, compras, saveToCloud, guardarComprasLocal, cargaOk...).
//
// CUENTAS POR PAGAR: cada compra tiene N° de documento, vencimiento (fecha +
// plazo de pago del proveedor) y pagos parciales [{id, fecha, monto, medio,
// obs}]. Saldo = total − pagos. Las compras antiguas sin pagos usan su marca
// pagada/pendiente de antes.
//
// ÓRDENES DE COMPRA (llave ordenes_compra_ci_v1): se piden al proveedor,
// se marcan como enviadas y se reciben (total o parcial). Cada recepción
// puede crear la compra (factura) con lo recibido; la compra guarda ocId.
// Estados: Borrador → Enviada → Recibida parcial → Recibida (o Anulada).

const KEY_OC = 'ordenes_compra_ci_v1';
let ordenes = [];
let cargaOcOk = false;
const MEDIOS_PAGO_PROV = ['Transferencia', 'Efectivo', 'Cheque', 'Tarjeta'];
const $e = id => document.getElementById(id);
const escP = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pesos = n => '$' + Math.round(n || 0).toLocaleString('es-CL');
const fechaCorta = iso => iso ? iso.split('-').reverse().join('-') : '—';
const diasHasta = iso => Math.round((Date.parse(iso) - Date.parse(hoyChile())) / 86400000);
const idNuevo = () => Date.now() + Math.floor(Math.random() * 1000);

// ------------------------------------------------------------------ saldos
function proveedorDe(id) { return proveedores.find(p => String(p.id) === String(id)) || null; }
function pagosDe(c) {
  if (Array.isArray(c.pagos)) return c.pagos;
  // Compra antigua: marcada como pagada sin detalle de pagos.
  if (c.pagada === true) return [{ id: 'antiguo', fecha: c.fechaPago || c.fecha, monto: compraMontoTotal(c), medio: '', obs: 'Registrada como pagada', antiguo: true }];
  return [];
}
function pagadoDe(c) { return pagosDe(c).reduce((s, p) => s + (Number(p.monto) || 0), 0); }
function saldoDe(c) { return compraEstadoPago(c) === 'sd' ? 0 : Math.max(0, compraMontoTotal(c) - pagadoDe(c)); }
function sumarDiasIso(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function vencimientoDe(c) {
  if (c.vencimiento) return c.vencimiento;
  const p = proveedorDe(c.proveedorId);
  return sumarDiasIso(c.fecha || hoyChile(), p && p.plazoPagoDias ? p.plazoPagoDias : 0);
}
function sugerirVencimiento() {
  const p = proveedorDe($e('cp-proveedor').value);
  const f = $e('cp-fecha').value || hoyChile();
  $e('cp-venc').value = sumarDiasIso(f, p && p.plazoPagoDias ? p.plazoPagoDias : 0);
}

// Estado de pago con saldo y vencimiento (reemplaza la etiqueta anterior).
function compraBadgePago(c) {
  const st = compraEstadoPago(c);
  if (st === 'sd') return '<span class="bdg-pago sd" title="Compra antigua sin dato de pago: edítala para indicarlo">Sin dato</span>';
  const saldo = saldoDe(c);
  if (saldo <= 0) { const ult = pagosDe(c).map(p => p.fecha).sort().pop(); return '<span class="bdg-pago si">✓ Pagada' + (ult ? ' ' + fechaCorta(ult) : '') + '</span>'; }
  const d = diasHasta(vencimientoDe(c));
  const txt = d < 0 ? 'Vencida hace ' + (-d) + ' d' : d === 0 ? 'Vence hoy' : 'Vence en ' + d + ' d';
  const parcial = pagadoDe(c) > 0 ? ' · saldo ' + pesos(saldo) : '';
  return '<span class="bdg-pago no" style="' + (d < 0 ? 'background:#FEE2E2;color:#B91C1C' : '') + '" title="Vence el ' + fechaCorta(vencimientoDe(c)) + '">' + txt + parcial + '</span>';
}

// ------------------------------------------------------------------ pestañas
function setTab(t) {
  ['proveedores', 'compras', 'porpagar', 'oc'].forEach(v => {
    const view = $e('view-' + v), btn = $e('tabbtn-' + v);
    if (view) view.style.display = v === t ? 'block' : 'none';
    if (btn) btn.classList.toggle('on', v === t);
  });
  if (t === 'compras') { renderConcentracion(); renderComprasTable(); }
  if (t === 'porpagar') renderPorPagar();
  if (t === 'oc') renderOrdenes();
}

// ------------------------------------------------------------------ por pagar
function renderPorPagar() {
  const cont = $e('porPagarWrap');
  const filtro = $e('pp-proveedor') ? $e('pp-proveedor').value : '';
  const pendientes = compras.filter(c => saldoDe(c) > 0 && (!filtro || String(c.proveedorId) === filtro));
  const tramos = { vencido: 0, semana: 0, mes: 0, despues: 0 };
  pendientes.forEach(c => {
    const d = diasHasta(vencimientoDe(c)), s = saldoDe(c);
    if (d < 0) tramos.vencido += s; else if (d <= 7) tramos.semana += s; else if (d <= 30) tramos.mes += s; else tramos.despues += s;
  });
  const total = pendientes.reduce((s, c) => s + saldoDe(c), 0);
  const provConDeuda = [...new Set(compras.filter(c => saldoDe(c) > 0).map(c => String(c.proveedorId)))];
  const porProv = {};
  pendientes.forEach(c => { (porProv[c.proveedorId] = porProv[c.proveedorId] || []).push(c); });
  const grupos = Object.entries(porProv).map(([id, l]) => ({ id, l, saldo: l.reduce((s, c) => s + saldoDe(c), 0) })).sort((a, b) => b.saldo - a.saldo);
  const tarjeta = (t, v, color) => `<div class="pp-kpi" style="border-left-color:${color}"><div class="pp-kpi-l">${t}</div><div class="pp-kpi-v">${pesos(v)}</div></div>`;
  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <h2 style="font-family:'DM Serif Display',serif;font-size:20px">Cuentas por pagar · ${pesos(total)}</h2>
      <select id="pp-proveedor" onchange="renderPorPagar()" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px">
        <option value="">Todos los proveedores</option>${provConDeuda.map(id => `<option value="${id}" ${id === filtro ? 'selected' : ''}>${escP((proveedorDe(id) || {}).nombre || 'Proveedor eliminado')}</option>`).join('')}
      </select>
    </div>
    <div class="pp-kpis">${tarjeta('Vencido', tramos.vencido, '#DC2626')}${tarjeta('Vence en 7 días', tramos.semana, '#F59E0B')}${tarjeta('8 a 30 días', tramos.mes, '#0D7A6B')}${tarjeta('Más de 30 días', tramos.despues, '#64748B')}</div>
    <div class="note" style="font-size:12px;color:var(--muted);margin:6px 0 14px">El vencimiento se calcula con el plazo de pago de cada proveedor (ficha del proveedor) o se escribe en la compra. Registra aquí cada pago, total o parcial.</div>
    ${grupos.length ? grupos.map(g => `
      <div class="card" style="padding:14px 16px">
        <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:8px"><b>${escP((proveedorDe(g.id) || {}).nombre || 'Proveedor eliminado')}</b><b style="color:#B91C1C">${pesos(g.saldo)}</b></div>
        <table class="tbl"><thead><tr><th>Fecha</th><th>Documento</th><th>Total</th><th>Pagado</th><th>Saldo</th><th>Vencimiento</th><th></th></tr></thead><tbody>
        ${g.l.sort((a, b) => vencimientoDe(a).localeCompare(vencimientoDe(b))).map(c => {
          const d = diasHasta(vencimientoDe(c));
          return `<tr><td>${fechaCorta(c.fecha)}</td><td>${escP(c.numeroDoc || '—')}${c.ocId ? ' <span style="font-size:10px;color:var(--muted)">(OC)</span>' : ''}</td><td>${pesos(compraMontoTotal(c))}</td><td>${pesos(pagadoDe(c))}</td><td><b>${pesos(saldoDe(c))}</b></td>
            <td style="color:${d < 0 ? '#B91C1C' : d <= 7 ? '#B45309' : 'inherit'};white-space:nowrap">${fechaCorta(vencimientoDe(c))}<div style="font-size:10px">${d < 0 ? 'vencida hace ' + (-d) + ' días' : d === 0 ? 'vence hoy' : 'en ' + d + ' días'}</div></td>
            <td style="white-space:nowrap"><button class="act-btn small primary" onclick="abrirPagoCompra(${c.id})">💲 Pagar</button></td></tr>`;
        }).join('')}
        </tbody></table>
      </div>`).join('') : '<div class="empty-state">No hay facturas pendientes de pago. 🎉</div>'}`;
}

// Modal de pagos de una compra (se crea una vez).
function modalPagos() {
  if ($e('modalPagoCompra')) return;
  const m = document.createElement('div');
  m.className = 'modal-bg'; m.id = 'modalPagoCompra';
  m.innerHTML = `<div class="modal" style="max-width:560px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h2 id="pc-titulo" style="margin:0">Pagos</h2><button class="act-btn" style="padding:4px 8px;font-size:16px;border:none" onclick="cerrarPagoCompra()">✕</button></div>
    <div id="pc-resumen" style="font-size:13px;margin-bottom:10px"></div>
    <div id="pc-lista" style="margin-bottom:12px"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div class="fld"><label>Fecha</label><input type="date" id="pc-fecha"></div>
      <div class="fld"><label>Monto</label><input type="number" id="pc-monto" min="1"></div>
      <div class="fld"><label>Medio</label><select id="pc-medio">${MEDIOS_PAGO_PROV.map(x => `<option>${x}</option>`).join('')}</select></div>
    </div>
    <div class="fld"><label>Observación (opcional)</label><input type="text" id="pc-obs" maxlength="150"></div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:10px"><button class="act-btn" onclick="cerrarPagoCompra()">Cerrar</button><button class="act-btn primary" onclick="registrarPagoCompra()">Registrar pago</button></div>
  </div>`;
  document.body.appendChild(m);
}
let pagoCompraId = null;
function abrirPagoCompra(id) {
  modalPagos();
  const c = compras.find(x => x.id === id); if (!c) return;
  pagoCompraId = id;
  $e('pc-titulo').textContent = 'Pagos · ' + ((proveedorDe(c.proveedorId) || {}).nombre || '') + (c.numeroDoc ? ' · Doc. ' + c.numeroDoc : '');
  $e('pc-resumen').innerHTML = `Total ${pesos(compraMontoTotal(c))} · Pagado ${pesos(pagadoDe(c))} · <b style="color:#B91C1C">Saldo ${pesos(saldoDe(c))}</b> · vence ${fechaCorta(vencimientoDe(c))}`;
  const pagos = pagosDe(c);
  $e('pc-lista').innerHTML = pagos.length ? pagos.map(p => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:6px 0;border-bottom:1px solid var(--border)">
      <span>${fechaCorta(p.fecha)} · ${escP(p.medio || '')}${p.obs ? ' · ' + escP(p.obs) : ''}</span>
      <span style="display:flex;gap:8px;align-items:center"><b>${pesos(p.monto)}</b>${p.antiguo ? '' : `<button class="icon-btn" title="Anular pago" onclick="anularPagoCompra('${p.id}')">✕</button>`}</span></div>`).join('')
    : '<div style="font-size:12px;color:var(--muted)">Sin pagos registrados.</div>';
  $e('pc-fecha').value = hoyChile();
  $e('pc-monto').value = saldoDe(c) || '';
  $e('pc-obs').value = '';
  $e('modalPagoCompra').classList.add('open');
}
function cerrarPagoCompra() { const m = $e('modalPagoCompra'); if (m) m.classList.remove('open'); pagoCompraId = null; }
function actualizarEstadoPago(c) {
  c.pagada = compraMontoTotal(c) - pagadoDe(c) <= 0;
  c.fechaPago = c.pagada ? (c.pagos.map(p => p.fecha).sort().pop() || '') : '';
}
function registrarPagoCompra() {
  if (!cargaOk.compras) { avisarSinNube(); return; }
  const c = compras.find(x => x.id === pagoCompraId); if (!c) return;
  const monto = Math.round(+$e('pc-monto').value || 0), fecha = $e('pc-fecha').value;
  if (monto <= 0 || !fecha) { alert('Indica la fecha y un monto mayor a cero.'); return; }
  if (monto > saldoDe(c) && !confirm('El pago (' + pesos(monto) + ') es mayor que el saldo (' + pesos(saldoDe(c)) + '). ¿Registrarlo igual?')) return;
  c.pagos = pagosDe(c).filter(p => !p.antiguo).concat([{ id: String(idNuevo()), fecha, monto, medio: $e('pc-medio').value, obs: $e('pc-obs').value.trim() }]);
  actualizarEstadoPago(c);
  guardarComprasLocal();
  abrirPagoCompra(c.id); renderPorPagar(); renderComprasTable();
}
function anularPagoCompra(pagoId) {
  const c = compras.find(x => x.id === pagoCompraId); if (!c || !confirm('¿Anular este pago?')) return;
  c.pagos = (c.pagos || []).filter(p => p.id !== pagoId);
  actualizarEstadoPago(c);
  guardarComprasLocal();
  abrirPagoCompra(c.id); renderPorPagar(); renderComprasTable();
}

// ------------------------------------------------------------------ órdenes de compra
const ESTADO_OC = { borrador: ['Borrador', '#64748B'], enviada: ['Enviada', '#1E40AF'], parcial: ['Recibida parcial', '#B45309'], recibida: ['Recibida', '#0D7A6B'], anulada: ['Anulada', '#9CA3AF'] };
function numOc(o) { return 'OC-' + String(o.numero || 0).padStart(4, '0'); }
function netoOc(o) { return Math.round((o.items || []).reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.precio) || 0), 0)); }
function recibidoDe(o, i) { return (o.recepciones || []).reduce((s, r) => s + (Number((r.items[i] || {}).cantidad) || 0), 0); }
function recalcularEstadoOc(o) {
  if (o.estado === 'anulada') return;
  const recs = (o.recepciones || []).length;
  if (!recs) return;
  const completa = (o.items || []).every((it, i) => recibidoDe(o, i) >= (Number(it.cantidad) || 0));
  o.estado = completa ? 'recibida' : 'parcial';
}
function guardarOrdenes() {
  localStorage.setItem(KEY_OC, JSON.stringify(ordenes));
  if (!cargaOcOk) { avisarSinNube(); return; }
  saveToCloud(KEY_OC, ordenes);
}
async function cargarOrdenes() {
  try {
    const res = await fetch(API_URL + '?key=' + KEY_OC + '&token=' + CLOUD_TOKEN);
    const j = await res.json();
    if (j.estado === 'error') throw new Error(j.detalle);
    ordenes = j.valor ? JSON.parse(j.valor) : [];
    cargaOcOk = true;
  } catch (e) {
    ordenes = JSON.parse(localStorage.getItem(KEY_OC) || '[]');
    cargaOcOk = false;
  }
}
function renderOrdenes() {
  const cont = $e('ordenesWrap');
  const lista = ordenes.slice().sort((a, b) => (b.numero || 0) - (a.numero || 0));
  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:10px;flex-wrap:wrap">
      <h2 style="font-family:'DM Serif Display',serif;font-size:20px">Órdenes de compra</h2>
      <button class="act-btn primary" onclick="abrirOc(null)">+ Nueva orden de compra</button>
    </div>
    ${lista.length ? `<table class="tbl"><thead><tr><th>N°</th><th>Fecha</th><th>Proveedor</th><th>Productos</th><th>Neto estimado</th><th>Entrega</th><th>Estado</th><th></th></tr></thead><tbody>${lista.map(o => {
      const [et, col] = ESTADO_OC[o.estado] || ESTADO_OC.borrador;
      const atrasada = ['enviada', 'parcial'].includes(o.estado) && o.entrega && o.entrega < hoyChile();
      return `<tr><td><b>${numOc(o)}</b></td><td>${fechaCorta(o.fecha)}</td><td>${escP((proveedorDe(o.proveedorId) || {}).nombre || '—')}</td>
        <td style="font-size:12px">${(o.items || []).map((it, i) => `${escP(it.producto)} ×${it.cantidad}${recibidoDe(o, i) ? ` <span style="color:var(--muted)">(recibido ${recibidoDe(o, i)})</span>` : ''}`).join('<br>')}</td>
        <td>${pesos(netoOc(o))}</td><td style="${atrasada ? 'color:#B91C1C;font-weight:700' : ''}">${fechaCorta(o.entrega)}${atrasada ? '<div style="font-size:10px">atrasada</div>' : ''}</td>
        <td><span class="bdg-pago" style="background:${col}1A;color:${col}">${et}</span></td>
        <td style="white-space:nowrap">
          ${['borrador', 'enviada'].includes(o.estado) ? `<button class="icon-btn" title="Editar" onclick="abrirOc(${o.id})">✏️</button>` : ''}
          <button class="icon-btn" title="PDF para el proveedor" onclick="pdfOc(${o.id})">📄</button>
          ${o.estado === 'borrador' ? `<button class="act-btn small" onclick="cambiarEstadoOc(${o.id},'enviada')">Marcar enviada</button>` : ''}
          ${['enviada', 'parcial'].includes(o.estado) ? `<button class="act-btn small primary" onclick="abrirRecepcion(${o.id})">📦 Recibir</button>` : ''}
          ${['borrador', 'enviada'].includes(o.estado) ? `<button class="icon-btn" title="Anular" onclick="cambiarEstadoOc(${o.id},'anulada')">🚫</button>` : ''}
        </td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty-state">No hay órdenes de compra. Crea una para pedir insumos a un proveedor.</div>'}`;
}
function cambiarEstadoOc(id, estado) {
  const o = ordenes.find(x => x.id === id); if (!o) return;
  if (estado === 'anulada' && !confirm('¿Anular la ' + numOc(o) + '?')) return;
  o.estado = estado; if (estado === 'enviada') o.enviada = hoyChile();
  guardarOrdenes(); renderOrdenes();
}

// Modal para crear/editar una OC (se crea una vez).
let ocEditId = null, ocItems = [];
function modalOc() {
  if ($e('modalOc')) return;
  const m = document.createElement('div');
  m.className = 'modal-bg'; m.id = 'modalOc';
  m.innerHTML = `<div class="modal" style="max-width:820px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2 id="oc-titulo" style="margin:0">Orden de compra</h2><button class="act-btn" style="padding:4px 8px;font-size:16px;border:none" onclick="$e('modalOc').classList.remove('open')">✕</button></div>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px">
      <div class="fld"><label>Proveedor *</label><select id="oc-proveedor" onchange="ocDatalist()"></select></div>
      <div class="fld"><label>Fecha</label><input type="date" id="oc-fecha"></div>
      <div class="fld"><label>Entrega esperada</label><input type="date" id="oc-entrega"></div>
    </div>
    <div class="sub-section"><div class="sub-title">Productos</div>
      <div class="compra-item-header" style="grid-template-columns:3fr 1fr 1fr 1.3fr 30px"><div>Producto</div><div>Cantidad</div><div>Unidad</div><div>Precio neto ref.</div><div></div></div>
      <div id="oc-items"></div>
      <button class="act-btn small" onclick="ocItems.push({producto:'',cantidad:1,unidad:'Unidad',precio:''});renderOcItems()">+ Agregar producto</button>
      <datalist id="oc-datalist"></datalist>
    </div>
    <div class="fld"><label>Notas para el proveedor</label><input type="text" id="oc-notas" maxlength="300"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px"><b id="oc-total"></b>
      <span style="display:flex;gap:10px"><button class="act-btn" onclick="$e('modalOc').classList.remove('open')">Cancelar</button><button class="act-btn primary" onclick="guardarOc()">Guardar</button></span></div>
  </div>`;
  document.body.appendChild(m);
}
function ocDatalist() {
  const p = proveedorDe($e('oc-proveedor').value);
  const nombres = new Set((p && p.insumos || []).map(i => i.insumo));
  compras.filter(c => p && String(c.proveedorId) === String(p.id)).forEach(c => (c.items || []).forEach(it => nombres.add(it.producto)));
  $e('oc-datalist').innerHTML = [...nombres].filter(Boolean).map(n => `<option value="${escP(n)}">`).join('');
}
function renderOcItems() {
  $e('oc-items').innerHTML = ocItems.map((it, i) => `<div class="compra-item-row" style="display:grid;grid-template-columns:3fr 1fr 1fr 1.3fr 30px;gap:8px;margin-bottom:6px">
    <input list="oc-datalist" value="${escP(it.producto)}" oninput="ocItems[${i}].producto=this.value">
    <input type="number" min="0" step="any" value="${it.cantidad}" oninput="ocItems[${i}].cantidad=this.value;totalOc()">
    <input value="${escP(it.unidad || 'Unidad')}" oninput="ocItems[${i}].unidad=this.value">
    <input type="number" min="0" value="${it.precio}" oninput="ocItems[${i}].precio=this.value;totalOc()">
    <button class="icon-btn" onclick="ocItems.splice(${i},1);if(!ocItems.length)ocItems.push({producto:'',cantidad:1,unidad:'Unidad',precio:''});renderOcItems()">✕</button></div>`).join('');
  totalOc();
}
function totalOc() { $e('oc-total').textContent = 'Neto estimado: ' + pesos(ocItems.reduce((s, it) => s + (+it.cantidad || 0) * (+it.precio || 0), 0)); }
function abrirOc(id) {
  modalOc();
  const o = id ? ordenes.find(x => x.id === id) : null;
  ocEditId = o ? o.id : null;
  $e('oc-titulo').textContent = o ? 'Editar ' + numOc(o) : 'Nueva orden de compra';
  $e('oc-proveedor').innerHTML = '<option value="">— Seleccionar —</option>' + proveedores.slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es')).map(p => `<option value="${p.id}">${escP(p.nombre)}</option>`).join('');
  $e('oc-proveedor').value = o ? String(o.proveedorId) : '';
  $e('oc-fecha').value = o ? o.fecha : hoyChile();
  $e('oc-entrega').value = o ? (o.entrega || '') : '';
  $e('oc-notas').value = o ? (o.notas || '') : '';
  ocItems = o ? JSON.parse(JSON.stringify(o.items)) : [{ producto: '', cantidad: 1, unidad: 'Unidad', precio: '' }];
  ocDatalist(); renderOcItems();
  $e('modalOc').classList.add('open');
}
function guardarOc() {
  const proveedorId = $e('oc-proveedor').value;
  const items = ocItems.filter(it => (it.producto || '').trim() && (+it.cantidad || 0) > 0).map(it => ({ producto: it.producto.trim(), cantidad: +it.cantidad, unidad: it.unidad || 'Unidad', precio: Math.round(+it.precio || 0) }));
  if (!proveedorId) { alert('Elige el proveedor.'); return; }
  if (!items.length) { alert('Agrega al menos un producto con cantidad.'); return; }
  const datos = { proveedorId: Number(proveedorId), fecha: $e('oc-fecha').value || hoyChile(), entrega: $e('oc-entrega').value, notas: $e('oc-notas').value.trim(), items };
  if (ocEditId) Object.assign(ordenes.find(x => x.id === ocEditId), datos);
  else ordenes.push(Object.assign({ id: idNuevo(), numero: Math.max(0, ...ordenes.map(x => x.numero || 0)) + 1, estado: 'borrador', recepciones: [] }, datos));
  guardarOrdenes(); $e('modalOc').classList.remove('open'); renderOrdenes();
}

// Recepción: cantidades recibidas ahora; opcionalmente crea la compra.
let recOcId = null;
function modalRecepcion() {
  if ($e('modalRec')) return;
  const m = document.createElement('div');
  m.className = 'modal-bg'; m.id = 'modalRec';
  m.innerHTML = `<div class="modal" style="max-width:720px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h2 id="rec-titulo" style="margin:0">Recibir</h2><button class="act-btn" style="padding:4px 8px;font-size:16px;border:none" onclick="$e('modalRec').classList.remove('open')">✕</button></div>
    <div id="rec-items"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px">
      <div class="fld"><label>Fecha de recepción</label><input type="date" id="rec-fecha"></div>
      <div class="fld"><label>N° factura / guía</label><input type="text" id="rec-doc"></div>
      <div class="fld"><label>Vencimiento factura</label><input type="date" id="rec-venc"></div>
    </div>
    <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:6px"><input type="checkbox" id="rec-compra" checked> Registrar la compra (factura) con lo recibido, a los precios de la orden</label>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px"><button class="act-btn" onclick="$e('modalRec').classList.remove('open')">Cancelar</button><button class="act-btn primary" onclick="guardarRecepcion()">Confirmar recepción</button></div>
  </div>`;
  document.body.appendChild(m);
}
function abrirRecepcion(id) {
  modalRecepcion();
  const o = ordenes.find(x => x.id === id); if (!o) return;
  recOcId = id;
  $e('rec-titulo').textContent = 'Recibir ' + numOc(o) + ' · ' + ((proveedorDe(o.proveedorId) || {}).nombre || '');
  $e('rec-items').innerHTML = `<table class="tbl"><thead><tr><th>Producto</th><th>Pedido</th><th>Ya recibido</th><th>Recibido ahora</th></tr></thead><tbody>${o.items.map((it, i) => {
    const pend = Math.max(0, it.cantidad - recibidoDe(o, i));
    return `<tr><td>${escP(it.producto)}</td><td>${it.cantidad} ${escP(it.unidad || '')}</td><td>${recibidoDe(o, i)}</td><td><input type="number" min="0" step="any" id="rec-cant-${i}" value="${pend}" style="width:90px"></td></tr>`;
  }).join('')}</tbody></table>`;
  $e('rec-fecha').value = hoyChile(); $e('rec-doc').value = '';
  const p = proveedorDe(o.proveedorId);
  $e('rec-venc').value = sumarDiasIso(hoyChile(), p && p.plazoPagoDias ? p.plazoPagoDias : 0);
  $e('modalRec').classList.add('open');
}
function guardarRecepcion() {
  if (!cargaOcOk || !cargaOk.compras) { avisarSinNube(); return; }
  const o = ordenes.find(x => x.id === recOcId); if (!o) return;
  const recibidos = o.items.map((it, i) => ({ producto: it.producto, cantidad: Math.max(0, +($e('rec-cant-' + i).value) || 0) }));
  if (!recibidos.some(r => r.cantidad > 0)) { alert('Indica al menos una cantidad recibida.'); return; }
  const fecha = $e('rec-fecha').value || hoyChile();
  const rec = { id: idNuevo(), fecha, numeroDoc: $e('rec-doc').value.trim(), items: recibidos };
  if ($e('rec-compra').checked) {
    const items = o.items.map((it, i) => ({ producto: it.producto, cantidad: recibidos[i].cantidad, unidad: it.unidad || 'Unidad', montoNeto: it.precio || 0, subtotal: Math.round(recibidos[i].cantidad * (it.precio || 0)) })).filter(it => it.cantidad > 0);
    const subtotalNeto = items.reduce((s, it) => s + it.subtotal, 0), iva = Math.round(subtotalNeto * IVA_PCT / 100);
    const compra = { id: idNuevo(), fecha, proveedorId: o.proveedorId, items, subtotalNeto, iva, total: subtotalNeto + iva, pagada: false, fechaPago: '', pagos: [], numeroDoc: rec.numeroDoc, vencimiento: $e('rec-venc').value, ocId: o.id, recepcionId: rec.id };
    compras.push(compra);
    rec.compraId = compra.id;
    guardarComprasLocal();
  }
  o.recepciones = (o.recepciones || []).concat([rec]);
  recalcularEstadoOc(o);
  guardarOrdenes();
  $e('modalRec').classList.remove('open');
  renderOrdenes();
  alert(numOc(o) + ': recepción registrada' + (rec.compraId ? ' y compra creada (queda en Por pagar).' : '.'));
}

// PDF de la OC para enviar al proveedor.
async function pdfOc(id) {
  const o = ordenes.find(x => x.id === id); if (!o) return;
  if (!window.jspdf || !window.jspdf.jsPDF) { alert('No se pudo cargar el generador de PDF. Revisa tu conexión.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const p = proveedorDe(o.proveedorId) || {};
  let y = 18;
  if (window.CREAMOS_BRAND && window.CREAMOS_BRAND.addLogoToPdf) { try { await window.CREAMOS_BRAND.addLogoToPdf(doc, 15, 10, 45, false); y = 30; } catch (e) {} }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Orden de compra ' + numOc(o), 15, y);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  y += 8; doc.text('Fecha: ' + fechaCorta(o.fecha) + (o.entrega ? '    Entrega esperada: ' + fechaCorta(o.entrega) : ''), 15, y);
  y += 6; doc.text('Proveedor: ' + (p.nombre || '') + (p.rut ? '  ·  RUT ' + p.rut : ''), 15, y);
  if (p.contacto || p.telefono) { y += 5; doc.text('Contacto: ' + [p.contacto, p.telefono].filter(Boolean).join(' · '), 15, y); }
  doc.autoTable({ startY: y + 6, head: [['Producto', 'Cantidad', 'Unidad', 'Precio neto', 'Subtotal']],
    body: o.items.map(it => [it.producto, String(it.cantidad), it.unidad || '', pesos(it.precio), pesos(it.cantidad * it.precio)]),
    styles: { fontSize: 9 }, headStyles: { fillColor: [20, 20, 20], textColor: [241, 175, 19] } });
  let f = doc.lastAutoTable.finalY + 8;
  const neto = netoOc(o), iva = Math.round(neto * IVA_PCT / 100);
  doc.text('Neto: ' + pesos(neto) + '    IVA: ' + pesos(iva) + '    Total: ' + pesos(neto + iva), 15, f);
  if (o.notas) { f += 8; doc.text(doc.splitTextToSize('Notas: ' + o.notas, 180), 15, f); }
  doc.save(numOc(o) + '_' + (p.nombre || 'proveedor').replace(/[^A-Za-z0-9]+/g, '_') + '.pdf');
}

// ------------------------------------------------------------------ inicio
window.addEventListener('load', async () => {
  await cargarOrdenes();
  const vista = document.querySelector('#view-porpagar, #view-oc');
  if (vista && vista.style.display === 'block') setTab(vista.id.replace('view-', ''));
});
