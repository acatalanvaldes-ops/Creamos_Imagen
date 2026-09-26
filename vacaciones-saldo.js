// Saldo de vacaciones (feriado legal) compartido por RRHH y Mi Portal.
//
// - Se ganan 15 días hábiles por año (1,25 por mes trabajado). Art. 67 CT.
// - Si RRHH cargó un saldo efectivo (t.correccionSaldoVacaciones), se parte de
//   ese saldo en su fecha y se suman 1,25 días por mes desde entonces.
// - Acumulación: art. 70 CT. El feriado se puede acumular hasta por dos
//   períodos consecutivos; el empleador debe otorgar al menos el primero
//   antes de que el trabajador complete el año que le da un tercer período.
//   Los días no se pierden si se supera, pero el empleador queda en infracción.
(function (global) {
  const DIAS_POR_ANIO = 15;

  function meses(ini, fin) {
    const a = [+ini.slice(0, 4), +ini.slice(5, 7), +ini.slice(8, 10)], b = [+fin.slice(0, 4), +fin.slice(5, 7), +fin.slice(8, 10)];
    let m = (b[0] - a[0]) * 12 + (b[1] - a[1]); let d = b[2] - a[2];
    if (d < 0) { m--; d += 30; }
    return Math.max(0, m + d / 30);
  }
  const r2 = n => Math.round(n * 100) / 100;
  const txt = n => r2(n).toLocaleString("es-CL");

  // Próximo aniversario laboral estrictamente después de `al`.
  function proximoAniversario(ingreso, al) {
    if (!ingreso) return null;
    const md = ingreso.slice(5, 10) === '02-29' ? '02-28' : ingreso.slice(5, 10);
    let y = +al.slice(0, 4);
    let f = y + '-' + md;
    if (f <= al) f = (y + 1) + '-' + md;
    return f;
  }

  // aprobadas: vacaciones aprobadas del trabajador ({fechaInicio, dias}).
  function calcular(t, aprobadas, al) {
    if (!t || !al) return null;
    const lista = (aprobadas || []).filter(v => !v.estado || v.estado === 'Aprobada');
    const aj = t.correccionSaldoVacaciones;
    let ganados, usados, disponibles, origen;
    if (aj && aj.fecha && al >= aj.fecha) {
      const posteriores = lista.filter(v => String(v.fechaInicio || '') >= aj.fecha).reduce((s, v) => s + (Number(v.dias) || 0), 0);
      const nuevos = meses(aj.fecha, al) * DIAS_POR_ANIO / 12;
      ganados = (Number(aj.disponibles) || 0) + (Number(aj.habilesTomados) || 0) + nuevos;
      usados = (Number(aj.habilesTomados) || 0) + posteriores;
      disponibles = (Number(aj.disponibles) || 0) + nuevos - posteriores;
      origen = 'saldo cargado el ' + aj.fecha.split('-').reverse().join('-');
    } else if (t.fechaIngreso && al >= t.fechaIngreso) {
      ganados = meses(t.fechaIngreso, al) * DIAS_POR_ANIO / 12;
      usados = lista.reduce((s, v) => s + (Number(v.dias) || 0), 0);
      disponibles = ganados - usados;
      origen = 'desde la fecha de ingreso';
    } else return null;

    // Límite legal: dos períodos anuales.
    const limite = 2 * DIAS_POR_ANIO;
    const aniv = proximoAniversario(t.fechaIngreso, al);
    const alAniversario = aniv ? disponibles + meses(al, aniv) * DIAS_POR_ANIO / 12 : null;
    let alerta = null;
    if (disponibles > limite) {
      alerta = { nivel: 'excede', texto: `Acumula ${txt(disponibles)} días: supera los 2 períodos (${limite} días) que permite el art. 70 del Código del Trabajo. Debe tomar vacaciones cuanto antes.` };
    } else if (alAniversario !== null && alAniversario > limite) {
      const falta = Math.ceil(alAniversario - limite);
      alerta = { nivel: 'pronto', texto: `Al aniversario del ${aniv.split('-').reverse().join('-')} acumularía ${txt(alAniversario)} días. Para no pasar de 2 períodos debe tomar al menos ${falta} día(s) hábiles antes de esa fecha.` };
    }
    return { ganados: r2(ganados), usados: r2(usados), disponibles: r2(disponibles), limite, aniversario: aniv, alAniversario: alAniversario === null ? null : r2(alAniversario), alerta, origen };
  }

  global.SaldoVacaciones = { calcular, proximoAniversario, meses, DIAS_POR_ANIO };
})(window);
