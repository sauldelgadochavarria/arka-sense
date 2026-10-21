import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/auth_state.dart';
import '../services/device_id_service.dart';
import '../services/location_service.dart';

/// Registro de dispositivo (SMS + UUID), estilo WhatsApp.
class DeviceRegisterScreen extends StatefulWidget {
  const DeviceRegisterScreen({super.key, this.onRegistered});

  final VoidCallback? onRegistered;

  @override
  State<DeviceRegisterScreen> createState() => _DeviceRegisterScreenState();
}

class _DeviceRegisterScreenState extends State<DeviceRegisterScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _deviceIds = DeviceIdService();
  bool _busy = false;
  bool _codeSent = false;
  String? _error;
  String? _hint;
  String? _masked;
  String? _devCode;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _solicitar() async {
    setState(() {
      _busy = true;
      _error = null;
      _hint = null;
      _devCode = null;
    });
    try {
      final auth = context.read<AuthState>();
      final uuid = await _deviceIds.getDeviceUuid();
      final data = await auth.api.post('/auth/dispositivo/solicitar-otp', {
        'deviceUuid': uuid,
        'telefono': _phone.text.trim(),
        ...LocationService.deviceMeta(deviceUuid: uuid),
      });
      if (!mounted) return;
      setState(() {
        _codeSent = true;
        _masked = data['telefonoEnmascarado']?.toString();
        _devCode = data['devCode']?.toString();
        _hint = _devCode != null
            ? 'Modo desarrollo: código $_devCode'
            : 'Te enviamos un SMS${_masked != null ? ' a $_masked' : ''}';
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verificar() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final auth = context.read<AuthState>();
      final uuid = await _deviceIds.getDeviceUuid();
      await auth.api.post('/auth/dispositivo/verificar-otp', {
        'deviceUuid': uuid,
        'codigo': _code.text.trim(),
        ...LocationService.deviceMeta(deviceUuid: uuid),
      });
      await auth.refreshSeguridadMovil();
      if (!mounted) return;
      widget.onRegistered?.call();
      if (Navigator.of(context).canPop()) {
        Navigator.of(context).pop(true);
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthState>();
    final maskedHint = auth.seguridadMovil?['telefonoEnmascarado']?.toString();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Registrar dispositivo'),
        backgroundColor: const Color(0xFF0D3A4A),
        automaticallyImplyLeading: false,
      ),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Icon(Icons.phonelink_lock, size: 48, color: Color(0xFF2FD4A1)),
          const SizedBox(height: 16),
          const Text(
            'Verifica este teléfono',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            maskedHint != null && maskedHint.isNotEmpty
                ? 'Tu subsidiaria exige registrar el móvil. Usaremos el celular del expediente ($maskedHint) o el que indiques.'
                : 'Tu subsidiaria exige registrar el móvil con un código SMS, como WhatsApp.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white70),
          ),
          const SizedBox(height: 28),
          if (!_codeSent) ...[
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: InputDecoration(
                labelText: 'Celular',
                hintText: maskedHint?.isNotEmpty == true ? 'Vacío = usar $maskedHint' : '+52…',
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : _solicitar,
              child: _busy
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Enviar código SMS'),
            ),
          ] else ...[
            TextField(
              controller: _code,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Código de 6 dígitos',
              ),
              onSubmitted: (_) => _busy ? null : _verificar(),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : _verificar,
              child: _busy
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Verificar y continuar'),
            ),
            TextButton(
              onPressed: _busy ? null : _solicitar,
              child: const Text('Reenviar código'),
            ),
          ],
          if (_hint != null) ...[
            const SizedBox(height: 12),
            Text(_hint!, style: const TextStyle(color: Color(0xFF2FD4A1))),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.orangeAccent)),
          ],
          const SizedBox(height: 24),
          TextButton(
            onPressed: _busy
                ? null
                : () async {
                    await auth.logout();
                  },
            child: const Text('Cerrar sesión'),
          ),
        ],
      ),
    );
  }
}
