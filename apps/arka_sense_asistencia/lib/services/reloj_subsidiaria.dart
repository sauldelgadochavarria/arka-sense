import 'package:intl/intl.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// Hora de pared de la subsidiaria. No usa la zona del teléfono.
class RelojSubsidiaria {
  RelojSubsidiaria._();

  static bool _ready = false;

  static void ensureInit() {
    if (_ready) return;
    tzdata.initializeTimeZones();
    _ready = true;
  }

  static tz.Location locationOf(String? iana) {
    ensureInit();
    final name = (iana == null || iana.trim().isEmpty) ? 'America/Mexico_City' : iana.trim();
    try {
      return tz.getLocation(name);
    } catch (_) {
      return tz.getLocation('America/Mexico_City');
    }
  }

  static tz.TZDateTime? instantIn(dynamic iso, String? zona) {
    final raw = iso?.toString() ?? '';
    if (raw.isEmpty || raw == 'null') return null;
    final parsed = DateTime.tryParse(raw);
    if (parsed == null) return null;
    return tz.TZDateTime.from(parsed.toUtc(), locationOf(zona));
  }

  /// Preferir el texto que ya mandó el servidor (`hora`, `fechaHora`).
  static String hora(dynamic iso, String? zona, {String? yaFormateada}) {
    final lista = yaFormateada?.trim() ?? '';
    if (lista.isNotEmpty && lista != '—') return lista;
    final wall = instantIn(iso, zona);
    if (wall == null) return '—';
    return DateFormat.Hm().format(wall);
  }

  static String fechaHora(
    dynamic iso,
    String? zona, {
    String? yaFormateada,
    bool conSegundos = false,
  }) {
    final lista = yaFormateada?.trim() ?? '';
    if (lista.isNotEmpty && lista != '—') return lista;
    final wall = instantIn(iso, zona);
    if (wall == null) return '—';
    final patron = conSegundos ? 'dd/MM/yyyy HH:mm:ss' : 'dd/MM/yyyy HH:mm';
    return DateFormat(patron).format(wall);
  }

  /// YYYY-MM-DD de calendario, sin correr el día por la zona del teléfono.
  static String fechaCalendario(dynamic value) {
    final s = value?.toString() ?? '';
    final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(s);
    if (m == null) return '—';
    return '${m.group(3)}/${m.group(2)}/${m.group(1)}';
  }

  static String fechaDesdeYmd(String? ymd) {
    if (ymd == null || ymd.length < 10) return '';
    final p = ymd.split('-');
    if (p.length < 3) return ymd;
    final y = int.tryParse(p[0]);
    final mo = int.tryParse(p[1]);
    final d = int.tryParse(p[2]);
    if (y == null || mo == null || d == null) return ymd;
    return DateFormat('EEE d MMM y').format(DateTime(y, mo, d));
  }

  static int horaDeReloj(Map<String, dynamic>? reloj) {
    final h = reloj?['hora']?.toString() ?? '';
    final m = RegExp(r'^(\d{1,2})').firstMatch(h);
    if (m != null) return int.parse(m.group(1)!);
    final wall = instantIn(reloj?['instante'], reloj?['zonaHoraria']?.toString());
    return wall?.hour ?? DateTime.now().hour;
  }
}
