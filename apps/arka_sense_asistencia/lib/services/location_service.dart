import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../config/api_config.dart';

class GeoPoint {
  GeoPoint({required this.lat, required this.lng, this.accuracyMeters});
  final double lat;
  final double lng;
  final double? accuracyMeters;
}

class LocationService {
  Future<GeoPoint> currentPosition() async {
    final enabled = await Geolocator.isLocationServiceEnabled();
    if (!enabled) {
      throw Exception('Activa el GPS / servicios de ubicación');
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      throw Exception('Permiso de ubicación denegado');
    }

    final pos = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 20),
      ),
    );
    return GeoPoint(
      lat: pos.latitude,
      lng: pos.longitude,
      accuracyMeters: pos.accuracy,
    );
  }

  static String plataforma() {
    if (kIsWeb) return 'web';
    try {
      if (Platform.isAndroid) return 'android';
      if (Platform.isIOS) return 'ios';
      if (Platform.isWindows) return 'windows';
      if (Platform.isMacOS) return 'macos';
      if (Platform.isLinux) return 'linux';
    } catch (_) {
      /* web / unsupported */
    }
    return defaultTargetPlatform.name;
  }

  static Map<String, dynamic> deviceMeta() => {
        'plataforma': plataforma(),
        'modelo': defaultTargetPlatform.name,
        'appVersion': ApiConfig.appVersion,
      };
}
