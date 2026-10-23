import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../config/api_config.dart';
import '../services/api_client.dart';
import '../services/auth_state.dart';
import '../services/device_id_service.dart';
import '../services/location_service.dart';
import '../services/notification_inbox.dart';
import '../services/punch_local_store.dart';
import '../services/reminder_scheduler.dart';
import 'history_screen.dart';
import 'liveness_screen.dart';
import 'notifications_screen.dart';
import 'recibos_screen.dart';
import 'vacaciones_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _location = LocationService();
  final _deviceIds = DeviceIdService();
  Map<String, dynamic>? _hoy;
  bool _loading = true;
  bool _punching = false;
  bool _offline = false;
  String? _error;
  String? _remindersMsg;
  int _tab = 0;
  int _unreadNotif = 0;
  List<AppNotification> _latestNotifs = [];

  @override
  void initState() {
    super.initState();
    NotificationInbox.instance.onChanged = _onInboxChanged;
    _bootstrapInbox();
    _refresh();
  }

  @override
  void dispose() {
    if (NotificationInbox.instance.onChanged == _onInboxChanged) {
      NotificationInbox.instance.onChanged = null;
    }
    super.dispose();
  }

  void _onInboxChanged() {
    if (!mounted) return;
    setState(() {
      _unreadNotif = NotificationInbox.instance.unreadCount;
      _latestNotifs = NotificationInbox.instance.latest(limit: 2);
    });
  }

  Future<void> _bootstrapInbox() async {
    await NotificationInbox.instance.ensureLoaded();
    if (!mounted) return;
    _onInboxChanged();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final auth = context.read<AuthState>();
    try {
      await auth.refreshCapabilities();
    } catch (_) {
      /* la sesión revocada ya cierra desde el cliente API */
    }
    try {
      await PunchLocalStore.instance.flushPending(auth);
    } catch (_) {
      /* red */
    }
    try {
      final data = await auth.api.get('/asistencia/hoy');
      if (!mounted) return;
      setState(() {
        _hoy = data;
        _offline = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.isSessionRevoked) return; // AuthState ya cerró sesión
      setState(() {
        _error = e.message;
        _offline = true;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _offline = true;
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
    try {
      final r = await ReminderScheduler.instance.syncFromApi(auth);
      if (mounted) {
        setState(() {
          _remindersMsg = r.ok
              ? '${r.scheduled} aviso(s) programado(s)${r.online ? '' : ' · caché offline'}'
              : null;
          if (!r.online) _offline = true;
        });
      }
    } catch (_) {
      /* ignore */
    }
    await _bootstrapInbox();
  }

  List<Map<String, dynamic>> get _marcaciones {
    final raw = (_hoy?['marcaciones'] as List?) ?? [];
    return raw.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
  }

  bool get _hasEntrada =>
      _marcaciones.any((m) => '${m['tipoMarcacion']}' == 'entrada');

  bool get _hasSalida =>
      _marcaciones.any((m) => '${m['tipoMarcacion']}' == 'salida');

  /// CTA principal: Entrada → Salida (sin obligar comida).
  String? get _ctaTipo {
    if (!_hasEntrada) return 'entrada';
    if (!_hasSalida) return 'salida';
    return null;
  }

  String get _ctaLabel {
    switch (_ctaTipo) {
      case 'entrada':
        return 'Registrar Entrada';
      case 'salida':
        return 'Registrar Salida';
      default:
        return 'Jornada completa';
    }
  }

  String _fmtHoraIso(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final d = DateTime.tryParse(iso)?.toLocal();
    if (d == null) return '—';
    return DateFormat.Hm().format(d);
  }

  String _labelTipo(String value) {
    const map = {
      'entrada': 'Entrada',
      'salida': 'Salida',
      'salida_comida': 'Salida a comida',
      'regreso_comida': 'Regreso de comida',
    };
    return map[value] ?? value;
  }

  String _saludo() {
    final h = DateTime.now().hour;
    if (h < 12) return '¡Buenos días';
    if (h < 19) return '¡Buenas tardes';
    return '¡Buenas noches';
  }

  bool get _enTurnoAhora {
    final horario = _hoy?['horario'] as Map<String, dynamic>?;
    if (horario == null || horario['esDescanso'] == true) return false;
    final ini = DateTime.tryParse('${horario['entradaProgramada']}')?.toLocal();
    final fin = DateTime.tryParse('${horario['salidaProgramada']}')?.toLocal();
    if (ini == null || fin == null) return false;
    final now = DateTime.now();
    // Holgura ±30 min para el semáforo
    return now.isAfter(ini.subtract(const Duration(minutes: 30))) &&
        now.isBefore(fin.add(const Duration(minutes: 30)));
  }

  Future<void> _marcar() async {
    final tipo = _ctaTipo;
    if (tipo == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Ya registraste entrada y salida hoy')),
      );
      return;
    }
    setState(() => _punching = true);
    try {
      final live = await Navigator.of(context).push<LivenessResult>(
        MaterialPageRoute(builder: (_) => const LivenessScreen()),
      );
      if (!mounted) return;
      if (live == null) return;
      if (!live.success) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(live.message)));
        return;
      }

      final geo = await _location.currentPosition();
      if (geo.isMocked) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Ubicación simulada (Fake GPS) no permitida')),
        );
        return;
      }
      final deviceUuid = await _deviceIds.getDeviceUuid();
      final body = {
        'tipoMarcacion': tipo,
        'lat': geo.lat,
        'lng': geo.lng,
        'accuracyMeters': geo.accuracyMeters,
        'isMocked': geo.isMocked,
        'biometriaOk': true,
        'biometriaScore': live.confidenceScore,
        'biometriaChallengeId': live.challengeId,
        ...LocationService.deviceMeta(deviceUuid: deviceUuid),
      };
      if (!mounted) return;
      try {
        final res = await context.read<AuthState>().api.post('/asistencia/marcar', body);
        if (!mounted) return;
        final geocerca = res['geocerca'] as Map<String, dynamic>?;
        final fuera = geocerca?['fueraDeZona'] == true;
        final site = geocerca?['siteNombre']?.toString();
        await NotificationInbox.instance.add(
          title: '${_labelTipo(tipo)} registrada',
          body: 'Tu marcación se sincronizó con el servidor'
              '${fuera ? ' (fuera de zona)' : (site != null && site.isNotEmpty ? ' · $site' : '')}.',
          type: 'alerta',
        );
        if (!mounted) return;
        final serverMsg = res['message']?.toString();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              (serverMsg != null && serverMsg.isNotEmpty)
                  ? serverMsg
                  : 'Registrado: ${_labelTipo(tipo)}'
                      ' · ${(live.confidenceScore * 100).toStringAsFixed(0)}%'
                      '${fuera ? ' · fuera de zona' : (site != null && site.isNotEmpty ? ' · $site' : '')}',
            ),
          ),
        );
      } on ApiException catch (e) {
        if (e.isSessionRevoked) return;
        // Sin red / error API → cola local (excepto errores de negocio claros)
        final msg = e.message.toLowerCase();
        final business = e.statusCode == 409 ||
            e.statusCode == 400 ||
            msg.contains('geocerca') ||
            msg.contains('zona') ||
            msg.contains('jornada');
        if (business) rethrow;
        await PunchLocalStore.instance.enqueuePending(
          LocalPunch(
            localId: 'local-${DateTime.now().millisecondsSinceEpoch}',
            tipoMarcacion: tipo,
            timestamp: DateTime.now(),
            pendingBody: body,
            lat: geo.lat,
            lng: geo.lng,
          ),
        );
        await NotificationInbox.instance.add(
          title: '${_labelTipo(tipo)} guardada offline',
          body: 'Sin conexión. Se enviará automáticamente cuando haya señal.',
          urgente: true,
          type: 'alerta',
        );
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              '${_labelTipo(tipo)} guardada en el teléfono (pendiente de sync)',
            ),
            backgroundColor: Colors.orange.shade800,
          ),
        );
      }
      await _refresh();
    } on ApiException catch (e) {
      if (mounted && !e.isSessionRevoked) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _punching = false);
    }
  }

  Future<void> _openNotifications() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const NotificationsScreen()),
    );
    await _bootstrapInbox();
  }

  /// Índices: Inicio(0), Historial(1), [Vacaciones], [Recibos], Perfil.
  int get _idxVacaciones => 2;
  int get _idxRecibos => context.read<AuthState>().vacacionesEnabled ? 3 : 2;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthState>();
    final firstName = auth.displayName.split(' ').first;
    final horario = _hoy?['horario'] as Map<String, dynamic>?;
    final turno = horario?['turno'] as Map<String, dynamic>?;
    final fechaTxt = DateFormat('EEE d MMM y').format(DateTime.now());

    final pages = <Widget>[
      _buildInicio(auth, firstName, fechaTxt, horario, turno),
      const HistoryScreen(),
      if (auth.vacacionesEnabled) const VacacionesScreen(),
      if (auth.recibosEnabled) const RecibosScreen(),
      if (!auth.vacacionesEnabled && !auth.recibosEnabled)
        _buildPlaceholder(
          'Módulos',
          'Vacaciones y recibos se habilitan por licencia del tenant y subsidiaria.',
          Icons.apps_outlined,
        ),
      _buildPerfil(auth),
    ];

    final destinations = <NavigationDestination>[
      const NavigationDestination(
        icon: Icon(Icons.home_outlined),
        selectedIcon: Icon(Icons.home),
        label: 'Inicio',
      ),
      const NavigationDestination(
        icon: Icon(Icons.calendar_month_outlined),
        selectedIcon: Icon(Icons.calendar_month),
        label: 'Historial',
      ),
      if (auth.vacacionesEnabled)
        const NavigationDestination(
          icon: Icon(Icons.beach_access_outlined),
          selectedIcon: Icon(Icons.beach_access),
          label: 'Vacaciones',
        ),
      if (auth.recibosEnabled)
        const NavigationDestination(
          icon: Icon(Icons.payments_outlined),
          selectedIcon: Icon(Icons.payments),
          label: 'Recibos',
        ),
      if (!auth.vacacionesEnabled && !auth.recibosEnabled)
        const NavigationDestination(
          icon: Icon(Icons.apps_outlined),
          selectedIcon: Icon(Icons.apps),
          label: 'Más',
        ),
      const NavigationDestination(
        icon: Icon(Icons.person_outline),
        selectedIcon: Icon(Icons.person),
        label: 'Perfil',
      ),
    ];

    final safeTab = _tab.clamp(0, pages.length - 1);

    return Scaffold(
      backgroundColor: const Color(0xFF0A1518),
      body: SafeArea(
        child: IndexedStack(
          index: safeTab,
          children: pages,
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: safeTab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        backgroundColor: const Color(0xFF0D2228),
        indicatorColor: const Color(0xFF2FD4A1).withValues(alpha: 0.25),
        destinations: destinations,
      ),
    );
  }

  Widget _buildInicio(
    AuthState auth,
    String firstName,
    String fechaTxt,
    Map<String, dynamic>? horario,
    Map<String, dynamic>? turno,
  ) {
    final cta = _ctaTipo;
    final enTurno = _enTurnoAhora;

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          // 1) Header personal
          Container(
            padding: const EdgeInsets.fromLTRB(20, 16, 12, 28),
            decoration: const BoxDecoration(
              color: Color(0xFF0F3D3A),
              borderRadius: BorderRadius.vertical(bottom: Radius.circular(28)),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 28,
                  backgroundColor: const Color(0xFF2FD4A1).withValues(alpha: 0.2),
                  child: Text(
                    firstName.isNotEmpty ? firstName[0].toUpperCase() : '?',
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF2FD4A1),
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${_saludo()}, $firstName!',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                      ),
                      Text(
                        [
                          if (auth.numEmpleado.isNotEmpty) '#${auth.numEmpleado}',
                          turno?['nombre']?.toString() ?? auth.tenantLabel,
                        ].where((e) => e.toString().isNotEmpty).join(' · '),
                        style: const TextStyle(color: Colors.white70, fontSize: 13),
                      ),
                      Text(
                        fechaTxt,
                        style: const TextStyle(color: Colors.white54, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Notificaciones',
                  onPressed: _openNotifications,
                  icon: Badge(
                    isLabelVisible: _unreadNotif > 0,
                    label: Text('$_unreadNotif'),
                    child: const Icon(Icons.mail_outline, color: Colors.white),
                  ),
                ),
              ],
            ),
          ),

          // 2) Hero card de asistencia (flota sobre el header)
          Transform.translate(
            offset: const Offset(0, -16),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Card(
                elevation: 6,
                color: const Color(0xFF12262C),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: enTurno ? const Color(0xFF2FD4A1) : Colors.orangeAccent,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            enTurno ? 'En ventana de turno' : 'Fuera de ventana de turno',
                            style: TextStyle(
                              color: enTurno ? const Color(0xFF2FD4A1) : Colors.orangeAccent,
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                            ),
                          ),
                          const Spacer(),
                          if (_offline)
                            const Icon(Icons.cloud_off, size: 18, color: Colors.amber),
                        ],
                      ),
                      if (horario != null && horario['esDescanso'] != true) ...[
                        const SizedBox(height: 10),
                        Text(
                          'Entrada ${_fmtHoraIso(horario['entradaProgramada']?.toString())}'
                          '  ·  Salida ${_fmtHoraIso(horario['salidaProgramada']?.toString())}',
                          style: const TextStyle(color: Colors.white70, fontSize: 13),
                        ),
                      ],
                      if (_offline) ...[
                        const SizedBox(height: 12),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: Colors.amber.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: Colors.amber.withValues(alpha: 0.35)),
                          ),
                          child: const Text(
                            'Modo sin conexión o API inalcanzable. '
                            'Los recordatorios usan caché; la cola offline de marcaciones llega en la siguiente versión.',
                            style: TextStyle(color: Colors.amber, fontSize: 12),
                          ),
                        ),
                      ],
                      const SizedBox(height: 18),
                      if (_loading)
                        const Padding(
                          padding: EdgeInsets.all(24),
                          child: CircularProgressIndicator(),
                        )
                      else if (_error != null && _hoy == null)
                        Text(_error!, style: const TextStyle(color: Colors.orangeAccent))
                      else ...[
                        SizedBox(
                          width: double.infinity,
                          height: 56,
                          child: FilledButton.icon(
                            onPressed: (_punching || cta == null) ? null : _marcar,
                            icon: _punching
                                ? const SizedBox(
                                    width: 22,
                                    height: 22,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : Icon(cta == 'salida' ? Icons.logout : Icons.face),
                            label: Text(
                              _ctaLabel,
                              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                            ),
                            style: FilledButton.styleFrom(
                              backgroundColor: const Color(0xFF2FD4A1),
                              foregroundColor: const Color(0xFF06201C),
                              disabledBackgroundColor: Colors.white12,
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          _ultimaActividadTxt(),
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.white54, fontSize: 12),
                        ),
                        if (_remindersMsg != null) ...[
                          const SizedBox(height: 6),
                          Text(
                            _remindersMsg!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.white38, fontSize: 11),
                          ),
                        ],
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),

          // 3) Accesos rápidos
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: _quickTile(
                    icon: Icons.hourglass_bottom,
                    label: 'Historial',
                    onTap: () => setState(() => _tab = 1),
                  ),
                ),
                if (auth.vacacionesEnabled) ...[
                  const SizedBox(width: 12),
                  Expanded(
                    child: _quickTile(
                      icon: Icons.beach_access,
                      label: 'Vacaciones',
                      onTap: () => setState(() => _tab = _idxVacaciones),
                    ),
                  ),
                ],
                if (auth.recibosEnabled) ...[
                  const SizedBox(width: 12),
                  Expanded(
                    child: _quickTile(
                      icon: Icons.receipt_long,
                      label: 'Recibos',
                      onTap: () => setState(() => _tab = _idxRecibos),
                    ),
                  ),
                ],
              ],
            ),
          ),

          // 4) Últimas 2 notificaciones (historial completo en el icono de correo)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Últimas notificaciones',
                        style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                      ),
                    ),
                    TextButton(
                      onPressed: _openNotifications,
                      child: const Text('Ver todas'),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                SizedBox(
                  height: 110,
                  child: _latestNotifs.isEmpty
                      ? const Center(
                          child: Text(
                            'Sin notificaciones recientes',
                            style: TextStyle(color: Colors.white54),
                          ),
                        )
                      : ListView(
                          scrollDirection: Axis.horizontal,
                          children: [
                            for (final n in _latestNotifs)
                              _avisoCard(
                                titulo: n.title,
                                preview: n.body,
                                urgente: n.urgente,
                                onTap: () async {
                                  await NotificationInbox.instance.markRead(n.id);
                                  await _openNotifications();
                                },
                              ),
                          ],
                        ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _ultimaActividadTxt() {
    if (_marcaciones.isEmpty) return 'Sin marcaciones aún hoy';
    final last = _marcaciones.last;
    final ts = DateTime.tryParse('${last['timestamp']}');
    final hora = ts != null ? DateFormat.Hm().format(ts.toLocal()) : '—';
    return 'Última: ${_labelTipo('${last['tipoMarcacion']}')} · $hora';
  }

  Widget _quickTile({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return Material(
      color: const Color(0xFF12262C),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 22),
          child: Column(
            children: [
              Icon(icon, size: 32, color: const Color(0xFF2FD4A1)),
              const SizedBox(height: 8),
              Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _avisoCard({
    required String titulo,
    required String preview,
    required bool urgente,
    VoidCallback? onTap,
  }) {
    return Padding(
      padding: const EdgeInsets.only(right: 12),
      child: Material(
        color: const Color(0xFF12262C),
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Container(
            width: 260,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border(
                left: BorderSide(
                  color: urgente ? Colors.redAccent : const Color(0xFF2FD4A1),
                  width: 4,
                ),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(titulo, style: const TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                Text(
                  preview,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPlaceholder(String title, String body, IconData icon) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: const Color(0xFF2FD4A1)),
            const SizedBox(height: 16),
            Text(title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text(body, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
          ],
        ),
      ),
    );
  }

  Widget _buildPerfil(AuthState auth) {
    final plataforma = Platform.isAndroid
        ? 'Android'
        : Platform.isIOS
            ? 'iOS'
            : Platform.operatingSystem;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text('Mi perfil', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        _perfilCard(
          children: [
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(
                backgroundColor: const Color(0xFF2FD4A1).withValues(alpha: 0.2),
                child: Text(
                  auth.displayName.isNotEmpty ? auth.displayName[0].toUpperCase() : '?',
                  style: const TextStyle(color: Color(0xFF2FD4A1), fontWeight: FontWeight.w700),
                ),
              ),
              title: Text(auth.displayName, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(
                auth.numEmpleado.isNotEmpty ? 'Empleado #${auth.numEmpleado}' : 'Empleado',
                style: const TextStyle(color: Colors.white70),
              ),
            ),
            if (auth.userEmail.isNotEmpty)
              _perfilRow(Icons.email_outlined, 'Correo', auth.userEmail),
            if (auth.tenantLabel.isNotEmpty)
              _perfilRow(Icons.business_outlined, 'Empresa', auth.tenantLabel),
          ],
        ),
        const SizedBox(height: 28),
        Text('Acerca de la app', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        _perfilCard(
          children: [
            _perfilRow(Icons.info_outline, 'Versión', '${ApiConfig.appVersion} · $plataforma'),
            _perfilRow(
              Icons.apartment_outlined,
              'Cuenta',
              [
                if (auth.tenantLabel.isNotEmpty) auth.tenantLabel,
                if (auth.tenantSlug.isNotEmpty) auth.tenantSlug,
              ].where((e) => e.isNotEmpty).join(' · '),
            ),
            _perfilRow(Icons.link, 'Servidor', ApiConfig.baseUrl),
          ],
        ),
        const SizedBox(height: 28),
        FilledButton.tonalIcon(
          style: FilledButton.styleFrom(
            foregroundColor: Colors.orangeAccent,
            padding: const EdgeInsets.symmetric(vertical: 14),
          ),
          onPressed: () => _cerrarSesion(auth),
          icon: const Icon(Icons.logout),
          label: const Text('Cerrar sesión'),
        ),
      ],
    );
  }

  Widget _perfilCard({required List<Widget> children}) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      decoration: BoxDecoration(
        color: const Color(0xFF12262C),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(children: children),
    );
  }

  Widget _perfilRow(IconData icon, String label, String value) {
    if (value.isEmpty) return const SizedBox.shrink();
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon, color: Colors.white54),
      title: Text(label, style: const TextStyle(fontSize: 12, color: Colors.white54)),
      subtitle: Text(value, style: const TextStyle(color: Colors.white)),
    );
  }

  Future<void> _cerrarSesion(AuthState auth) async {
    // Primero cerrar sesión (UI); limpia recordatorios en segundo plano.
    await auth.logout();
    unawaited(ReminderScheduler.instance.cancelAll());
  }
}
