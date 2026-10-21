import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// UUID estable del dispositivo (persistente en el teléfono; no es IMEI).
class DeviceIdService {
  DeviceIdService({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  static const _kKey = 'aska_device_uuid_v1';
  final FlutterSecureStorage _storage;
  String? _cached;

  Future<String> getDeviceUuid() async {
    if (_cached != null && _cached!.isNotEmpty) return _cached!;
    try {
      final existing = await _storage.read(key: _kKey);
      if (existing != null && existing.isNotEmpty) {
        _cached = existing;
        return existing;
      }
    } catch (_) {
      /* continue */
    }
    final id = const Uuid().v4();
    try {
      await _storage.write(key: _kKey, value: id);
    } catch (_) {
      /* keep in memory */
    }
    _cached = id;
    return id;
  }
}
