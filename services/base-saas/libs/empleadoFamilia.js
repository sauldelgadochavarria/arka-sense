'use strict';

const { trimString, parseDate } = require('./formHelpers');

const TIPOS_SANGRE = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const ESCOLARIDADES = ['', 'ninguna', 'preescolar', 'primaria', 'secundaria', 'bachillerato', 'universidad', 'otro'];
const APLICA_BENEFICIARIO = ['todos', 'seguro_vida', 'fondo_ahorro', 'ptu', 'finiquito'];
const ETIQUETA_APLICA = {
  todos: 'Todos (seguro, fondo, PTU y finiquito)',
  seguro_vida: 'Seguro de vida',
  fondo_ahorro: 'Fondo de ahorro',
  ptu: 'PTU',
  finiquito: 'Finiquito'
};

function asList(value) {
  if (value == null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function edadEn(fecha, hoy = new Date()) {
  if (!fecha) return null;
  const n = new Date(fecha);
  const h = new Date(hoy);
  if (Number.isNaN(n.getTime()) || Number.isNaN(h.getTime())) return null;
  let years = h.getFullYear() - n.getFullYear();
  const aunNo = h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate());
  if (aunNo) years -= 1;
  return years;
}

function diaCumple(fecha, anio) {
  const n = new Date(fecha);
  const month = n.getMonth();
  const day = n.getDate();
  const candidato = new Date(anio, month, day);
  if (candidato.getMonth() !== month) return new Date(anio, 1, 28);
  return candidato;
}

function cumpleEntre(fecha, inicio, fin) {
  if (!fecha || !inicio || !fin) return false;
  const a = new Date(inicio);
  const b = new Date(fin);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  const desde = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const hasta = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  for (let y = desde.getFullYear(); y <= hasta.getFullYear(); y += 1) {
    const c = diaCumple(fecha, y);
    if (c >= desde && c <= hasta) return true;
  }
  return false;
}

function buildSalud(body) {
  const tipo = trimString(body.salud_tipoSangre).toUpperCase();
  const tipoSangre = TIPOS_SANGRE.includes(tipo) ? tipo : '';
  return {
    tipoSangre,
    alergias: trimString(body.salud_alergias).slice(0, 500),
    padecimientos: trimString(body.salud_padecimientos).slice(0, 2000)
  };
}

function buildFamilia(body) {
  const conyugeNombre = trimString(body.conyuge_nombre).slice(0, 200);
  const conyuge = {
    nombre: conyugeNombre,
    fechaNacimiento: conyugeNombre ? parseDate(body.conyuge_fechaNacimiento) : null,
    ocupacion: trimString(body.conyuge_ocupacion).slice(0, 120),
    telefono: trimString(body.conyuge_telefono).slice(0, 30)
  };

  const nombres = asList(body.hijo_nombre);
  const fechas = asList(body.hijo_fechaNacimiento);
  const sexos = asList(body.hijo_sexo);
  const escuelas = asList(body.hijo_escolaridad);
  const hijos = [];
  for (let i = 0; i < nombres.length && hijos.length < 20; i += 1) {
    const nombre = trimString(nombres[i]).slice(0, 200);
    if (!nombre) continue;
    const sexo = ['M', 'F', 'X'].includes(trimString(sexos[i])) ? trimString(sexos[i]) : '';
    const escolaridad = ESCOLARIDADES.includes(trimString(escuelas[i])) ? trimString(escuelas[i]) : '';
    hijos.push({
      nombre,
      fechaNacimiento: parseDate(fechas[i]),
      sexo,
      escolaridad
    });
  }

  const cNom = asList(body.emergencia_nombre);
  const cPar = asList(body.emergencia_parentesco);
  const cTel = asList(body.emergencia_telefono);
  const cAlt = asList(body.emergencia_telefonoAlt);
  const contactosEmergencia = [];
  for (let i = 0; i < cNom.length && contactosEmergencia.length < 6; i += 1) {
    const nombre = trimString(cNom[i]).slice(0, 200);
    if (!nombre) continue;
    contactosEmergencia.push({
      nombre,
      parentesco: trimString(cPar[i]).slice(0, 60),
      telefono: trimString(cTel[i]).slice(0, 30),
      telefonoAlt: trimString(cAlt[i]).slice(0, 30)
    });
  }

  const bNom = asList(body.benef_nombre);
  const bPar = asList(body.benef_parentesco);
  const bPct = asList(body.benef_porcentaje);
  const bAplica = asList(body.benef_aplicaA);
  const beneficiarios = [];
  for (let i = 0; i < bNom.length && beneficiarios.length < 12; i += 1) {
    const nombre = trimString(bNom[i]).slice(0, 200);
    if (!nombre) continue;
    const aplicaA = APLICA_BENEFICIARIO.includes(trimString(bAplica[i])) ? trimString(bAplica[i]) : 'todos';
    let porcentaje = Number(bPct[i]);
    if (!Number.isFinite(porcentaje) || porcentaje < 0) porcentaje = 0;
    porcentaje = Math.round(porcentaje * 100) / 100;
    beneficiarios.push({
      nombre,
      parentesco: trimString(bPar[i]).slice(0, 60),
      porcentaje,
      aplicaA
    });
  }

  const familia = { conyuge, hijos, contactosEmergencia, beneficiarios };
  const msg = validarBeneficiarios(beneficiarios);
  if (msg) {
    const err = new Error(msg);
    err.code = 'FAMILIA';
    throw err;
  }
  return familia;
}

function validarBeneficiarios(beneficiarios) {
  const destinos = ['seguro_vida', 'fondo_ahorro', 'ptu', 'finiquito'];
  for (const destino of destinos) {
    const suma = beneficiarios
      .filter((b) => b.aplicaA === destino || b.aplicaA === 'todos')
      .reduce((acc, b) => acc + Number(b.porcentaje || 0), 0);
    if (suma > 100.009) {
      return `Los beneficiarios de ${ETIQUETA_APLICA[destino]} suman ${suma.toFixed(2)}%. El máximo es 100%.`;
    }
  }
  return null;
}

function metricasFamilia(empleado, periodo, hoy = new Date()) {
  const fam = empleado?.familia || {};
  const hijos = Array.isArray(fam.hijos) ? fam.hijos : [];
  const inicio = periodo?.fechaInicio || null;
  const fin = periodo?.fechaFin || null;
  let hijosMenores = 0;
  let hijosEscolares = 0;
  let nacimientoEnPeriodo = 0;
  for (const hijo of hijos) {
    const edad = edadEn(hijo.fechaNacimiento, fin || hoy);
    const menor = edad == null ? false : edad < 18;
    if (menor) hijosMenores += 1;
    const escuela = hijo.escolaridad && hijo.escolaridad !== 'ninguna';
    if (menor && escuela) hijosEscolares += 1;
    if (cumpleEntre(hijo.fechaNacimiento, inicio, fin)) nacimientoEnPeriodo += 1;
  }
  const conyuge = fam.conyuge || {};
  const tieneConyuge = conyuge.nombre ? 1 : 0;
  if (tieneConyuge && cumpleEntre(conyuge.fechaNacimiento, inicio, fin)) nacimientoEnPeriodo += 1;
  return {
    hijos: hijos.length,
    hijosMenores,
    hijosEscolares,
    tieneConyuge,
    nacimientoEnPeriodo
  };
}

function alertasFamilia(empleado, documentos = [], hoy = new Date()) {
  const alertas = [];
  const hijos = empleado?.familia?.hijos || [];
  const limite = new Date(hoy);
  limite.setDate(limite.getDate() + 90);
  for (const hijo of hijos) {
    if (!hijo.fechaNacimiento || !hijo.nombre) continue;
    const edad = edadEn(hijo.fechaNacimiento, hoy);
    const cumple18 = diaCumple(hijo.fechaNacimiento, new Date(hijo.fechaNacimiento).getFullYear() + 18);
    if (edad != null && edad >= 18) {
      alertas.push({
        tipo: 'mayor_edad',
        texto: `${hijo.nombre} ya es mayor de edad (${edad} años) y deja de contar como hijo menor para prestaciones familiares.`
      });
    } else if (cumple18 >= new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) && cumple18 <= limite) {
      alertas.push({
        tipo: 'proxima_mayoria',
        texto: `${hijo.nombre} cumple 18 años el ${cumple18.toLocaleDateString('es-MX')}.`
      });
    }
  }

  if (Array.isArray(documentos)) {
    const dom = documentos.filter((d) => d.tipoCodigo === 'EMP_COMP_DOMICILIO' && d.activo !== false);
    if (!dom.length) {
      alertas.push({
        tipo: 'domicilio',
        texto: 'No hay comprobante de domicilio en el expediente.'
      });
    } else {
      const vigente = dom
        .map((d) => d.vigenteHasta)
        .filter(Boolean)
        .sort((a, b) => new Date(b) - new Date(a))[0];
      if (vigente && new Date(vigente) < hoy) {
        alertas.push({
          tipo: 'domicilio',
          texto: `El comprobante de domicilio venció el ${new Date(vigente).toLocaleDateString('es-MX')}.`
        });
      } else if (vigente) {
        const pronto = new Date(hoy);
        pronto.setDate(pronto.getDate() + 30);
        if (new Date(vigente) <= pronto) {
          alertas.push({
            tipo: 'domicilio',
            texto: `El comprobante de domicilio vence el ${new Date(vigente).toLocaleDateString('es-MX')}.`
          });
        }
      }
    }
  }
  return alertas;
}

module.exports = {
  TIPOS_SANGRE,
  ESCOLARIDADES,
  APLICA_BENEFICIARIO,
  ETIQUETA_APLICA,
  buildSalud,
  buildFamilia,
  metricasFamilia,
  alertasFamilia,
  edadEn
};
