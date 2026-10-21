'use strict';

const { sendToEmpleado } = require('./pushNotificationService');

async function notifySupervisorSolicitud({ solicitud, empleado, supervisor }) {
  const nombre = empleado
    ? `${empleado.firstName || ''} ${empleado.lastName || ''}`.trim()
    : String(solicitud.empleadoId);
  const title = 'Nueva solicitud de vacaciones';
  const body = `${nombre} pidió ${solicitud.diasSolicitados} día(s) del ${fmt(solicitud.fechaInicio)} al ${fmt(solicitud.fechaFin)}`;
  console.info(`[vacaciones] ${body}`);
  if (supervisor?._id && solicitud.tenantId) {
    await sendToEmpleado(solicitud.tenantId, supervisor._id, {
      title,
      body,
      data: {
        type: 'vacacion_solicitud',
        solicitudId: String(solicitud._id),
        status: 'PENDING'
      }
    }).catch((e) => console.warn('[vacaciones] push supervisor', e.message));
  }
  return { ok: true, title, body };
}

async function notifyEmpleadoResolucion({ solicitud, empleado, status }) {
  const label =
    status === 'APPROVED' ? 'aprobada' : status === 'REJECTED' ? 'rechazada' : String(status);
  const title = `Vacaciones ${label}`;
  const body = `Tu solicitud del ${fmt(solicitud.fechaInicio)} al ${fmt(solicitud.fechaFin)} fue ${label}.`;
  console.info(`[vacaciones] ${empleado?.firstName || ''} · ${body}`);
  if (empleado?._id && solicitud.tenantId) {
    await sendToEmpleado(solicitud.tenantId, empleado._id, {
      title,
      body,
      data: {
        type: 'vacacion_resolucion',
        solicitudId: String(solicitud._id),
        status: String(status)
      }
    }).catch((e) => console.warn('[vacaciones] push empleado', e.message));
  }
  return { ok: true, title, body };
}

function fmt(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('es-MX');
  } catch {
    return String(d);
  }
}

module.exports = {
  notifySupervisorSolicitud,
  notifyEmpleadoResolucion
};
