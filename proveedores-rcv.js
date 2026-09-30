// Importar el Registro de Compras (RCV) del SII a Proveedores.
// Archivos: "RCV_COMPRA_REGISTRO_<rut>_<AAAAMM>.csv" descargados desde sii.cl
// (separados por ";"). Crea los proveedores que falten (por RUT) y las
// facturas que no estén ingresadas (mismo RUT + tipo + folio). Las compras
// ingresadas a mano sin folio que coinciden en proveedor, total y fecha
// (±5 días) se muestran como posibles duplicados para decidir.
// Cada compra lleva categoría: insumos, arriendo, servicios, seguros, peajes
// o combustible (Finanzas usa arriendo y servicios reales en vez de estimados).
(function () {
  const $r = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pesosR = n => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n || 0)).toLocaleString('es-CL');
  const TIPOS = { '33': 'Factura', '34': 'Factura exenta', '46': 'Factura de compra', '56': 'Nota de débito', '61': 'Nota de crédito' };
  const CATEGORIAS = { insumos: 'Insumos / mercadería', arriendo: 'Arriendo', servicios: 'Servicios básicos', seguros: 'Seguros', peajes: 'Peajes', combustible: 'Combustible' };
  window.CATEGORIAS_COMPRA = CATEGORIAS;
  const normRut = s => String(s || '').replace(/[^0-9kK]/g, '').toUpperCase();
  const normNom = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(s\.?a\.?|spa|ltda\.?|limitada|sociedad anonima|eirl|s a)\b/g, '').replace(/[^a-z0-9]/g, '');
  const num = s => { const n = Number(String(s || '').trim().replace(',', '.')); return isFinite(n) ? n : 0; };
  const fechaISO = s => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };

  function categoria(d) {
    const nom = d.razon.toUpperCase();
    if (d.tipo === '34' && normRut(d.rut) === '9478381K') return 'arriendo';
    if (/CONCESIONARIA|AUTOPISTA|RUTA 5|RUTA DEL|COSTANERA|VESPUCIO/.test(nom)) return 'peajes';
    if (/HDI SEGUROS|SEGUROS/.test(nom)) return 'seguros';
    if (/ENEL|GTD|WOM|RED GLOBAL|AGUAS ANDINAS|METROGAS|ENTEL|MOVISTAR|CLARO/.test(nom)) return 'servicios';
    if (d.codOtro === '28' || /PETROPRIX|COPEC|SHELL|PETROBRAS|ARAMCO/.test(nom)) return 'combustible';
    return 'insumos';
  }

  function parsear(texto, nombreArchivo) {
    const lineas = texto.replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (!lineas.length) return [];
    const cab = lineas[0].split(';').map(s => s.trim());
    const col = n => cab.indexOf(n);
    const need = ['Tipo Doc', 'RUT Proveedor', 'Razon Social', 'Folio', 'Fecha Docto', 'Monto Total'];
    if (need.some(n => col(n) === -1)) throw new Error('"' + nombreArchivo + '" no parece un Registro de Compras del SII (faltan columnas).');
    return lineas.slice(1).map(l => {
      const c = l.split(';');
      const v = n => (col(n) >= 0 ? c[col(n)] : '') || '';
      const d = {
        tipo: v('Tipo Doc').trim(), rut: v('RUT Proveedor').trim(), razon: v('Razon Social').trim(), folio: v('Folio').trim(),
        fecha: fechaISO(v('Fecha Docto')), exento: num(v('Monto Exento')), neto: num(v('Monto Neto')) + num(v('Monto Neto Activo Fijo')),
        iva: num(v('Monto IVA Recuperable')) + num(v('IVA Activo Fijo')), ivaNoRec: num(v('Monto Iva No Recuperable')),
        otro: num(v('Valor Otro Impuesto')), codOtro: v('Codigo Otro Impuesto').trim(), total: num(v('Monto Total'))
      };
      return d.rut && d.folio && d.fecha ? d : null;
    }).filter(Boolean);
  }

  function leerArchivo(f) {
    return new Promise((res, rej) => {
      const intentar = enc => { const fr = new FileReader(); fr.onload = () => { const t = fr.result; if (enc === 'utf-8' && t.includes('�')) intentar('windows-1252'); else res(t); }; fr.onerror = () => rej(new Error('No se pudo leer ' + f.name)); fr.readAsText(f, enc); };
      intentar('utf-8');
    });
  }

  let PLAN = null;

  function planificar(docs) {
    const porRut = {};
    proveedores.forEach(p => { if (p.rut) porRut[normRut(p.rut)] = p; });
    const porNombre = {};
    proveedores.forEach(p => { porNombre[normNom(p.nombre)] = p; });
    const nuevosProv = {}, completarRut = {};
    const claveDoc = (rut, tipo, folio) => normRut(rut) + '|' + tipo + '|' + String(folio).replace(/^0+/, '');
    const existentes = new Set();
    // Ya ingresadas: por RUT + tipo + folio, y por proveedor + folio (sirve si el proveedor aún no tiene RUT).
    const folioN = f => String(f).trim().replace(/^0+/, "");
    compras.forEach(c => {
      if (!c.numeroDoc) return;
      const p = proveedorDe(c.proveedorId), tipos = c.tipoDoc ? [c.tipoDoc] : ["33", "34", "61", "56", "46"];
      tipos.forEach(t => { if (p && p.rut) existentes.add(claveDoc(p.rut, t, c.numeroDoc)); existentes.add("P" + c.proveedorId + "|" + t + "|" + folioN(c.numeroDoc)); });
    });
    const vistos = new Set();
    const filas = [];
    docs.forEach(d => {
      const k = claveDoc(d.rut, d.tipo, d.folio);
      if (vistos.has(k)) return; vistos.add(k);
      const rutN = normRut(d.rut);
      let prov = porRut[rutN] || null;
      if (!prov && porNombre[normNom(d.razon)] && !porNombre[normNom(d.razon)].rut) { prov = porNombre[normNom(d.razon)]; completarRut[prov.id] = d.rut; }
      if (!prov) { prov = nuevosProv[rutN] || (nuevosProv[rutN] = { nuevo: true, rut: d.rut, nombre: d.razon, categoria: categoria(d) }); }
      const signo = d.tipo === '61' ? -1 : 1;
      const yaEsta = existentes.has(k) || (!prov.nuevo && existentes.has('P' + prov.id + '|' + d.tipo + '|' + folioN(d.folio)));
      const fila = { d, prov, signo, categoria: categoria(d), estado: yaEsta ? 'existe' : 'nueva', posibles: [] };
      if (fila.estado === 'nueva' && !prov.nuevo) {
        // Posibles duplicados: compras del mismo proveedor sin folio, mismo total y fecha cercana.
        fila.posibles = compras.filter(c => String(c.proveedorId) === String(prov.id) && !c.numeroDoc && Math.abs(compraMontoTotal(c) - d.total) <= 1 &&
          Math.abs((Date.parse(c.fecha) - Date.parse(d.fecha)) / 86400000) <= 5);
        if (fila.posibles.length) fila.estado = 'posible';
      }
      filas.push(fila);
    });
    return { filas, nuevosProv: Object.values(nuevosProv), completarRut };
  }

  function renderPlan() {
    const p = PLAN; if (!p) return;
    const nuevas = p.filas.filter(f => f.estado === 'nueva'), posibles = p.filas.filter(f => f.estado === 'posible'), existen = p.filas.filter(f => f.estado === 'existe');
    const porCat = {};
    nuevas.concat(posibles.filter(f => f.incluir)).forEach(f => { porCat[f.categoria] = (porCat[f.categoria] || 0) + f.signo * f.d.total; });
    const meses = [...new Set(p.filas.map(f => f.d.fecha.slice(0, 7)))].sort();
    $r('rcv-resumen').innerHTML = `
      <div class="rcv-kpis">
        <div><b>${p.filas.length}</b><span>documentos (${meses.length ? meses[0] + ' a ' + meses[meses.length - 1] : '—'})</span></div>
        <div><b>${nuevas.length}</b><span>facturas nuevas a ingresar</span></div>
        <div><b>${existen.length}</b><span>ya estaban ingresadas (se omiten)</span></div>
        <div><b>${p.nuevosProv.length}</b><span>proveedores nuevos</span></div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin:6px 0 10px">Por categoría (con IVA): ${Object.keys(porCat).map(k => CATEGORIAS[k] + ' ' + pesosR(porCat[k])).join(' · ') || '—'}</div>
      ${p.nuevosProv.length ? `<details style="margin-bottom:10px"><summary style="cursor:pointer;font-size:13px;font-weight:600">Proveedores que se crearán (${p.nuevosProv.length})</summary><div style="font-size:12px;margin-top:6px;line-height:1.7">${p.nuevosProv.map(n => esc(n.nombre) + ' <span style="color:var(--muted)">' + esc(n.rut) + ' · ' + CATEGORIAS[n.categoria] + '</span>').join('<br>')}</div></details>` : ''}
      ${Object.keys(p.completarRut).length ? `<div style="font-size:12px;margin-bottom:10px">Se completará el RUT de ${Object.keys(p.completarRut).length} proveedor(es) que ya existían sin RUT.</div>` : ''}
      ${posibles.length ? `<div class="rcv-aviso"><b>${posibles.length} posible(s) duplicado(s):</b> facturas del RCV que se parecen a compras que ingresaste a mano sin folio (mismo proveedor y total, fecha cercana). Marca solo las que sean realmente distintas.
        <table class="tbl" style="margin-top:8px;font-size:12px"><thead><tr><th>Importar</th><th>Factura del RCV</th><th>Compra ya ingresada</th></tr></thead><tbody>${posibles.map((f, i) => `<tr><td><input type="checkbox" onchange="rcvIncluir(${p.filas.indexOf(f)}, this.checked)" ${f.incluir ? 'checked' : ''}></td><td>${esc(f.d.fecha)} · ${esc(f.d.razon)} · N° ${esc(f.d.folio)} · ${pesosR(f.d.total)}</td><td>${f.posibles.map(c => esc(c.fecha) + ' · ' + pesosR(compraMontoTotal(c))).join('<br>')}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
    $r('rcv-importar').disabled = !(nuevas.length || posibles.some(f => f.incluir) || Object.keys(p.completarRut).length);
  }
  window.rcvIncluir = (i, v) => { PLAN.filas[i].incluir = v; renderPlan(); };

  window.abrirImportarRCV = function () {
    PLAN = null; $r('rcv-archivos').value = ''; $r('rcv-resumen').innerHTML = '<div style="font-size:13px;color:var(--muted)">Selecciona uno o varios archivos del Registro de Compras.</div>'; $r('rcv-importar').disabled = true;
    $r('modalRCV').classList.add('open');
  };
  window.cerrarImportarRCV = () => $r('modalRCV').classList.remove('open');

  window.rcvArchivos = async function (input) {
    try {
      let docs = [];
      for (const f of input.files) docs = docs.concat(parsear(await leerArchivo(f), f.name));
      if (!docs.length) throw new Error('Los archivos no traen documentos.');
      PLAN = planificar(docs);
      renderPlan();
    } catch (e) { $r('rcv-resumen').innerHTML = '<div class="rcv-aviso">' + esc(e.message) + '</div>'; $r('rcv-importar').disabled = true; }
  };

  window.rcvImportar = function () {
    if (!PLAN) return;
    if (!cargaOk.proveedores || !cargaOk.compras) { avisarSinNube(); return; }
    const pagadas = $r('rcv-pagadas').checked;
    let idBase = Date.now();
    const provId = {};
    // Proveedores nuevos y RUT faltantes
    PLAN.nuevosProv.forEach(n => {
      const rn = normRut(n.rut);
      const p = { id: idBase++, nombre: n.nombre, rut: n.rut.toUpperCase(), rutDv: n.rut.slice(-1).toUpperCase(), tipoVia: '', calle: '', altura: '', region: '', referencia: '', direccion: '', comuna: '',
        rubro: CATEGORIAS[n.categoria], contacto: '', telefono: '', condicionesPago: '', plazoPagoDias: null, plazoEntrega: '', insumos: [], origen: 'RCV SII' };
      proveedores.push(p); provId[rn] = p.id;
    });
    Object.keys(PLAN.completarRut).forEach(id => { const p = proveedores.find(x => String(x.id) === String(id)); if (p && !p.rut) { p.rut = PLAN.completarRut[id].toUpperCase(); p.rutDv = p.rut.slice(-1); } });
    // Facturas
    let n = 0;
    PLAN.filas.filter(f => f.estado === 'nueva' || (f.estado === 'posible' && f.incluir)).forEach(f => {
      const d = f.d, s = f.signo;
      const pid = f.prov.nuevo ? provId[normRut(f.prov.rut)] : f.prov.id;
      const total = s * d.total, iva = s * d.iva, neto = total - iva;
      const etiqueta = CATEGORIAS[f.categoria] + ' · ' + (TIPOS[d.tipo] || 'Doc. ' + d.tipo) + ' N° ' + d.folio;
      const c = { id: idBase++, fecha: d.fecha, proveedorId: pid, tipoDoc: d.tipo, numeroDoc: d.folio, categoria: f.categoria, origen: 'RCV SII',
        items: [{ producto: etiqueta, cantidad: 1, unidad: 'Unidad', montoNeto: neto, subtotal: neto }],
        subtotalNeto: neto, iva: iva, total: total, exento: s * d.exento, otroImpuesto: s * d.otro,
        pagos: pagadas ? [{ id: String(idBase++), fecha: d.fecha, monto: total, medio: '', obs: 'Importada del RCV como pagada' }] : [],
        pagada: pagadas || total <= 0, fechaPago: pagadas ? d.fecha : '', vencimiento: d.fecha };
      compras.push(c); n++;
    });
    guardarProveedoresLocal();
    guardarComprasLocal();
    cerrarImportarRCV();
    if (typeof renderProveedores === 'function') renderProveedores();
    renderConcentracion(); renderComprasTable();
    alert('Importación lista: ' + n + ' factura(s) y ' + PLAN.nuevosProv.length + ' proveedor(es) nuevos.');
    PLAN = null;
  };
})();
