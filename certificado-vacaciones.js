// Certificado (comprobante) de feriado legal, compartido por Mi Portal y RRHH.
// Firmas electrónicas simples (Ley 19.799) registradas en el servidor
// (llave rrhh_firmas_vac_v1): empleador al aprobar, trabajador desde Mi Portal.
(function (global) {
  const EMPRESA = {
    nombre: 'IMPORTACIÓN Y COMERCIALIZACIÓN DE ARTÍCULOS PUBLICITARIOS E IMPRESIONES GRÁFICAS LIMITADA',
    fantasia: 'Creamos Imagen Ltda.',
    rut: '76.460.575-6',
    domicilio: 'Río de Janeiro 319, Recoleta, Santiago',
    web: 'creamosimagen.vercel.app'
  };
  // Colores de la marca (los mismos del PDF de cotizaciones).
  const NEGRO = [20, 20, 20], DORADO = [241, 175, 19], DORADO_OSC = [150, 105, 20], CREMA = [247, 245, 240], GRIS = [110, 110, 110], VERDE = [13, 122, 107];
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const fLarga = s => s ? (+s.slice(8, 10)) + ' de ' + MESES[+s.slice(5, 7) - 1] + ' de ' + s.slice(0, 4) : '—';
  const fCorta = s => s ? s.slice(8, 10) + '-' + s.slice(5, 7) + '-' + s.slice(0, 4) : '—';
  const fHora = s => s ? fCorta(s) + ' · ' + s.slice(11, 16) + ' h' : '';
  const nombreT = t => (((t && t.nombres) || '') + ' ' + ((t && t.apellidos) || '')).trim();

  // Logo (PNG) cargado una vez como dataURL.
  let logoPromesa = null;
  function cargarLogo() {
    if (!logoPromesa) logoPromesa = fetch('brand/logo-horizontal.png').then(r => r.ok ? r.blob() : null).then(b => b ? new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(b); }) : null).catch(() => null);
    return logoPromesa;
  }

  // Primer día hábil después del término (sin sábados, domingos ni feriados).
  function reintegro(fin) {
    // FER (feriados-chile.js) es una constante global de script, no una propiedad de window.
    const fer = typeof FER !== 'undefined' && Array.isArray(FER) ? FER : (Array.isArray(global.FER) ? global.FER : []);
    let d = new Date(Date.UTC(+fin.slice(0, 4), +fin.slice(5, 7) - 1, +fin.slice(8, 10)));
    for (let i = 0; i < 20; i++) {
      d = new Date(d.getTime() + 86400000);
      const iso = d.toISOString().slice(0, 10), dia = d.getUTCDay();
      if (dia !== 0 && dia !== 6 && fer.indexOf(iso) === -1) return iso;
    }
    return '';
  }

  function estado(firma) {
    if (!firma || !firma.empleador) return 'sin_empleador';
    if (!firma.trabajador) return 'falta_trabajador';
    return 'completo';
  }

  // vac: registro aprobado; trabajador: ficha; firma: registro de firmas; saldo: días disponibles (opcional).
  async function generar(vac, trabajador, firma, saldo) {
    if (!global.jspdf || !global.jspdf.jsPDF) { alert('No se pudo cargar el generador de PDF. Revisa tu conexión y recarga la página.'); return; }
    const logo = await cargarLogo();
    const datos = (firma && firma.datos) || vac;
    const doc = new global.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 50;
    const color = (c, tipo) => tipo === 'fill' ? doc.setFillColor(c[0], c[1], c[2]) : tipo === 'draw' ? doc.setDrawColor(c[0], c[1], c[2]) : doc.setTextColor(c[0], c[1], c[2]);
    const t = (s, x, y, op) => doc.text(String(s), x, y, op || {});

    // ---- Encabezado: franjas de marca + logo + título
    color(NEGRO, 'fill'); doc.rect(0, 0, W, 8, 'F');
    color(DORADO, 'fill'); doc.rect(0, 8, W, 3, 'F');
    if (logo) doc.addImage(logo, 'PNG', M, 28, 128, 47, undefined, 'FAST');
    else { doc.setFont('helvetica', 'bold'); doc.setFontSize(20); color(NEGRO); t('Creamos', M, 50); color(DORADO); t('IMAGEN', M, 72); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); color(NEGRO);
    t('COMPROBANTE DE FERIADO LEGAL', W - M, 46, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); color(GRIS);
    t('Vacaciones · Art. 67 y siguientes del Código del Trabajo', W - M, 61, { align: 'right' });
    doc.setFontSize(8.5);
    t('N° ' + vac.id + '  ·  Emitido el ' + fCorta(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })), W - M, 75, { align: 'right' });
    color(DORADO, 'draw'); doc.setLineWidth(1); doc.line(M, 92, W - M, 92);

    let y = 116;
    // ---- Secciones de datos
    const seccion = (titulo, filas) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); color(DORADO_OSC); t(titulo.toUpperCase(), M, y); y += 8;
      const alto = filas.reduce((s, f) => s + doc.splitTextToSize(String(f[1]), W - 2 * M - 150).length * 12.5 + 5, 10);
      color(CREMA, 'fill'); doc.rect(M, y, W - 2 * M, alto, 'F');
      color(DORADO, 'fill'); doc.rect(M, y, 3, alto, 'F');
      let yy = y + 17;
      filas.forEach(f => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); color(GRIS); t(f[0], M + 14, yy);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); color(NEGRO);
        const l = doc.splitTextToSize(String(f[1]), W - 2 * M - 150); doc.text(l, M + 130, yy); yy += l.length * 12.5 + 5;
      });
      y += alto + 18;
    };
    seccion('Empleador', [['Razón social', EMPRESA.nombre], ['RUT', EMPRESA.rut], ['Domicilio', EMPRESA.domicilio]]);
    seccion('Trabajador', [['Nombre', nombreT(trabajador) || '—'], ['RUT', (trabajador && trabajador.rut) || '—'], ['Cargo', (trabajador && trabajador.cargo) || '—'], ['Fecha de ingreso', trabajador && trabajador.fechaIngreso ? fLarga(trabajador.fechaIngreso) : '—']]);

    // ---- Resumen del feriado en recuadros
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); color(DORADO_OSC); t('FERIADO', M, y); y += 8;
    const cajas = [['DESDE', fCorta(datos.fechaInicio)], ['HASTA', fCorta(datos.fechaFin)], ['DÍAS HÁBILES', String(datos.dias).replace('.', ',')], ['REINTEGRO', fCorta(reintegro(datos.fechaFin))]];
    const gap = 8, cw = (W - 2 * M - gap * 3) / 4;
    cajas.forEach((c, i) => {
      const x = M + i * (cw + gap);
      color(NEGRO, 'fill'); doc.roundedRect(x, y, cw, 50, 4, 4, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); color(DORADO); t(c[0], x + cw / 2, y + 17, { align: 'center' });
      doc.setFontSize(14); doc.setTextColor(255, 255, 255); t(c[1], x + cw / 2, y + 37, { align: 'center' });
    });
    y += 64;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); color(GRIS);
    t('Del ' + fLarga(datos.fechaInicio) + ' al ' + fLarga(datos.fechaFin) + (saldo !== undefined && saldo !== null ? '  ·  Saldo disponible a la fecha de emisión: ' + String(Math.round(saldo * 100) / 100).replace('.', ',') + ' días hábiles' : ''), M, y);
    y += 24;

    // ---- Texto legal
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); color(NEGRO);
    const parrafo = s => { const l = doc.splitTextToSize(s, W - 2 * M); doc.text(l, M, y, { lineHeightFactor: 1.45 }); y += l.length * 14.5 + 8; };
    parrafo('Por el presente documento, el empleador y el trabajador individualizados dejan constancia de que el trabajador hará uso de su feriado legal anual durante el período indicado, con derecho a su remuneración íntegra, conforme a los artículos 67 y siguientes del Código del Trabajo. Los días se cuentan como hábiles, excluidos los sábados, domingos y festivos.');
    parrafo('Ambas partes firman este comprobante en señal de conformidad mediante firma electrónica simple, de acuerdo con la Ley N° 19.799, en el portal de Creamos Imagen.');

    // ---- Firmas (más abajo, con espacio para la firma)
    const yFirma = Math.max(y + 90, H - 190);
    const col = (W - 2 * M) / 2;
    const bloque = (x, titulo, sub, f) => {
      const cx = x + col / 2;
      if (f) {
        doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(15); color(NEGRO); t(f.nombre, cx, yFirma - 14, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); color(VERDE); t('FIRMADO ELECTRÓNICAMENTE', cx, yFirma - 32, { align: 'center' });
      } else {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(192, 57, 43); t('Pendiente de firma', cx, yFirma - 14, { align: 'center' });
      }
      color(NEGRO, 'draw'); doc.setLineWidth(0.8); doc.line(x + 25, yFirma, x + col - 25, yFirma);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); color(NEGRO); t(titulo, cx, yFirma + 15, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); color(GRIS); t(sub, cx, yFirma + 28, { align: 'center' });
      if (f) { t(f.email, cx, yFirma + 40, { align: 'center' }); t(fHora(f.en), cx, yFirma + 52, { align: 'center' }); }
    };
    bloque(M, 'EMPLEADOR', EMPRESA.fantasia, firma && firma.empleador);
    bloque(M + col, 'TRABAJADOR', trabajador && trabajador.rut ? 'RUT ' + trabajador.rut : '', firma && firma.trabajador);

    // ---- Pie
    color(DORADO, 'fill'); doc.rect(0, H - 58, W, 2, 'F');
    color(NEGRO, 'fill'); doc.rect(0, H - 56, W, 56, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(230, 230, 230);
    t(EMPRESA.fantasia + '  ·  RUT ' + EMPRESA.rut + '  ·  ' + EMPRESA.domicilio, W / 2, H - 36, { align: 'center' });
    color(DORADO);
    t(firma && firma.codigo ? 'Código de verificación: ' + firma.codigo + '  ·  Firmas registradas en el portal de Creamos Imagen' : 'Documento pendiente de firma: aún no tiene código de verificación', W / 2, H - 22, { align: 'center' });

    doc.save('Comprobante_feriado_' + (nombreT(trabajador).replace(/\s+/g, '_') || 'trabajador') + '_' + datos.fechaInicio + '.pdf');
  }

  global.CertificadoVacaciones = { generar, estado, reintegro };
})(window);
