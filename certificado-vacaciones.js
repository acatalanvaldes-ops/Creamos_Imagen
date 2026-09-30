// Certificado (comprobante) de feriado legal, compartido por Mi Portal y RRHH.
// Firmas electrónicas simples (Ley 19.799) registradas en el servidor
// (llave rrhh_firmas_vac_v1): empleador al aprobar, trabajador desde Mi Portal.
(function (global) {
  const EMPRESA = {
    nombre: 'IMPORTACIÓN Y COMERCIALIZACIÓN DE ARTÍCULOS PUBLICITARIOS E IMPRESIONES GRÁFICAS LIMITADA',
    fantasia: 'Creamos Imagen Ltda.',
    rut: '76.460.575-6',
    domicilio: 'Río de Janeiro 319, Recoleta, Santiago'
  };
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const fLarga = s => s ? (+s.slice(8, 10)) + ' de ' + MESES[+s.slice(5, 7) - 1] + ' de ' + s.slice(0, 4) : '—';
  const fHora = s => s ? s.slice(8, 10) + '-' + s.slice(5, 7) + '-' + s.slice(0, 4) + ' a las ' + s.slice(11, 16) + ' h' : '';
  const nombreT = t => ((t && t.nombres) || '') + ' ' + ((t && t.apellidos) || '');

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

  // Estado de firmas para mostrar en tablas.
  function estado(firma) {
    if (!firma || !firma.empleador) return 'sin_empleador';
    if (!firma.trabajador) return 'falta_trabajador';
    return 'completo';
  }

  // vac: registro aprobado; trabajador: ficha; firma: registro de firmas; saldo: días disponibles (opcional).
  function generar(vac, trabajador, firma, saldo) {
    if (!global.jspdf || !global.jspdf.jsPDF) { alert('No se pudo cargar el generador de PDF. Revisa tu conexión y recarga la página.'); return; }
    const datos = (firma && firma.datos) || vac;
    const doc = new global.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
    const W = doc.internal.pageSize.getWidth(), M = 56;
    let y = 60;
    const texto = (s, x, yy, op) => doc.text(String(s), x, yy, op || {});
    const parrafo = (s, tam) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(tam || 10.5); const l = doc.splitTextToSize(s, W - 2 * M); doc.text(l, M, y); y += l.length * (tam ? tam * 1.35 : 14.5) + 6; };

    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120);
    texto(EMPRESA.fantasia + ' · RUT ' + EMPRESA.rut, M, 40);
    doc.setTextColor(20); doc.setFontSize(15);
    texto('COMPROBANTE DE FERIADO LEGAL (VACACIONES)', W / 2, y, { align: 'center' }); y += 16;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90);
    texto('Artículos 67 y siguientes del Código del Trabajo', W / 2, y, { align: 'center' }); y += 28;
    doc.setTextColor(20);

    const fila = (a, b) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); texto(a, M, y); doc.setFont('helvetica', 'normal'); const l = doc.splitTextToSize(String(b), W - M - 190); doc.text(l, M + 160, y); y += l.length * 14 + 4; };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(124, 90, 30); texto('EMPLEADOR', M, y); y += 16; doc.setTextColor(20);
    fila('Razón social', EMPRESA.nombre); fila('RUT', EMPRESA.rut); fila('Domicilio', EMPRESA.domicilio); y += 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(124, 90, 30); texto('TRABAJADOR', M, y); y += 16; doc.setTextColor(20);
    fila('Nombre', nombreT(trabajador).trim() || '—'); fila('RUT', (trabajador && trabajador.rut) || '—'); fila('Cargo', (trabajador && trabajador.cargo) || '—');
    fila('Fecha de ingreso', trabajador && trabajador.fechaIngreso ? fLarga(trabajador.fechaIngreso) : '—'); y += 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(124, 90, 30); texto('FERIADO', M, y); y += 16; doc.setTextColor(20);
    fila('Desde', fLarga(datos.fechaInicio)); fila('Hasta', fLarga(datos.fechaFin));
    fila('Días hábiles', String(datos.dias).replace('.', ',') + (Number(datos.dias) === 1 ? ' día hábil' : ' días hábiles'));
    fila('Reintegro', fLarga(reintegro(datos.fechaFin)));
    if (saldo !== undefined && saldo !== null) fila('Saldo disponible', String(Math.round(saldo * 100) / 100).replace('.', ',') + ' días hábiles a la fecha de emisión');
    y += 10;

    parrafo('Por el presente documento, el empleador y el trabajador individualizados dejan constancia de que el trabajador hará uso de su feriado legal anual durante el período indicado, con derecho a su remuneración íntegra, conforme a los artículos 67 y siguientes del Código del Trabajo. Los días se cuentan como hábiles, excluidos los sábados, domingos y festivos.');
    parrafo('Ambas partes firman este comprobante en señal de conformidad mediante firma electrónica simple, de acuerdo con la Ley N° 19.799, en el portal de Creamos Imagen.');
    y += 26;

    // Firmas
    const col = (W - 2 * M) / 2;
    const bloque = (x, titulo, f, pendiente) => {
      doc.setDrawColor(150); doc.line(x + 10, y, x + col - 20, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); texto(titulo, x + col / 2 - 5, y + 14, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      if (f) {
        doc.setTextColor(13, 122, 107); texto('Firmado electrónicamente', x + col / 2 - 5, y - 26, { align: 'center' }); doc.setTextColor(20);
        texto(f.nombre, x + col / 2 - 5, y - 13, { align: 'center' });
        texto(f.email, x + col / 2 - 5, y + 27, { align: 'center' });
        texto(fHora(f.en), x + col / 2 - 5, y + 39, { align: 'center' });
      } else { doc.setTextColor(192, 57, 43); texto(pendiente, x + col / 2 - 5, y - 13, { align: 'center' }); doc.setTextColor(20); }
    };
    bloque(M, 'EMPLEADOR', firma && firma.empleador, 'Pendiente de firma');
    bloque(M + col, 'TRABAJADOR', firma && firma.trabajador, 'Pendiente de firma');
    y += 70;

    doc.setFontSize(8.5); doc.setTextColor(100);
    const pie = firma && firma.codigo
      ? 'Código de verificación: ' + firma.codigo + ' · Vacación N° ' + vac.id + '. El registro de ambas firmas (quién, cuándo y con qué cuenta) queda guardado en el portal de Creamos Imagen.'
      : 'Documento pendiente de firma: aún no tiene código de verificación.';
    doc.text(doc.splitTextToSize(pie, W - 2 * M), M, Math.max(y, 690));
    doc.save('Comprobante_feriado_' + (nombreT(trabajador).trim().replace(/\s+/g, '_') || 'trabajador') + '_' + datos.fechaInicio + '.pdf');
  }

  global.CertificadoVacaciones = { generar, estado, reintegro };
})(window);
